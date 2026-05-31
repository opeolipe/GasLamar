import { jsonResponse }                      from '../cors.js';
import { getSession, updateSession }         from '../sessions.js';
import { getSessionIdFromCookie }            from '../cookies.js';
import { clientIp, log, logError, sha256Hex } from '../utils.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';
import { sendCVReadyEmail }                  from '../email.js';
import { SESSION_STATES }                    from '../sessionStates.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Only states that have an accessible CV result — PAID has never had /generate called
// so there is no cv_result_ to attach. Sending a "CV ready" email from PAID state
// would produce an empty email with no attachments.
const PAID_STATUSES = new Set([
  SESSION_STATES.GENERATING,
  SESSION_STATES.READY,
  SESSION_STATES.EXHAUSTED,
]);

const EMAIL_INDEX_TTL = 2592000;

async function getEmailIndex(env, email) {
  const hash = await sha256Hex(email);
  const hashedKey = `email_session_${hash}`;
  const legacyKey = `email_session_${email}`;
  const hashed = await env.GASLAMAR_SESSIONS.get(hashedKey, { type: 'json' });
  if (hashed) return { key: hashedKey, legacyKey, data: hashed, usedLegacy: false };

  const legacy = await env.GASLAMAR_SESSIONS.get(legacyKey, { type: 'json' });
  if (legacy) {
    console.warn(JSON.stringify({
      event: 'email_session_legacy_key_used',
      email_hash: hash.slice(0, 8),
    }));
    return { key: legacyKey, hashedKey, data: legacy, usedLegacy: true };
  }

  return { key: hashedKey, legacyKey, data: null, usedLegacy: false };
}

export async function handleResendEmail(request, env) {
  // Rate limit first — before any KV reads — to short-circuit floods cheaply.
  const ip = clientIp(request);
  const rl = await checkRateLimitKV(env, ip, 5, 60, 'resend_email');
  if (!rl.allowed) {
    return rateLimitResponse(request, env, rl.retryAfter ?? 60);
  }

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
      const oldIndex = await getEmailIndex(env, session.email);
      const oldIds = (oldIndex.data?.session_ids ?? (oldIndex.data?.session_id ? [oldIndex.data.session_id] : []))
        .filter(id => id !== sessionId);
      if (oldIds.length) {
        const retainedKey = oldIndex.usedLegacy ? oldIndex.hashedKey : oldIndex.key;
        await env.GASLAMAR_SESSIONS.put(retainedKey, JSON.stringify({ session_ids: oldIds }), { expirationTtl: EMAIL_INDEX_TTL }).catch(() => {});
      } else {
        await env.GASLAMAR_SESSIONS.delete(oldIndex.key).catch(() => {});
      }
      if (oldIndex.usedLegacy) {
        await env.GASLAMAR_SESSIONS.delete(oldIndex.key).catch(() => {});
      } else {
        await env.GASLAMAR_SESSIONS.delete(oldIndex.legacyKey).catch(() => {});
      }
    }
    const newIndex = await getEmailIndex(env, newEmail);
    const newIds = newIndex.data?.session_ids ?? (newIndex.data?.session_id ? [newIndex.data.session_id] : []);
    if (!newIds.includes(sessionId)) newIds.push(sessionId);
    const newHash = await sha256Hex(newEmail);
    await env.GASLAMAR_SESSIONS.put(`email_session_${newHash}`, JSON.stringify({ session_ids: newIds }), { expirationTtl: EMAIL_INDEX_TTL });
    if (newIndex.usedLegacy) {
      await env.GASLAMAR_SESSIONS.delete(newIndex.key).catch(() => {});
    }
    log('resend_email_changed', { session_id: sessionId, ip });
  }

  try {
    // Resend the CV-ready email (with CV PDF + interview kit attachments if available).
    // Score and gaps are not available at resend time — sendCVReadyEmail handles null gracefully.
    await sendCVReadyEmail(sessionId, null, null, env);
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
