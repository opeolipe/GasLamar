import { jsonResponse }                        from '../cors.js';
import { getSession }                          from '../sessions.js';
import { clientIp, log, logError, sha256Full } from '../utils.js';
import { checkRateLimitKV }                    from '../rateLimit.js';
import { sendPaymentConfirmationEmail }        from '../email.js';

const EMAIL_REGEX   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAID_STATUSES = new Set(['paid', 'generating', 'done']);

// Always returned — never reveal whether an email or session exists.
const GENERIC_OK = { success: true, message: 'Jika email terdaftar, link baru telah dikirim.' };

export async function handleResendAccess(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ message: 'Request tidak valid.' }, 400, request, env); }

  const rawEmail = typeof body.email === 'string' ? body.email.trim() : null;
  if (!rawEmail || !EMAIL_REGEX.test(rawEmail) || rawEmail.length > 254) {
    return jsonResponse({ message: 'Format email tidak valid.' }, 400, request, env);
  }
  const email = rawEmail.toLowerCase();
  const ip    = clientIp(request);

  // Dual-layer rate limiting — silent on both to avoid enumeration.
  // Per-email: 2 per hour. Per-IP: 10 per hour (catches credential stuffing).
  const rlEmail = await checkRateLimitKV(env, email, 2, 3600, 'resend_access');
  if (!rlEmail.allowed) {
    log('resend_access_attempt', { email_hash: (await sha256Full(email)).slice(0, 16), rateLimited: true, ip });
    return jsonResponse(GENERIC_OK, 200, request, env);
  }
  const rlIp = await checkRateLimitKV(env, ip, 10, 3600, 'resend_access_ip');
  if (!rlIp.allowed) {
    log('resend_access_attempt', { email_hash: (await sha256Full(email)).slice(0, 16), rateLimited: true, ip });
    return jsonResponse(GENERIC_OK, 200, request, env);
  }

  const emailHash = (await sha256Full(email)).slice(0, 16);

  const indexRaw = await env.GASLAMAR_SESSIONS.get(`email_session_${email}`, { type: 'json' });
  if (!indexRaw?.session_id) {
    log('resend_access_attempt', { email_hash: emailHash, hasSession: false, rateLimited: false, ip });
    return jsonResponse(GENERIC_OK, 200, request, env);
  }

  const session = await getSession(env, indexRaw.session_id);
  if (!session || !PAID_STATUSES.has(session.status)) {
    log('resend_access_attempt', { email_hash: emailHash, hasSession: false, rateLimited: false, ip });
    return jsonResponse(GENERIC_OK, 200, request, env);
  }

  log('resend_access_attempt', { email_hash: emailHash, hasSession: true, rateLimited: false, ip });

  try {
    await sendPaymentConfirmationEmail(indexRaw.session_id, env);
    log('resend_access_sent', { email_hash: emailHash, ip });
  } catch (e) {
    logError('resend_access_email_failed', { error: e.message });
  }

  return jsonResponse(GENERIC_OK, 200, request, env);
}
