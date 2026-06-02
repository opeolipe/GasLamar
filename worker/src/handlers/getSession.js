import { jsonResponse } from '../cors.js';
import { getSession, updateSession } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { SESSION_STATES, canStartGeneration } from '../sessionStates.js';
import { checkRateLimitKVSession, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';
import { clientIp } from '../utils.js';

export async function handleGetSession(request, env) {
  const ip         = clientIp(request);
  const session_id = getSessionIdFromCookie(request);
  // Authenticated users get 20 req/min; unauthenticated IPs get 10 req/min.
  const rl = await checkRateLimitKVSession(env, ip, session_id, 10, 20, 60, 'get_session');
  if (!rl.allowed) return rateLimitResponse(request, env, rl.retryAfter ?? 60, rl);
  const withRl = res => addRateLimitHeaders(res, rl);

  if (!session_id) {
    return withRl(jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_cookie' }, 401, request, env));
  }

  const session = await getSession(env, session_id);

  if (!session) {
    return withRl(jsonResponse({ message: 'Sesi download tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env));
  }

  // Allow 'paid' (first generation), 'ready' (subsequent generation for multi-credit),
  // or 'generating' (retry after a failed /generate call).
  if (!canStartGeneration(session.status)) {
    return withRl(jsonResponse({ message: 'Pembayaran belum dikonfirmasi' }, 403, request, env));
  }

  // Transition to 'generating' if not already there.
  if (session.status !== SESSION_STATES.GENERATING) {
    await updateSession(env, session_id, { status: SESSION_STATES.GENERATING });
  }

  return withRl(jsonResponse({
    tier: session.tier,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
  }, 200, request, env));
}
