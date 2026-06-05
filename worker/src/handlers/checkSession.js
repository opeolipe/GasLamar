import { jsonResponse } from '../cors.js';
import { log, logError, clientIp } from '../utils.js';
import { getSession, getSessionTtl } from '../sessions.js';
import { getSessionIdFromCookie, getCvKeyFromCookie, getSessionTokenFromCookie } from '../cookies.js';
import { checkRateLimit, checkRateLimitKVSession, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';

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
  // Authenticated callers (valid session cookie) get 60 req/5 min; IP-only get 30 req/5 min.
  // Window is 5 minutes to accommodate payment-confirmation polling (every 3 s, up to 5 min).
  const [cfAllowed, kvResult] = await Promise.all([
    checkRateLimit(env, env.RATE_LIMITER_CHECK_SESSION, ip),
    checkRateLimitKVSession(env, ip, cookieSessionId, 30, 60, 300, 'check_session'),
  ]);
  if (!cfAllowed || !kvResult.allowed) {
    const retryAfter = !kvResult.allowed ? (kvResult.retryAfter ?? 60) : 60;
    logError('check_session_rate_limited', { ip, retry_after: retryAfter });
    return rateLimitResponse(request, env, retryAfter, kvResult);
  }
  const withRl = res => addRateLimitHeaders(res, kvResult);

  // Track total check-session calls for abuse/debug visibility.
  log('check_session_request', {
    mode: 'cookie',
    ip,
    has_cookie: !!cookieSessionId,
    auth: 'cookie',
    ua_family: uaFamily,
  });

  if (!sessionId || !sessionId.startsWith('sess_')) {
    // No payment session cookie — check for an active analysis session.
    // Prefer the newer sessionToken cookie (UUID → analysis_session_ KV entry);
    // fall back to the legacy cv_key cookie for sessions created before this change.

    const sessionToken = getSessionTokenFromCookie(request);
    if (sessionToken) {
      const session = await env.GASLAMAR_SESSIONS.get(
        `analysis_session_${sessionToken}`,
        { type: 'json' },
      );
      if (session?.resultId) {
        log('check_session_analysis_valid_token', { ip });
        return withRl(jsonResponse(
          { valid: true, status: 'analysis', authenticated: true, type: 'analysis', resultId: session.resultId },
          200,
          request,
          env,
        ));
      }
      // sessionToken cookie exists but the session record is gone (expired)
      return withRl(jsonResponse(
        { valid: false, authenticated: false, reason: 'expired', message: 'Sesi analisis sudah kedaluwarsa.' },
        401,
        request,
        env,
      ));
    }

    // Legacy: cv_key cookie (sessions created before sessionToken was introduced).
    const cvKey = getCvKeyFromCookie(request);
    if (cvKey) {
      const stored = await env.GASLAMAR_SESSIONS.get(cvKey, { type: 'json' });
      if (stored?.scoring) {
        log('check_session_analysis_valid', { ip });
        return withRl(jsonResponse(
          { valid: true, status: 'analysis', authenticated: true, type: 'analysis', resultId: stored.result_id ?? null },
          200,
          request,
          env,
        ));
      }
      // cv_key cookie present but session gone from KV (expired or migrated to scoring_)
      const fallbackKey = `scoring_${cvKey.slice('cvtext_'.length)}`;
      const fallback = await env.GASLAMAR_SESSIONS.get(fallbackKey, { type: 'json' });
      if (fallback?.scoring) {
        log('check_session_analysis_valid_fallback', { ip });
        return withRl(jsonResponse(
          { valid: true, status: 'analysis', authenticated: true, type: 'analysis', resultId: fallback.result_id ?? null },
          200,
          request,
          env,
        ));
      }
      // cv_key cookie exists but data is gone — expired
      return withRl(jsonResponse({ valid: false, authenticated: false, reason: 'expired', message: 'Sesi analisis sudah kedaluwarsa.' }, 200, request, env));
    }
    // Header fallback for browsers that block cross-site cookies (e.g. Safari ITP).
    // The frontend stores the analysisSessionId in sessionStorage after /analyze and
    // resends it as X-Analysis-Session when cookies are absent. Only used for analysis
    // sessions — payment sessions use the exchangeToken flow for cross-device recovery.
    const headerSessionId = request.headers.get('X-Analysis-Session');
    if (headerSessionId) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(headerSessionId)) {
        const session = await env.GASLAMAR_SESSIONS.get(
          `analysis_session_${headerSessionId}`,
          { type: 'json' },
        );
        if (session?.resultId) {
          log('check_session_analysis_valid_header', { ip });
          return withRl(jsonResponse(
            { valid: true, status: 'analysis', authenticated: true, type: 'analysis', resultId: session.resultId },
            200,
            request,
            env,
          ));
        }
      }
      return withRl(jsonResponse(
        { valid: false, authenticated: false, reason: 'expired', message: 'Sesi analisis sudah kedaluwarsa.' },
        401,
        request,
        env,
      ));
    }
    // Return 200 (not 401) so browsers don't log a console error on pages where an
    // unauthenticated check is expected (upload, hasil, analyzing). 401 is reserved
    // for requests that supply a token that is invalid or expired.
    return withRl(jsonResponse({ valid: false, authenticated: false, reason: 'no_session', message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.' }, 200, request, env));
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return withRl(jsonResponse({ valid: false, message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env));
  }

  // Return TTL remaining in seconds instead of an absolute timestamp to avoid
  // exposing precise creation time; clients only need to know how much time is left.
  const ttlSecs = session.created_at
    ? Math.max(0, Math.floor((session.created_at + getSessionTtl(session) * 1000 - Date.now()) / 1000))
    : null;

  return withRl(jsonResponse({
    valid: true,
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
    ttl_seconds: ttlSecs,
  }, 200, request, env));
}
