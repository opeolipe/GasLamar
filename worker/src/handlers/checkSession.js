import { jsonResponse } from '../cors.js';
import { logError } from '../utils.js';
import { getSession, getSessionTtl, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleCheckSession(request, env) {
  const sessionId = getSessionIdFromCookie(request);

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Session tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_cookie' }, 401, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  // Require session secret when the session has one stored (new sessions).
  // Legacy sessions without a hash pass through for backward compatibility.
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid', reason: 'unauthorized' }, 403, request, env);
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
