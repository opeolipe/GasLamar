import { jsonResponse } from '../cors.js';
import { log, logError, clientIp } from '../utils.js';
import { getSession, getSessionTtl, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';

export async function handleCheckSession(request, env) {
  const url             = new URL(request.url);
  const cookieSessionId = getSessionIdFromCookie(request);
  const paramSessionId  = url.searchParams.get('session');
  const ip              = clientIp(request);

  // Primary auth: cookie + X-Session-Secret.
  // Fallback (no secret check): when ?session= is present AND X-Session-Secret is absent.
  // This covers three real-world scenarios where the secret is unavailable:
  //   (a) Mobile Safari ITP clears sessionStorage during the cross-origin Mayar redirect
  //   (b) User closes the tab and opens a new one (sessionStorage is tab-scoped)
  //   (c) User clicks the email link on a different device (/exchange-token sets the cookie
  //       but the sessionStorage secret is gone on the new browser)
  // /check-session returns only low-sensitivity metadata (status/tier/credits/ttl) so
  // requiring the secret is not necessary for integrity — it only blocks legitimate users.
  const providedSecret = request.headers.get('X-Session-Secret');
  const usedFallback   = !!paramSessionId && paramSessionId.startsWith('sess_') && !providedSecret;
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
    has_secret: !!providedSecret,
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

  // Secret check only applies on the non-fallback path.
  if (!usedFallback) {
    if (!await verifySessionSecret(session, providedSecret)) {
      logError('check_session_secret_mismatch', { ip, ua_family: uaFamily });
      return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid', reason: 'unauthorized' }, 403, request, env);
    }
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

  return jsonResponse({
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
    ttl_seconds: ttlSecs,
  }, 200, request, env);
}
