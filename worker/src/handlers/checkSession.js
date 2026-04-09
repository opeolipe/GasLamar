import { jsonResponse } from '../cors.js';
import { logError } from '../utils.js';
import { getSession } from '../sessions.js';

export async function handleCheckSession(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
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
