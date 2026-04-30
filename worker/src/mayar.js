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
    key_prefix: apiKey ? apiKey.substring(0, 6) + '…' : null,
  }));
}

export async function createMayarInvoice(sessionId, tier, env, redirectUrl, customerEmail = null) {
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
      console.error(JSON.stringify({ event: 'mayar_no_url', endpoint, data_keys: Object.keys(data), data_inner_keys: data.data ? Object.keys(data.data) : [] }));
      throw new Error('Mayar tidak mengembalikan URL pembayaran. Hubungi support@gaslamar.com');
    }

    return { invoice_id, invoice_url };
  }

  throw new Error('Pembayaran belum tersedia. Hubungi support@gaslamar.com');
}

export async function verifyMayarWebhook(request, env) {
  const signature = request.headers.get('x-mayar-signature') || request.headers.get('X-Mayar-Signature');
  if (!signature) return { valid: false, body: null };

  const body = await request.text();
  const secret = env.MAYAR_WEBHOOK_SECRET;

  if (!secret) {
    // In sandbox without secret, log and allow
    if (env.ENVIRONMENT !== 'production') return { valid: true, body };
    return { valid: false, body };
  }

  // HMAC-SHA256 verification
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
  const valid = diff === 0;
  return { valid, body };
}
