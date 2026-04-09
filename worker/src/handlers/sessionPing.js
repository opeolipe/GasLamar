import { jsonResponse } from '../cors.js';
import { getSession, updateSession, verifySessionSecret } from '../sessions.js';

export async function handleSessionPing(request, env) {
  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { session_id } = body;
  if (!session_id || !session_id.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
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
