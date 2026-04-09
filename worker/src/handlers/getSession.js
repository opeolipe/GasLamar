import { jsonResponse } from '../cors.js';
import { getSession, updateSession, verifySessionSecret } from '../sessions.js';

export async function handleGetSession(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { session_id } = body;

  if (!session_id || !session_id.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
  }

  const session = await getSession(env, session_id);

  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  // Verify session secret (new sessions require it; legacy sessions without hash skip this check)
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  // Allow 'paid' (first time) or 'generating' (retry after failed /generate)
  if (session.status !== 'paid' && session.status !== 'generating') {
    return jsonResponse({ message: 'Pembayaran belum dikonfirmasi' }, 403, request, env);
  }

  // Only transition paid → generating once; already-generating sessions stay generating
  if (session.status === 'paid') {
    await updateSession(env, session_id, { status: 'generating' });
  }

  return jsonResponse({
    cv: session.cv_text,
    job_desc: session.job_desc,
    tier: session.tier,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
  }, 200, request, env);
}
