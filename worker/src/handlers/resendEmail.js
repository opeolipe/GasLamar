import { jsonResponse }                      from '../cors.js';
import { getSession, updateSession,
         verifySessionSecret }               from '../sessions.js';
import { getSessionIdFromCookie }            from '../cookies.js';
import { clientIp, log, logError }           from '../utils.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';
import { sendPaymentConfirmationEmail }      from '../email.js';
import { SESSION_STATES }                    from '../sessionStates.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// All post-payment states — ready and exhausted still have accessible CV results.
const PAID_STATUSES = new Set([
  SESSION_STATES.PAID,
  SESSION_STATES.GENERATING,
  SESSION_STATES.READY,
  SESSION_STATES.EXHAUSTED,
]);

export async function handleResendEmail(request, env) {
  const sessionId = getSessionIdFromCookie(request);

  if (!sessionId) {
    return jsonResponse(
      { message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_cookie' },
      401, request, env,
    );
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    return jsonResponse(
      { message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' },
      404, request, env,
    );
  }

  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak.' }, 403, request, env);
  }

  if (!PAID_STATUSES.has(session.status)) {
    return jsonResponse(
      { message: 'Pembayaran belum dikonfirmasi.', reason: 'not_paid' },
      403, request, env,
    );
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ message: 'Request tidak valid.' }, 400, request, env); }

  // Optional new email — when provided, updates the session before sending.
  const rawEmail = typeof body.email === 'string' ? body.email.trim() : null;
  if (rawEmail !== null) {
    if (!EMAIL_REGEX.test(rawEmail) || rawEmail.length > 254) {
      return jsonResponse({ message: 'Format email tidak valid.' }, 400, request, env);
    }
  }
  const newEmail = rawEmail ? rawEmail.toLowerCase() : null;

  // Rate limit: 5 resend attempts per IP per minute.
  const ip = clientIp(request);
  const rl = await checkRateLimitKV(env, ip, 5, 60, 'resend_email');
  if (!rl.allowed) {
    return rateLimitResponse(request, env, rl.retryAfter ?? 60);
  }

  // Persist email change when a new address is supplied.
  if (newEmail && newEmail !== session.email) {
    const ok = await updateSession(env, sessionId, { email: newEmail });
    if (!ok) {
      return jsonResponse(
        { message: 'Sesi tidak ditemukan.', reason: 'expired' },
        404, request, env,
      );
    }
    // Remove this session from the old email's index (leave other sessions under that email intact),
    // then append it to the new email's index.
    if (session.email) {
      const oldKey = `email_session_${session.email}`;
      const oldIndex = await env.GASLAMAR_SESSIONS.get(oldKey, { type: 'json' });
      const oldIds = (oldIndex?.session_ids ?? (oldIndex?.session_id ? [oldIndex.session_id] : []))
        .filter(id => id !== sessionId);
      if (oldIds.length) {
        await env.GASLAMAR_SESSIONS.put(oldKey, JSON.stringify({ session_ids: oldIds })).catch(() => {});
      } else {
        await env.GASLAMAR_SESSIONS.delete(oldKey).catch(() => {});
      }
    }
    const newKey = `email_session_${newEmail}`;
    const newIndex = await env.GASLAMAR_SESSIONS.get(newKey, { type: 'json' });
    const newIds = newIndex?.session_ids ?? (newIndex?.session_id ? [newIndex.session_id] : []);
    if (!newIds.includes(sessionId)) newIds.push(sessionId);
    await env.GASLAMAR_SESSIONS.put(newKey, JSON.stringify({ session_ids: newIds }));
    log('resend_email_changed', { session_id: sessionId, ip });
  }

  try {
    await sendPaymentConfirmationEmail(sessionId, env);
    log('resend_email_sent', { session_id: sessionId, changed: !!newEmail, ip });
  } catch (e) {
    logError('resend_email_failed', { session_id: sessionId, error: e.message });
    return jsonResponse(
      { message: 'Gagal mengirim email. Coba lagi dalam beberapa saat.' },
      500, request, env,
    );
  }

  return jsonResponse({ success: true }, 200, request, env);
}
