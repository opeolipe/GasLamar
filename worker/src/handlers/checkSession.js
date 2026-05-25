import { jsonResponse } from '../cors.js';
import { log, logError, clientIp } from '../utils.js';
import { getSession, getSessionTtl } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { checkRateLimit, checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';

export async function handleCheckSession(request, env) {
  const cookieSessionId = getSessionIdFromCookie(request);
  const ip              = clientIp(request);

  // Primary auth: HttpOnly session cookie. Do not accept session IDs in query
  // parameters; URLs are copied to browser history, logs, and Referer headers.
  const sessionId      = cookieSessionId;
  const ua             = request.headers.get('user-agent') || '';
  const uaFamily       = /Safari/.test(ua) && !/Chrome|Chromium|CriOS/.test(ua)
    ? 'safari'
    : /Chrome|Chromium|CriOS/.test(ua)
      ? 'chromium'
      : /Firefox|FxiOS/.test(ua)
        ? 'firefox'
        : 'other';

  // Primary: CF native binding (atomic, no TOCTOU). Secondary: KV-based counter as backup.
  // Both must allow the request — 20 req/min per IP.
  const [cfAllowed, kvResult] = await Promise.all([
    checkRateLimit(env, env.RATE_LIMITER_CHECK_SESSION, ip),
    checkRateLimitKV(env, ip, 20, 60, 'check_session'),
  ]);
  if (!cfAllowed || !kvResult.allowed) {
    const retryAfter = !kvResult.allowed ? (kvResult.retryAfter ?? 60) : 60;
    logError('check_session_rate_limited', { ip, retry_after: retryAfter });
    return rateLimitResponse(request, env, retryAfter);
  }

  // Track total check-session calls for abuse/debug visibility.
  log('check_session_request', {
    mode: 'cookie',
    ip,
    has_cookie: !!cookieSessionId,
    auth: 'cookie',
    ua_family: uaFamily,
  });

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_session' }, 401, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  // Return TTL remaining in seconds instead of an absolute timestamp to avoid
  // exposing precise creation time; clients only need to know how much time is left.
  const ttlSecs = session.created_at
    ? Math.max(0, Math.floor((session.created_at + getSessionTtl(session) * 1000 - Date.now()) / 1000))
    : null;

  return jsonResponse({
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
    ttl_seconds: ttlSecs,
  }, 200, request, env);
}
