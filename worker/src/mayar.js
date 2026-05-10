import { TIER_PRICES } from './constants.js';
import { log, logError } from './utils.js';

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
  // Use the customer's real email if provided, otherwise fall back to a session-scoped address.
  const email = (customerEmail && typeof customerEmail === 'string' && customerEmail.includes('@'))
    ? customerEmail
    : `user+${shortId}@gaslamar.com`;

  // Try /invoice/create first (line items), fall back to /payment/create (flat amount)
  // Correct Mayar endpoint paths per Postman collection: /invoice/create and /payment/create
  const invoiceBody = {
    name: `GasLamar User ${shortId}`,
    email,
    mobile: '08000000000',
    description: `${tierConfig.label} — GasLamar.com`,
    redirectUrl,
    items: [{
      quantity: 1,
      rate: tierConfig.amount,
      description: tierConfig.label,
    }],
  };

  const paymentBody = {
    name: `GasLamar User ${shortId}`,
    email,
    mobile: '08000000000',
    amount: tierConfig.amount,
    description: `${tierConfig.label} — GasLamar.com`,
    redirectUrl,
  };

  for (const [endpoint, body] of [
    [`${apiUrl}/invoice/create`, invoiceBody],
    [`${apiUrl}/payment/create`, paymentBody],
  ]) {
    console.log(JSON.stringify({ event: 'mayar_request', endpoint, tier, amount: tierConfig.amount }));
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 404) {
      const errBody = await res.text().catch(() => '');
      console.log(JSON.stringify({ event: 'mayar_404', endpoint, body: errBody.substring(0, 200) }));
      continue;
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
      console.error(JSON.stringify({ event: 'mayar_error', endpoint, status: res.status, body: errBody.substring(0, 500) }));
      throw new Error(errMsg);
    }

    const data = await res.json();
    console.log(JSON.stringify({ event: 'mayar_success', endpoint, data_keys: Object.keys(data) }));

    const invoice_id  = data.data?.id  || data.id;
    // Mayar API has used several field names across versions; check all known variants
    const invoice_url =
      data.data?.link         || data.data?.url          || data.data?.payment_url  ||
      data.data?.checkout_url || data.data?.invoice_url  ||
      data.link               || data.url                || data.payment_url        ||
      data.checkout_url       || data.invoice_url;

    if (!invoice_url) {
      // Invoice was created on Mayar (we got an invoice_id) but no payment URL was returned.
      // Return the invoice_id so the caller can consume cv_text_key and prevent duplicate
      // invoices; caller must return an error to the user.
      console.error(JSON.stringify({ event: 'mayar_no_url', endpoint, invoice_id, data_keys: Object.keys(data), data_inner_keys: data.data ? Object.keys(data.data) : [] }));
      return { invoice_id, invoice_url: null };
    }

    return { invoice_id, invoice_url };
  }

  throw new Error('Pembayaran belum tersedia. Hubungi support@gaslamar.com');
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

  // Sandbox bypass: always skip HMAC in non-production environments.
  // Mayar sandbox (api.mayar.club) behaviour is inconsistent: it sometimes omits
  // the x-mayar-signature header, sometimes sends a signature that doesn't match
  // the configured secret (e.g. when the secret was set after the invoice was
  // created, or when the sandbox uses a different signing key than production).
  // There is no real financial risk in staging so we accept all webhook payloads
  // without signature verification.
  if (isSandbox) {
    return { valid: true, body };
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
