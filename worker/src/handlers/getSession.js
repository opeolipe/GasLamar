import { jsonResponse } from '../cors.js';
import { getSession, updateSession } from '../sessions.js';
import { getSessionIdFromCookie, getSessionTokenFromCookie } from '../cookies.js';
import { SESSION_STATES, canStartGeneration } from '../sessionStates.js';
import { checkRateLimitKVSession, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';
import { clientIp, log, logError } from '../utils.js';

export async function handleGetSession(request, env) {
  const ip         = clientIp(request);
  const session_id = getSessionIdFromCookie(request);
  // Authenticated users get 20 req/min; unauthenticated IPs get 10 req/min.
  const rl = await checkRateLimitKVSession(env, ip, session_id, 10, 20, 60, 'get_session');
  if (!rl.allowed) return rateLimitResponse(request, env, rl.retryAfter ?? 60, rl);
  const withRl = res => addRateLimitHeaders(res, rl);

  log('get_session_request', {
    ip,
    has_payment_cookie: !!session_id,
    has_analysis_cookie: !!getSessionTokenFromCookie(request),
    cookie_header_present: !!request.headers.get('Cookie'),
  });

  if (!session_id) {
    // Check whether the user has an analysis session token — if so, payment hasn't
    // been confirmed yet rather than being a total session loss. Return 403 so the
    // download page shows "Waiting for payment confirmation" instead of "Session expired."
    const analysisToken = getSessionTokenFromCookie(request);
    if (analysisToken) {
      const analysisSession = await env.GASLAMAR_SESSIONS.get(
        `analysis_session_${analysisToken}`,
        { type: 'json' },
      );
      if (analysisSession?.resultId) {
        log('get_session_no_payment_cookie_has_analysis', { ip });
        return withRl(jsonResponse({ message: 'Pembayaran belum dikonfirmasi. Jika sudah membayar, tunggu beberapa saat lalu coba lagi.', reason: 'payment_pending' }, 403, request, env));
      }
    }
    logError('get_session_no_cookie', { ip });
    return withRl(jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_cookie' }, 401, request, env));
  }

  const session = await getSession(env, session_id);

  log('get_session_kv_result', {
    ip,
    session_found: !!session,
    session_status: session?.status ?? null,
  });

  if (!session) {
    logError('get_session_expired', { ip, session_id });
    return withRl(jsonResponse({ message: 'Sesi download tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env));
  }

  // Allow 'paid' (first generation), 'ready' (subsequent generation for multi-credit),
  // or 'generating' (retry after a failed /generate call).
  if (!canStartGeneration(session.status)) {
    log('get_session_cannot_generate', { ip, status: session.status });
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
