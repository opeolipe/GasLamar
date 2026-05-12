import { jsonResponse } from '../cors.js';
import { log, logError } from '../utils.js';
import { getSession, getSessionTtl, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleCheckSession(request, env) {
  const url             = new URL(request.url);
  const cookieSessionId = getSessionIdFromCookie(request);
  const paramSessionId  = url.searchParams.get('session');

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

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_session' }, 401, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  // Secret check only applies on the non-fallback path.
  if (!usedFallback) {
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
