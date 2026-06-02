import { jsonResponse }                        from '../cors.js';
import { getSession }                          from '../sessions.js';
import { clientIp, log, logError, sha256Hex } from '../utils.js';
import { checkRateLimit, checkRateLimitKV, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';
import { sendResendAccessEmail }               from '../email.js';
import { SESSION_STATES }                      from '../sessionStates.js';

const EMAIL_REGEX   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// All post-payment states — ready and exhausted still have accessible CV results.
const PAID_STATUSES = new Set([
  SESSION_STATES.PAID,
  SESSION_STATES.GENERATING,
  SESSION_STATES.READY,
  SESSION_STATES.EXHAUSTED,
]);

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

  // Atomic burst guard — native CF rate limiter, no TOCTOU race.
  // Checked before any KV work to short-circuit quickly on burst abuse.
  if (!await checkRateLimit(env, env.RATE_LIMITER_RESEND_ACCESS, ip)) {
    log('resend_access_attempt', { rateLimited: true, ip, reason: 'cf_burst' });
    return rateLimitResponse(request, env, 60);
  }

  // Per-IP KV check before hashing email — cheaper and guards credential stuffing first.
  const rlIp = await checkRateLimitKV(env, ip, 10, 3600, 'resend_access_ip');
  if (!rlIp.allowed) {
    log('resend_access_attempt', { rateLimited: true, ip });
    return rateLimitResponse(request, env, rlIp.retryAfter ?? 3600, rlIp);
  }

  // Hash email for rate-limit key and index lookup (avoids plaintext PII in KV key space).
  const emailHash = await sha256Hex(email);
  // Per-email: 3 per hour. Counter increments before session lookup, so 429 is safe here —
  // both registered and unregistered emails hit the limit at exactly the same rate.
  const rlEmail = await checkRateLimitKV(env, emailHash, 3, 3600, 'resend_access');
  if (!rlEmail.allowed) {
    log('resend_access_attempt', { email_hash: emailHash.slice(0, 16), rateLimited: true, ip });
    return rateLimitResponse(request, env, rlEmail.retryAfter ?? 3600, rlEmail);
  }
  const withRl = res => addRateLimitHeaders(res, rlEmail);

  // Look up hashed key first; fall back to legacy plaintext key for pre-migration sessions.
  let indexRaw = await env.GASLAMAR_SESSIONS.get(`email_session_${emailHash}`, { type: 'json' });
  if (!indexRaw) {
    indexRaw = await env.GASLAMAR_SESSIONS.get(`email_session_${email}`, { type: 'json' });
    if (indexRaw) {
      console.warn(JSON.stringify({ event: 'resend_access_legacy_key_used', email_hash: emailHash.slice(0, 8) }));
    }
  }
  // Support both old { session_id } and new { session_ids } format.
  // Deduplicate: overlapping legacy+hashed keys for the same email could produce duplicate IDs.
  const sessionIds = [...new Set(indexRaw?.session_ids ?? (indexRaw?.session_id ? [indexRaw.session_id] : []))];

  if (!sessionIds.length) {
    log('resend_access_attempt', { email_hash: emailHash.slice(0, 16), hasSession: false, rateLimited: false, ip });
    return withRl(jsonResponse(GENERIC_OK, 200, request, env));
  }

  // Find every session that still exists and is paid — send one email per active session.
  // Cap at 3 to avoid sending a flood if someone has many old purchases.
  const activeIds = [];
  for (const id of sessionIds) {
    const session = await getSession(env, id);
    if (session && PAID_STATUSES.has(session.status)) activeIds.push(id);
  }

  if (!activeIds.length) {
    log('resend_access_attempt', { email_hash: emailHash.slice(0, 16), hasSession: false, rateLimited: false, ip });
    return withRl(jsonResponse(GENERIC_OK, 200, request, env));
  }

  log('resend_access_attempt', { email_hash: emailHash.slice(0, 16), hasSession: true, count: activeIds.length, rateLimited: false, ip });

  const toSend = activeIds.slice(0, 3);
  for (const id of toSend) {
    try {
      await sendResendAccessEmail(id, env);
    } catch (e) {
      logError('resend_access_email_failed', { error: e.message });
    }
  }
  log('resend_access_sent', { email_hash: emailHash.slice(0, 16), count: toSend.length, capped: activeIds.length > 3, ip });

  return jsonResponse(GENERIC_OK, 200, request, env);
}
