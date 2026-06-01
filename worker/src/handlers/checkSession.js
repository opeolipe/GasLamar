import { jsonResponse } from '../cors.js';
import { log, logError, clientIp } from '../utils.js';
import { getSession, getSessionTtl } from '../sessions.js';
import { getSessionIdFromCookie, getCvKeyFromCookie } from '../cookies.js';
import { checkRateLimit, checkRateLimitKVSession, rateLimitResponse } from '../rateLimit.js';

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

  // Primary: CF native binding (atomic, no TOCTOU). Secondary: KV sliding window.
  // Authenticated callers (valid session cookie) get 30 req/min; IP-only get 10 req/min.
  const [cfAllowed, kvResult] = await Promise.all([
    checkRateLimit(env, env.RATE_LIMITER_CHECK_SESSION, ip),
    checkRateLimitKVSession(env, ip, cookieSessionId, 10, 30, 60, 'check_session'),
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
    // No payment session cookie — check for an active analysis session (cv_key cookie).
    // This lets /hasil validate the HttpOnly cv_key without a separate endpoint.
    const cvKey = getCvKeyFromCookie(request);
    if (cvKey) {
      const stored = await env.GASLAMAR_SESSIONS.get(cvKey, { type: 'json' });
      if (stored?.scoring) {
        log('check_session_analysis_valid', { ip });
        return jsonResponse({ valid: true, authenticated: true, type: 'analysis' }, 200, request, env);
      }
      // cv_key cookie present but session gone from KV (expired or migrated to scoring_)
      const fallbackKey = `scoring_${cvKey.slice('cvtext_'.length)}`;
      const fallback = await env.GASLAMAR_SESSIONS.get(fallbackKey, { type: 'json' });
      if (fallback?.scoring) {
        log('check_session_analysis_valid_fallback', { ip });
        return jsonResponse({ valid: true, authenticated: true, type: 'analysis' }, 200, request, env);
      }
      // cv_key cookie exists but data is gone — expired
      return jsonResponse({ valid: false, authenticated: false, reason: 'expired', message: 'Sesi analisis sudah kedaluwarsa.' }, 200, request, env);
    }
    // Return 200 (not 401) so browsers don't log a console error on pages where an
    // unauthenticated check is expected (upload, hasil, analyzing). 401 is reserved
    // for requests that supply a token that is invalid or expired.
    return jsonResponse({ valid: false, authenticated: false, reason: 'no_session', message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.' }, 200, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ valid: false, message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  // Return TTL remaining in seconds instead of an absolute timestamp to avoid
  // exposing precise creation time; clients only need to know how much time is left.
  const ttlSecs = session.created_at
    ? Math.max(0, Math.floor((session.created_at + getSessionTtl(session) * 1000 - Date.now()) / 1000))
    : null;

  return jsonResponse({
    valid: true,
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
    ttl_seconds: ttlSecs,
  }, 200, request, env);
}
