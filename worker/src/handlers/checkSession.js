import { jsonResponse } from '../cors.js';
import { logError, log } from '../utils.js';
import { getSession, getSessionTtl, updateSession } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';

export async function handleCheckSession(request, env) {
  const url = new URL(request.url);

  // Cookie is the primary source. The ?session= query param is kept as a
  // backward-compatibility fallback for existing links/bookmarks during
  // the transition period. New clients never include ?session= in the URL.
  const sessionId = getSessionIdFromCookie(request) || url.searchParams.get('session');

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Session tidak ditemukan. Pastikan browser mengizinkan cookies.', reason: 'no_cookie' }, 401, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa.', reason: 'expired' }, 404, request, env);
  }

  // Dev bypass: ?dev=1 on non-production upgrades a pending session to paid so
  // the download page can proceed without a real Mayar webhook.
  if (
    env.ENVIRONMENT !== 'production' &&
    url.searchParams.get('dev') === '1' &&
    session.status === 'pending'
  ) {
    await updateSession(env, sessionId, { status: 'paid', paid_at: Date.now() });
    session.status = 'paid';
    log('dev_bypass_payment', { session_id: sessionId });
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
