import { jsonResponse } from '../cors.js';
import { clientIp } from '../utils.js';
import { checkRateLimitKVSession, rateLimitResponse } from '../rateLimit.js';
import { getSession, updateSession } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleSessionPing(request, env) {
  const ip         = clientIp(request);
  const session_id = getSessionIdFromCookie(request);
  // Authenticated users get 60 req/min (generous — heartbeat fires every 3 min normally).
  // Unauthenticated IPs get 10 req/min.
  const kvResult = await checkRateLimitKVSession(env, ip, session_id, 10, 60, 60, 'session_ping');
  if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60);

  if (!session_id) {
    return jsonResponse({ ok: false, expired: true }, 401, request, env);
  }

  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ ok: false, expired: true }, 404, request, env);
  }

  // Re-write to refresh KV TTL while user is still active on the page
  await updateSession(env, session_id, { last_active: Date.now() });

  return jsonResponse({ ok: true, status: session.status }, 200, request, env);
}
