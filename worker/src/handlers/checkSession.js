import { jsonResponse } from '../cors.js';
import { log, logError, clientIp } from '../utils.js';
import { getSession, getSessionTtl } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';

export async function handleCheckSession(request, env) {
  const url             = new URL(request.url);
  const cookieSessionId = getSessionIdFromCookie(request);
  // Prefer X-Session-Id header (doesn't leak into browser history / server logs).
  // Fall back to ?session= query param for backward compat during rollout.
  const paramSessionId  = request.headers.get('X-Session-Id') || url.searchParams.get('session');
  const ip              = clientIp(request);

  // Primary auth: HttpOnly session cookie. The ?session= path remains as a
  // low-sensitivity compatibility fallback for browsers that lose cookies during
  // the payment redirect; it returns reduced metadata when no cookie is present.
  const usedFallback   = !!paramSessionId && paramSessionId.startsWith('sess_') && !cookieSessionId;
  const queryOnlyFallback = usedFallback && !cookieSessionId;
  const sessionId      = cookieSessionId || (usedFallback ? paramSessionId : null);
  const ua             = request.headers.get('user-agent') || '';
  const uaFamily       = /Safari/.test(ua) && !/Chrome|Chromium|CriOS/.test(ua)
    ? 'safari'
    : /Chrome|Chromium|CriOS/.test(ua)
      ? 'chromium'
      : /Firefox|FxiOS/.test(ua)
        ? 'firefox'
        : 'other';

  // Baseline protection on this frequently-polled endpoint.
  const baseLimit = await checkRateLimitKV(env, ip, 90, 60, 'check_session');
  if (!baseLimit.allowed) {
    logError('check_session_rate_limited', { ip, retry_after: baseLimit.retryAfter ?? 60 });
    return rateLimitResponse(request, env, baseLimit.retryAfter ?? 60);
  }

  // Track total check-session calls so fallback usage % can be measured daily.
  log('check_session_request', {
    mode: usedFallback ? 'fallback' : 'strict',
    ip,
    has_cookie: !!cookieSessionId,
    auth: cookieSessionId ? 'cookie' : 'fallback',
    ua_family: uaFamily,
  });

  if (!sessionId || !sessionId.startsWith('sess_')) {
    if (paramSessionId && !paramSessionId.startsWith('sess_')) {
      logError('check_session_invalid_session_param', { ip, ua_family: uaFamily });
    }
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_session' }, 401, request, env);
  }

  // Extra guard on fallback path (higher abuse potential than strict cookie+secret path).
  if (usedFallback) {
    const fallbackIpLimit = await checkRateLimitKV(env, ip, 30, 60, 'check_session_fallback_ip');
    if (!fallbackIpLimit.allowed) {
      logError('check_session_fallback_abuse', {
        type: 'ip_rate',
        ip,
        retry_after: fallbackIpLimit.retryAfter ?? 60,
        ua_family: uaFamily,
      });
      return rateLimitResponse(request, env, fallbackIpLimit.retryAfter ?? 60);
    }

    const fallbackSessionLimit = await checkRateLimitKV(
      env,
      `${ip}:${sessionId.slice(0, 24)}`,
      20,
      60,
      'check_session_fallback_ip_session'
    );
    if (!fallbackSessionLimit.allowed) {
      logError('check_session_fallback_abuse', {
        type: 'ip_session_rate',
        ip,
        session_hint: sessionId.slice(0, 12),
        retry_after: fallbackSessionLimit.retryAfter ?? 60,
        ua_family: uaFamily,
      });
      return rateLimitResponse(request, env, fallbackSessionLimit.retryAfter ?? 60);
    }
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    if (usedFallback) {
      log('check_session_fallback_outcome', {
        status_code: 404,
        ip,
        ua_family: uaFamily,
      });
    }
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  if (usedFallback) {
    log('session_query_fallback_used', {
      session_id: sessionId,
      status:     session.status,
      is_safari:  uaFamily === 'safari',
      ua:         ua.slice(0, 120),
    });
    log('check_session_fallback_outcome', {
      status_code: 200,
      ip,
      ua_family: uaFamily,
      session_status: session.status,
    });
  }

  // Return TTL remaining in seconds instead of an absolute timestamp to avoid
  // exposing precise creation time; clients only need to know how much time is left.
  const ttlSecs = session.created_at
    ? Math.max(0, Math.floor((session.created_at + getSessionTtl(session) * 1000 - Date.now()) / 1000))
    : null;

  if (queryOnlyFallback) {
    return jsonResponse({
      status: session.status,
      tier: session.tier,
    }, 200, request, env);
  }

  return jsonResponse({
    session_id: sessionId,
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
    ttl_seconds: ttlSecs,
  }, 200, request, env);
}
