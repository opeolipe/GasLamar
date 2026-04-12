import { jsonResponse } from '../cors.js';
import { logError } from '../utils.js';
import { getSession } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleCheckSession(request, env) {
  const url = new URL(request.url);

  // Cookie is the primary source. The ?session= query param is kept as a
  // backward-compatibility fallback for existing links/bookmarks during
  // the transition period. New clients never include ?session= in the URL.
  const sessionId = getSessionIdFromCookie(request) || url.searchParams.get('session');

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Session tidak ditemukan. Pastikan browser mengizinkan cookies.' }, 401, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  return jsonResponse({
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
  }, 200, request, env);
}
