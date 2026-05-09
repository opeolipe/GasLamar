import { jsonResponseWithCookie } from '../cors.js';
import { jsonResponse } from '../cors.js';
import { clientIp, sha256Full, log } from '../utils.js';
import { checkRateLimit, rateLimitResponse } from '../rateLimit.js';
import { TIER_CREDITS, SESSION_TTL_MULTI, VALID_TIERS } from '../constants.js';
import { createMayarInvoice, logMayarEnvironment } from '../mayar.js';
import { createSession } from '../sessions.js';
import { makeSessionCookie } from '../cookies.js';

export async function handleCreatePayment(request, env) {
  const ip = clientIp(request);

  const allowed = await checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip);
  if (!allowed) {
    return rateLimitResponse(request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { tier, cv_text_key, email: rawEmail, session_secret: rawSecret, coupon_code: rawCoupon } = body;

  // Sanitize coupon code — uppercase, strip non-alphanumeric, max 64 chars
  const couponCode = (rawCoupon && typeof rawCoupon === 'string')
    ? rawCoupon.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').substring(0, 64) || null
    : null;

  // Optional email — basic validation, silently ignore if malformed
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const sessionEmail = (rawEmail && typeof rawEmail === 'string' && emailRegex.test(rawEmail) && rawEmail.length <= 254)
    ? rawEmail.toLowerCase().trim()
    : null;

  // Validate tier first — gives a specific rejection for unknown tiers regardless of
  // whether cv_text_key is also missing, preventing the ambiguous "Data tidak lengkap"
  // response that would otherwise mask an invalid tier name.
  if (!tier || !VALID_TIERS.includes(tier)) {
    return jsonResponse({ message: 'Tier tidak valid' }, 400, request, env);
  }

  if (!cv_text_key) {
    return jsonResponse({ message: 'Data tidak lengkap' }, 400, request, env);
  }

  // Look up extracted CV text from KV (set by /analyze) — never re-extract
  if (!cv_text_key.startsWith('cvtext_')) {
    return jsonResponse({ message: 'cv_text_key tidak valid' }, 400, request, env);
  }
  const stored = await env.GASLAMAR_SESSIONS.get(cv_text_key, { type: 'json' });
  if (!stored || !stored.text) {
    // M22: Include a stable machine-readable code so the client can branch on it
    // without depending on the Indonesian message text (which can change).
    return jsonResponse({ message: 'Sesi analisis kedaluwarsa. Ulangi upload CV.', code: 'cv_expired' }, 400, request, env);
  }

  // IP-binding check — reject if the key was created from a different network.
  // stored.ip is absent on entries written before this check was added; those pass through.
  if (stored.ip && stored.ip !== ip) {
    log('cvtext_ip_mismatch', { ip, stored_ip: stored.ip });
    return jsonResponse({ message: 'Sesi tidak valid dari jaringan ini. Ulangi upload CV.' }, 403, request, env);
  }

  // Idempotency: prevent duplicate invoices from rapid concurrent requests.
  // cv_text_key is single-use (deleted after invoice creation); a KV lock with a short
  // TTL ensures only one request reaches the Mayar API per cv_text_key.
  const invoiceLockKey = `invoice_lock_${cv_text_key}`;
  const existingLock = await env.GASLAMAR_SESSIONS.get(invoiceLockKey);
  if (existingLock) {
    return jsonResponse({ message: 'Permintaan sedang diproses. Coba lagi sebentar.' }, 409, request, env);
  }
  await env.GASLAMAR_SESSIONS.put(invoiceLockKey, '1', { expirationTtl: 60 }); // KV minimum TTL is 60s

  // Create session
  const sessionId = `sess_${crypto.randomUUID()}`;

  const credits = TIER_CREDITS[tier] ?? 1;

  // Compute secret hash — only store it if the client provided a secret
  const secretHash = (rawSecret && typeof rawSecret === 'string' && rawSecret.length <= 256)
    ? await sha256Full(rawSecret)
    : null;

  // Validate Mayar API key before creating a session (gives a clear 503 instead of a
  // cryptic Mayar error when the secret is absent in staging/sandbox).
  const mayarKey = env.ENVIRONMENT === 'production' ? env.MAYAR_API_KEY : env.MAYAR_API_KEY_SANDBOX;
  if (!mayarKey) {
    console.error(JSON.stringify({ event: 'create_payment_no_apikey', environment: env.ENVIRONMENT ?? 'sandbox' }));
    return jsonResponse({ message: 'Layanan pembayaran sedang tidak tersedia. Hubungi support@gaslamar.com.' }, 503, request, env);
  }

  try {
    // Redirect after payment completes — points to the right frontend per environment.
    // ENVIRONMENT = "staging"    → staging.gaslamar.pages.dev
    // ENVIRONMENT = "production" → gaslamar.com  (and everything else)
    const redirectUrl = env.ENVIRONMENT === 'staging'
      ? 'https://staging.gaslamar.pages.dev/download.html'
      : 'https://gaslamar.com/download.html';

    logMayarEnvironment(env);
    console.log(JSON.stringify({ event: 'payment_redirect_url', redirectUrl, environment: env.ENVIRONMENT ?? 'sandbox' }));

    // Create Mayar invoice first — if this fails, cv_text_key is still intact and user can retry
    const { invoice_id, invoice_url } = await createMayarInvoice(sessionId, tier, env, redirectUrl, sessionEmail, couponCode);

    if (invoice_id) {
      // Invoice was committed on Mayar's side (with or without a redirect URL).
      // Consume cv_text_key immediately so a retry cannot create a second Mayar invoice
      // for the same analysis session, which would spam the customer with duplicate
      // "Transaksi telah dibuat" emails.
      await env.GASLAMAR_SESSIONS.delete(cv_text_key);

      // Store session so the Mayar webhook can complete it even if we don't redirect now.
      const sessionData = {
        cv_text: stored.text,
        job_desc: stored.job_desc,
        // Carry inferred_role through to /generate so it can choose tailoring mode.
        inferred_role: stored.inferred_role ?? null,
        tier,
        status: 'pending',
        mayar_invoice_id: invoice_id,
        credits_remaining: credits,
        total_credits: credits,
        ip,
        ...(sessionEmail ? { email: sessionEmail } : {}),
        ...(secretHash ? { session_secret_hash: secretHash } : {}),
      };
      await createSession(env, sessionId, sessionData);

      // Secondary KV index: invoice_id → session_id.
      // The Mayar webhook identifies payments by invoice ID; without the ?session= query
      // param in the redirect URL we need this index to correlate the webhook to a session.
      // TTL matches the session (7d single / 30d multi).
      await env.GASLAMAR_SESSIONS.put(
        `mayar_session_${invoice_id}`,
        JSON.stringify({ session_id: sessionId }),
        { expirationTtl: credits > 1 ? 2592000 : 604800 }
      );
    }

    if (!invoice_url) {
      // Invoice may or may not have been created — either way, cannot redirect.
      // Do NOT release the invoice lock; do NOT allow retry with the same cv_text_key.
      console.error(JSON.stringify({ event: 'create_payment_no_url', tier, invoice_id: invoice_id ?? null }));
      return jsonResponse({ message: 'Link pembayaran tidak tersedia. Hubungi support@gaslamar.com jika sudah melakukan pembayaran.' }, 503, request, env);
    }

    // Email → session index for access recovery (/resend-access).
    // Stored as an array so repeat buyers don't lose access to earlier sessions.
    // No TTL on the index — sessions expire on their own; this just maps email → [ids].
    if (sessionEmail) {
      const indexKey = `email_session_${sessionEmail}`;
      const existing = await env.GASLAMAR_SESSIONS.get(indexKey, { type: 'json' });
      // Support old single-id format from before this change
      const ids = existing?.session_ids ?? (existing?.session_id ? [existing.session_id] : []);
      if (!ids.includes(sessionId)) ids.push(sessionId);
      await env.GASLAMAR_SESSIONS.put(indexKey, JSON.stringify({ session_ids: ids }));
    }

    // Set HttpOnly session cookie — eliminates session_id from URLs (browser history,
    // Referer headers, server logs). Cookie travels automatically with all credentialed
    // requests to this Worker origin.
    const isMulti = credits > 1;
    const cookieHeader = makeSessionCookie(sessionId, isMulti);

    return jsonResponseWithCookie({ session_id: sessionId, invoice_url }, 200, cookieHeader, request, env);
  } catch (e) {
    // Release invoice lock only for errors where Mayar never received the request
    // (network failures, validation errors). This allows the user to retry safely.
    await env.GASLAMAR_SESSIONS.delete(invoiceLockKey).catch(() => {});
    console.error(JSON.stringify({ event: 'create_payment_failed', error: e.message, tier }));
    return jsonResponse({ message: 'Gagal membuat invoice. Coba lagi atau hubungi support@gaslamar.com.' }, 500, request, env);
  }
}
