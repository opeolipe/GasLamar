import { jsonResponse } from '../cors.js';
import { clientIp } from '../utils.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';
import { getSession, updateSession, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleSessionPing(request, env) {
  const ip = clientIp(request);
  // Generous limit: legitimate heartbeat fires every 3 min → max ~20 req/hour per IP.
  // 30 req/min blocks flooding while never touching real users.
  const kvResult = await checkRateLimitKV(env, ip, 30, 60, 'session_ping');
  if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60);

  const session_id = getSessionIdFromCookie(request);

  if (!session_id) {
    return jsonResponse({ ok: false, expired: true }, 401, request, env);
  }

  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ ok: false, expired: true }, 404, request, env);
  }

  // Verify session secret (new sessions require it; legacy sessions without hash skip this check)
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ ok: false, expired: false, message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  // Re-write to refresh KV TTL while user is still active on the page
  await updateSession(env, session_id, { last_active: Date.now() });

  return jsonResponse({ ok: true, status: session.status }, 200, request, env);
}
