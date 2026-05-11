import { jsonResponse } from '../cors.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { log, logError, sha256Full, clientIp } from '../utils.js';
import { KV_CV_RESULT_PREFIX } from '../constants.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';

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

  // Verify session secret when the result has one stored (new sessions).
  // Legacy/bypass results (no hash) are allowed through for backward compat.
  if (stored.session_secret_hash) {
    const providedSecret = request.headers.get('X-Session-Secret');
    if (!providedSecret) {
      return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
    }
    const hash    = await sha256Full(providedSecret);
    const refHash = stored.session_secret_hash;
    // Constant-time comparison — same pattern as sessions.js:verifySessionSecret.
    // Never short-circuit on length: XOR length difference into diff first so
    // mismatched lengths always produce diff !== 0 without an early return.
    const len = Math.max(hash.length, refHash.length);
    let diff = hash.length ^ refHash.length;
    for (let i = 0; i < len; i++) {
      diff |= (hash.charCodeAt(i) || 0) ^ (refHash.charCodeAt(i) || 0);
    }
    if (diff !== 0) {
      return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
    }
  }

  // Strip internal fields before returning
  const { session_secret_hash: _omit, ...result } = stored;
  log('get_result_hit', { session_id });
  return jsonResponse({ ...result, exhausted: true }, 200, request, env);
}
