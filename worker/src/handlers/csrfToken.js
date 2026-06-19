import { jsonResponse } from '../cors.js';
import { getCvKeyFromCookie, getSessionTokenFromCookie } from '../cookies.js';
import { log } from '../utils.js';

const CSRF_TTL = 3600; // 1 hour

export async function handleCsrfToken(request, env) {
  let cv_text_key = getCvKeyFromCookie(request) || null;

  if (!cv_text_key) {
    const analysisToken = getSessionTokenFromCookie(request);
    if (analysisToken) {
      const analysisSession = await env.GASLAMAR_SESSIONS.get(
        `analysis_session_${analysisToken}`,
        { type: 'json' },
      );
      if (analysisSession?.cvKey && /^cvtext_[0-9a-f]{64}$/.test(analysisSession.cvKey)) {
        cv_text_key = analysisSession.cvKey;
      }
    }
  }

  if (!cv_text_key || !/^cvtext_[0-9a-f]{64}$/.test(cv_text_key)) {
    return jsonResponse({ message: 'Sesi analisis tidak ditemukan' }, 401, request, env);
  }

  const token = crypto.randomUUID();
  await env.GASLAMAR_SESSIONS.put(`csrf_${cv_text_key}`, token, { expirationTtl: CSRF_TTL });

  log('csrf_token_issued', { cv_key_prefix: cv_text_key.slice(0, 14) });
  return jsonResponse({ csrfToken: token }, 200, request, env);
}
