import { jsonResponse } from '../cors.js';
import { getSession, updateSession, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { SESSION_STATES, canStartGeneration } from '../sessionStates.js';

export async function handleGetSession(request, env) {
  const session_id = getSessionIdFromCookie(request);

  if (!session_id) {
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_cookie' }, 401, request, env);
  }

  const session = await getSession(env, session_id);

  if (!session) {
    return jsonResponse({ message: 'Sesi download tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  // Verify session secret (new sessions require it; legacy sessions without hash skip this check)
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  // Allow 'paid' (first generation), 'ready' (subsequent generation for multi-credit),
  // or 'generating' (retry after a failed /generate call).
  if (!canStartGeneration(session.status)) {
    return jsonResponse({ message: 'Pembayaran belum dikonfirmasi' }, 403, request, env);
  }

  // Transition to 'generating' if not already there.
  if (session.status !== SESSION_STATES.GENERATING) {
    await updateSession(env, session_id, { status: SESSION_STATES.GENERATING });
  }

  return jsonResponse({
    cv: session.cv_text,
    job_desc: session.job_desc,
    tier: session.tier,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
  }, 200, request, env);
}
