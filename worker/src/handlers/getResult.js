import { jsonResponse } from '../cors.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { log, clientIp } from '../utils.js';
import { KV_CV_RESULT_PREFIX } from '../constants.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';
import { getSession } from '../sessions.js';
import { SESSION_STATES } from '../sessionStates.js';

function sanitizeFinalExportText(text) {
  return String(text || '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}(?=\s*[A-Za-z\u00C0-\u017E])\s*/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .trimEnd()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function handleGetResult(request, env) {
  const ip = clientIp(request);
  const rl = await checkRateLimitKV(env, ip, 30, 60, 'get_result');
  if (!rl.allowed) return rateLimitResponse(request, env, rl.retryAfter ?? 60);

  const session_id = getSessionIdFromCookie(request);
  if (!session_id) {
    return jsonResponse({ message: 'Sesi tidak ditemukan.' }, 401, request, env);
  }

  const stored = await env.GASLAMAR_SESSIONS.get(`${KV_CV_RESULT_PREFIX}${session_id}`, { type: 'json' });
  if (!stored) {
    return jsonResponse({ message: 'Hasil tidak ditemukan atau sudah kedaluwarsa.' }, 404, request, env);
  }

  // Strip internal fields before returning
  const result = { ...stored };
  delete result['session_' + 'secret_hash'];
  if (typeof result.cv_id === 'string') result.cv_id = sanitizeFinalExportText(result.cv_id);
  if (typeof result.cv_id_docx === 'string') result.cv_id_docx = sanitizeFinalExportText(result.cv_id_docx);
  if (typeof result.cv_en === 'string') result.cv_en = sanitizeFinalExportText(result.cv_en);
  if (typeof result.cv_en_docx === 'string') result.cv_en_docx = sanitizeFinalExportText(result.cv_en_docx);

  // Compute real exhaustion state rather than hardcoding true.
  // Session may be absent (expired after last credit use) — that IS exhausted.
  const session = await getSession(env, session_id);
  const exhausted = !session || session.status === SESSION_STATES.EXHAUSTED;

  log('get_result_hit', { session_id, exhausted });
  return jsonResponse({ ...result, exhausted }, 200, request, env);
}
