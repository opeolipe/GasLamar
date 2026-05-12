import { jsonResponse } from '../cors.js';
import { log, logError } from '../utils.js';
import { getSession, getSessionTtl, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleCheckSession(request, env) {
  const url             = new URL(request.url);
  const cookieSessionId = getSessionIdFromCookie(request);
  const paramSessionId  = url.searchParams.get('session');

  // Cookie is the primary auth path. When the cookie is absent (common on Mobile
  // Safari due to cross-origin ITP), fall back to the ?session= query param that
  // the frontend already sends on every poll. The param path skips the
  // X-Session-Secret check: the UUID session ID is sufficient for this low-
  // sensitivity endpoint (returns status/tier/credits only — never CV content).
  const usedFallback = !cookieSessionId && !!paramSessionId && paramSessionId.startsWith('sess_');
  const sessionId    = cookieSessionId || (usedFallback ? paramSessionId : null);

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_session' }, 401, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  // Secret check only applies on the cookie path. The fallback (query-param) path
  // intentionally skips it — see note above.
  if (!usedFallback) {
    const providedSecret = request.headers.get('X-Session-Secret');
    if (!await verifySessionSecret(session, providedSecret)) {
      return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid', reason: 'unauthorized' }, 403, request, env);
    }
  }

  if (usedFallback) {
    const ua = request.headers.get('user-agent') || '';
    log('session_query_fallback_used', {
      session_id: sessionId,
      status:     session.status,
      is_safari:  /Safari/.test(ua) && !/Chrome/.test(ua),
      ua:         ua.slice(0, 120),
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
