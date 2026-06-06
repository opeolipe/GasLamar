import { TIER_PRICES } from './constants.js';
import { log, logError } from './utils.js';

// Tagged error for upstream Mayar gateway failures.
// Lets callers distinguish "Mayar is down/misconfigured" (→ 502) from
// internal Worker bugs (→ 500) without parsing error messages.
export class MayarError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'MayarError';
    this.mayarStatus = status; // HTTP status Mayar returned, if known
  }
}

export function getMayarApiUrl(env) {
  return env.ENVIRONMENT === 'production'
    ? 'https://api.mayar.id/hl/v1'
    : 'https://api.mayar.club/hl/v1';
}

export function getMayarApiKey(env) {
  return env.ENVIRONMENT === 'production'
    ? env.MAYAR_API_KEY
    : env.MAYAR_API_KEY_SANDBOX;
}

// Call once per request to confirm which Mayar gateway is active.
// Logs environment, API base URL, and a masked key prefix so it's safe for logs.
export function logMayarEnvironment(env) {
  const apiKey = getMayarApiKey(env);
  console.log(JSON.stringify({
    event: 'mayar_env_active',
    environment: env.ENVIRONMENT ?? 'sandbox',
    apiUrl: getMayarApiUrl(env),
    key_present: !!apiKey,
    key_prefix: apiKey ? apiKey.substring(0, 3) + '…' : null,
  }));
}

export async function createMayarInvoice(sessionId, tier, env, redirectUrl, customerEmail = null, _couponCode = null) {
  // _couponCode is accepted for callers that pass it, but not forwarded to Mayar.
  // couponCode is not a documented invoice/payment creation field — passing unknown
  // fields risks a 400 from Mayar that would break payment for all coupon users.
  // The coupon is applied by the user on Mayar's own checkout page.
  const tierConfig = TIER_PRICES[tier];
  if (!tierConfig) throw new Error('Tier tidak valid');

  const apiUrl = getMayarApiUrl(env);
  const apiKey = getMayarApiKey(env);

  logMayarEnvironment(env);

  if (!apiKey) throw new Error('Mayar API key tidak tersedia');

  const shortId = sessionId.replace('sess_', '').substring(0, 8);
  // Mayar enforces a 55-char maximum on the email field. Fall back to a session-scoped
  // address when the customer's email exceeds that limit rather than letting Mayar
  // reject the entire invoice creation with a 400 Validation Error.
  const email = (customerEmail && typeof customerEmail === 'string' && customerEmail.includes('@') && customerEmail.length <= 55)
    ? customerEmail
    : `user+${shortId}@gaslamar.com`;

  // Use a per-session fake mobile derived from the session shortId to avoid all
  // payment requests sharing a single phone number (which could trigger Mayar fraud detection).
  const fakeMobile = '0800' + shortId.replace(/[^0-9]/g, '0').slice(0, 7).padStart(7, '0');

  // Create Single Payment Request uses /payment/create with a flat amount payload.
  // Invoice-style line items belong to /invoice/create and break the sandbox payment flow.
  // Payment request expires 7 days from now so users have time to complete checkout
  // without leaving stale open requests in Mayar indefinitely.
  const expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const paymentBody = {
    name: `GasLamar User ${shortId}`,
    email,
    mobile: fakeMobile,
    amount: tierConfig.amount,
    description: `${tierConfig.label} — GasLamar.com`,
    redirectUrl,
    expiredAt,
  };

  const endpoint = `${apiUrl}/payment/create`;
  console.log(JSON.stringify({ event: 'mayar_request', endpoint, tier, amount: tierConfig.amount }));
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(paymentBody),
  });

  if (res.status === 404) {
    const errBody = await res.text().catch(() => '');
    console.error(JSON.stringify({
      event: 'MAYAR_ENDPOINT_NOT_FOUND',
      endpoint,
      diagnosis: 'Mayar returned 404 — verify the Mayar payment/create endpoint, API key, and base URL.',
      key_prefix: apiKey ? apiKey.substring(0, 6) + '…' : null,
      body: errBody.substring(0, 300),
    }));
    throw new MayarError('Integrasi pembayaran belum dikonfigurasi. Hubungi support@gaslamar.com', 404);
  }

  if (res.status === 401) {
    const errBody = await res.text().catch(() => '');
    console.error(JSON.stringify({ event: 'MAYAR_INVALID_API_KEY', endpoint, key_prefix: apiKey ? apiKey.substring(0, 6) + '…' : null, body: errBody.substring(0, 300) }));
    throw new MayarError('API key Mayar tidak valid. Hubungi support@gaslamar.com', 401);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    let errMsg;
    try {
      const errJson = JSON.parse(errBody);
      errMsg = (typeof errJson.messages === 'string' ? errJson.messages : errJson.messages?.[0]) || errJson.message || `Mayar error: ${res.status}`;
    } catch {
      errMsg = `Mayar error: ${res.status}`;
    }
    console.error(JSON.stringify({ event: 'mayar_error', endpoint, status: res.status, key_prefix: apiKey ? apiKey.substring(0, 6) + '…' : null, body: errBody.substring(0, 500) }));
    throw new MayarError(errMsg, res.status);
  }

  const data = await res.json();
  // Log full response (inner data object) so we can diagnose missing URL fields.
  console.log(JSON.stringify({
    event: 'mayar_success',
    endpoint,
    data_keys: Object.keys(data),
    data_inner_keys: data.data ? Object.keys(data.data) : null,
    data_inner: data.data ?? null,
  }));

  // Mayar API has returned the payment request ID under different field names across versions;
  // keep the external name invoice_id so the surrounding session/index code remains stable.
  const invoice_id  = data.data?.id || data.data?.invoice_id || data.id || data.invoice_id;
  // Mayar's webhook sends data.id = data.transactionId in some flows, which can differ from
  // the payment request ID returned here. Capture it so createPayment.js can store both indexes.
  const transaction_id = data.data?.transactionId || data.data?.transaction_id || data.transactionId || data.transaction_id || null;
  const invoice_url =
    data.data?.link         || data.data?.url          || data.data?.payment_url  ||
    data.data?.checkout_url || data.data?.invoice_url  || data.data?.paymentLink  ||
    data.link               || data.url                || data.payment_url        ||
    data.checkout_url       || data.invoice_url        || data.paymentLink;

  if (!invoice_url) {
    // Payment request was created on Mayar but no checkout URL was returned.
    // Return the ID so the caller can consume cv_text_key and prevent duplicates;
    // caller must return an error to the user.
    console.error(JSON.stringify({ event: 'mayar_no_url', endpoint, invoice_id, data_keys: Object.keys(data), data_inner_keys: data.data ? Object.keys(data.data) : [] }));
    return { invoice_id, transaction_id, invoice_url: null };
  }

  return { invoice_id, transaction_id, invoice_url };
}

// Validate a coupon code against a tier's price.
// Mayar documents this as GET /coupon/validate — params go in the query string because
// the Fetch API spec forbids bodies on GET requests (throws TypeError).
export async function validateCoupon(env, couponCode, finalAmount, customerEmail) {
  const apiUrl = getMayarApiUrl(env);
  const apiKey = getMayarApiKey(env);
  if (!apiKey) throw new Error('Mayar API key tidak tersedia');

  const params = new URLSearchParams({ couponCode, finalAmount: String(finalAmount) });
  if (customerEmail) params.set('customerEmail', customerEmail);

  const res = await fetch(`${apiUrl}/coupon/validate?${params}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let errMsg;
    try {
      const errJson = JSON.parse(errText);
      errMsg = (typeof errJson.messages === 'string' ? errJson.messages : errJson.messages?.[0]) || errJson.message || `Coupon error: ${res.status}`;
    } catch {
      errMsg = `Coupon error: ${res.status}`;
    }
    throw new Error(errMsg);
  }

  return res.json();
}

export async function verifyMayarWebhook(request, env) {
  const body = await request.text();
  const secret = env.MAYAR_WEBHOOK_SECRET;

  // Fail-closed: if ENVIRONMENT is not explicitly set in the deploy, block all webhooks.
  // An undefined ENVIRONMENT would otherwise evaluate as non-production (isSandbox=true)
  // and bypass HMAC when no secret is configured, accepting unauthenticated payloads.
  if (env.ENVIRONMENT === undefined) {
    console.error(JSON.stringify({ event: 'webhook_misconfigured', reason: 'ENVIRONMENT_not_set' }));
    return { valid: false, body };
  }

  const isSandbox = env.ENVIRONMENT !== 'production';

  // Fail closed if no secret is configured in any environment — including sandbox.
  // Previously, sandbox without a secret bypassed all auth (forged payloads accepted).
  // Now: require a secret everywhere; sandbox still allows through when no auth header
  // is present (Mayar simulator omits auth), but only after the secret check passes.
  if (!secret) {
    console.error(JSON.stringify({ event: 'webhook_no_secret_configured', environment: env.ENVIRONMENT }));
    return { valid: false, body };
  }

  // Mayar sandbox sends x-callback-token (simple bearer) instead of x-mayar-signature (HMAC).
  // In non-production, validate the token against the secret when present.
  // secret is guaranteed set here (isSandbox && !secret already returned above).
  if (isSandbox) {
    const callbackToken = request.headers.get('x-callback-token') || request.headers.get('X-Callback-Token');
    if (callbackToken !== null) {
      const tokenBytes = new TextEncoder().encode(callbackToken);
      const secretBytes = new TextEncoder().encode(secret);
      let diff = tokenBytes.length ^ secretBytes.length;
      const maxLen = Math.max(tokenBytes.length, secretBytes.length);
      for (let i = 0; i < maxLen; i++) diff |= (tokenBytes[i] ?? 0) ^ (secretBytes[i] ?? 0);
      if (diff !== 0) {
        console.error(JSON.stringify({ event: 'webhook_unauthorized', reason: 'callback_token_mismatch', environment: env.ENVIRONMENT }));
      }
      return { valid: diff === 0, body };
    }

    // Neither x-callback-token nor x-mayar-signature is present.
    // Mayar sandbox does not consistently send authentication headers when triggered
    // from the simulator or test mode. We cannot verify what was not sent, so allow
    // through with a warning. A signature that IS present but wrong is still rejected
    // (x-mayar-signature path falls through to HMAC below).
    // Production always requires HMAC — this branch is sandbox-only.
    const hasSig = !!(request.headers.get('x-mayar-signature') || request.headers.get('X-Mayar-Signature'));
    if (!hasSig) {
      console.warn(JSON.stringify({ event: 'webhook_sandbox_no_auth_header', environment: env.ENVIRONMENT }));
      return { valid: true, body };
    }
  }

  const signature = request.headers.get('x-mayar-signature') || request.headers.get('X-Mayar-Signature');
  if (!signature) {
    console.error(JSON.stringify({ event: 'webhook_unauthorized', reason: 'missing_signature', environment: env.ENVIRONMENT ?? 'sandbox' }));
    return { valid: false, body };
  }

  // HMAC-SHA256 verification — only reached in production or when secret is explicitly set in staging
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to prevent timing attacks.
  // Never short-circuit on length: XOR each expected byte against the
  // corresponding sig byte (0 when sig is shorter) and OR in the length
  // difference so mismatched lengths always yield diff !== 0.
  const sigLower = signature.toLowerCase();
  const sigBytes = new TextEncoder().encode(sigLower);
  const expBytes = new TextEncoder().encode(expected);
  let diff = sigBytes.length ^ expBytes.length;
  for (let i = 0; i < expBytes.length; i++) diff |= (sigBytes[i] ?? 0) ^ expBytes[i];
  if (diff !== 0) {
    console.error(JSON.stringify({ event: 'webhook_unauthorized', reason: 'signature_mismatch', environment: env.ENVIRONMENT ?? 'sandbox' }));
  }
  return { valid: diff === 0, body };
}
