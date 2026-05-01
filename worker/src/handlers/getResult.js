import { jsonResponse } from '../cors.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { log, logError } from '../utils.js';

export async function handleGetResult(request, env) {
  const session_id = getSessionIdFromCookie(request);
  if (!session_id) {
    return jsonResponse({ message: 'Sesi tidak ditemukan.' }, 401, request, env);
  }

  const stored = await env.GASLAMAR_SESSIONS.get(`cv_result_${session_id}`, { type: 'json' });
  if (!stored) {
    return jsonResponse({ message: 'Hasil tidak ditemukan atau sudah kedaluwarsa.' }, 404, request, env);
  }

  log('get_result_hit', { session_id });
  return jsonResponse({ ...stored, exhausted: true }, 200, request, env);
}
