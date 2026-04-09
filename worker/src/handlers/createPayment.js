import { jsonResponse } from '../cors.js';
import { clientIp, sha256Full, log } from '../utils.js';
import { checkRateLimit, rateLimitResponse } from '../rateLimit.js';
import { TIER_CREDITS } from '../constants.js';
import { createMayarInvoice } from '../mayar.js';
import { createSession } from '../sessions.js';

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

  const { tier, cv_text_key, email: rawEmail, session_secret: rawSecret } = body;

  // Optional email — basic validation, silently ignore if malformed
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const sessionEmail = (rawEmail && typeof rawEmail === 'string' && emailRegex.test(rawEmail) && rawEmail.length <= 254)
    ? rawEmail.toLowerCase().trim()
    : null;

  if (!tier || !cv_text_key) {
    return jsonResponse({ message: 'Data tidak lengkap' }, 400, request, env);
  }

  if (!['coba', 'single', '3pack', 'jobhunt'].includes(tier)) {
    return jsonResponse({ message: 'Tier tidak valid' }, 400, request, env);
  }

  // Look up extracted CV text from KV (set by /analyze) — never re-extract
  if (!cv_text_key.startsWith('cvtext_')) {
    return jsonResponse({ message: 'cv_text_key tidak valid' }, 400, request, env);
  }
  const stored = await env.GASLAMAR_SESSIONS.get(cv_text_key, { type: 'json' });
  if (!stored || !stored.text) {
    return jsonResponse({ message: 'Sesi analisis kedaluwarsa. Ulangi upload CV.' }, 400, request, env);
  }

  // IP-binding check — reject if the key was created from a different network.
  // stored.ip is absent on entries written before this check was added; those pass through.
  if (stored.ip && stored.ip !== ip) {
    log('cvtext_ip_mismatch', { ip, stored_ip: stored.ip });
    return jsonResponse({ message: 'Sesi tidak valid dari jaringan ini. Ulangi upload CV.' }, 403, request, env);
  }

  // Create session
  const sessionId = `sess_${crypto.randomUUID()}`;

  const credits = TIER_CREDITS[tier] ?? 1;

  // Compute secret hash — only store it if the client provided a secret
  const secretHash = (rawSecret && typeof rawSecret === 'string' && rawSecret.length <= 256)
    ? await sha256Full(rawSecret)
    : null;

  try {
    // Create Mayar invoice first — if this fails, cv_text_key is still intact and user can retry
    const { invoice_id, invoice_url } = await createMayarInvoice(sessionId, tier, env);

    // Consume cv_text_key only after invoice is successfully created (atomic enough for this use case)
    await env.GASLAMAR_SESSIONS.delete(cv_text_key);

    // Store session in KV using pre-extracted text from /analyze
    await createSession(env, sessionId, {
      cv_text: stored.text,
      job_desc: stored.job_desc,
      tier,
      status: 'pending',
      mayar_invoice_id: invoice_id,
      credits_remaining: credits,
      total_credits: credits,
      ip,
      ...(sessionEmail ? { email: sessionEmail } : {}),
      ...(secretHash ? { session_secret_hash: secretHash } : {}),
    });

    return jsonResponse({ session_id: sessionId, invoice_url }, 200, request, env);
  } catch (e) {
    console.error(JSON.stringify({ event: 'create_payment_failed', error: e.message, tier, cv_text_key }));
    return jsonResponse({ message: e.message || 'Gagal membuat invoice' }, 500, request, env);
  }
}
