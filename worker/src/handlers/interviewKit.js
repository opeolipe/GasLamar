import { jsonResponse } from '../cors.js';
import { log, logError } from '../utils.js';
import { getSession, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { callClaude } from '../claude.js';
import { INTERVIEW_KIT_SYSTEM_PROMPT as SYSTEM_PROMPT } from '../prompts/interviewKit.js';

export async function handleInterviewKit(request, env) {
  const session_id = getSessionIdFromCookie(request);
  if (!session_id) {
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.' }, 401, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawLang = body.language;
  const language = rawLang === 'en' ? 'en' : 'id';
  const cacheKey = `kit_${session_id}_${language}`;

  // Cache-first: return pre-generated kit without requiring an active session.
  // This allows the kit to be served even after the session is deleted (last credit).
  try {
    const cached = await env.GASLAMAR_SESSIONS.get(cacheKey, { type: 'json' });
    if (cached) {
      log('interview_kit_cache_hit', { session_id, language });
      return jsonResponse({ success: true, kit: cached }, 200, request, env);
    }
  } catch {
    // proceed to session-gated generation
  }

  // Cache miss — require active session to generate
  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  const { cv_text, job_desc } = session;
  if (!cv_text || !job_desc) {
    return jsonResponse({ message: 'Data sesi tidak lengkap' }, 400, request, env);
  }

  try {
    const parsedKit = await generateInterviewKit(cv_text, job_desc, language, env);
    await env.GASLAMAR_SESSIONS.put(cacheKey, JSON.stringify(parsedKit), { expirationTtl: 86400 });
    log('interview_kit_generated', { session_id, language });
    return jsonResponse({ success: true, kit: parsedKit }, 200, request, env);
  } catch (e) {
    logError('interview_kit_failed', { session_id, error: e.message });
    return jsonResponse({ message: e.message || 'Gagal menghasilkan Interview Kit. Coba lagi.' }, 500, request, env);
  }
}

export async function generateInterviewKit(cv_text, job_desc, language, env) {
  const langLabel = language === 'en' ? 'English' : 'Bahasa Indonesia';
  const userContent = `Language: ${language}\nCandidate CV:\n${cv_text}\n\nJob Description:\n${job_desc}\n\nGenerate the interview kit. All generated text (email, WhatsApp, tell_me_about_yourself, sample_answer) must be in ${langLabel}.`;

  const claudeResponse = await callClaude(env, SYSTEM_PROMPT, userContent, 3000);

  if (claudeResponse.stop_reason === 'max_tokens') {
    throw new Error('Respons AI terpotong. Coba lagi.');
  }

  const text = claudeResponse.content[0].text;
  const jsonStart = text.indexOf('{');
  const jsonEnd   = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('Format respons AI tidak valid.');
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}
