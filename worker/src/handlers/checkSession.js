import { jsonResponse } from '../cors.js';
import { logError } from '../utils.js';
import { getSession, getSessionTtl } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleCheckSession(request, env) {
  const url = new URL(request.url);

  // Cookie is the primary source. The ?session= query param is a backward-
  // compatibility fallback for old links/bookmarks. Session IDs in URLs leak
  // into browser history, Referer headers, and CF access logs — this fallback
  // should be removed once all pre-cookie links have expired (after 2026-06-01).
  const sessionId = getSessionIdFromCookie(request) || url.searchParams.get('session');

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Session tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_cookie' }, 401, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  const expiresAt = session.created_at
    ? session.created_at + getSessionTtl(session) * 1000
    : null;

  return jsonResponse({
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
    expires_at: expiresAt,
  }, 200, request, env);
}
