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
  // Support both old { session_id } and new { session_ids } format
  const sessionIds = indexRaw?.session_ids ?? (indexRaw?.session_id ? [indexRaw.session_id] : []);

  if (!sessionIds.length) {
    log('resend_access_attempt', { email_hash: emailHash, hasSession: false, rateLimited: false, ip });
    return jsonResponse(GENERIC_OK, 200, request, env);
  }

  // Find every session that still exists and is paid — send one email per active session.
  // Cap at 3 to avoid sending a flood if someone has many old purchases.
  const activeIds = [];
  for (const id of sessionIds) {
    const session = await getSession(env, id);
    if (session && PAID_STATUSES.has(session.status)) activeIds.push(id);
  }

  if (!activeIds.length) {
    log('resend_access_attempt', { email_hash: emailHash, hasSession: false, rateLimited: false, ip });
    return jsonResponse(GENERIC_OK, 200, request, env);
  }

  log('resend_access_attempt', { email_hash: emailHash, hasSession: true, count: activeIds.length, rateLimited: false, ip });

  for (const id of activeIds.slice(0, 3)) {
    try {
      await sendPaymentConfirmationEmail(id, env, {
        subject: 'Akses ulang CV kamu — GasLamar',
        heading: 'Klik link di bawah untuk kembali ke CV kamu:',
      });
    } catch (e) {
      logError('resend_access_email_failed', { error: e.message });
    }
  }
  log('resend_access_sent', { email_hash: emailHash, count: activeIds.length, ip });

  return jsonResponse(GENERIC_OK, 200, request, env);
}
