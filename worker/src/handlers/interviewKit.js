import { jsonResponse } from '../cors.js';
import { log, logError } from '../utils.js';
import { getSession, verifySessionSecret } from '../sessions.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { callClaude } from '../claude.js';

const SYSTEM_PROMPT = `You are an expert career coach and interview preparation specialist for Indonesian job seekers.

Your task: given a candidate's CV and a job description, produce a JSON interview preparation kit.

Output ONLY valid JSON — no markdown, no code fences, no text before or after the JSON object.

Required JSON structure (follow exactly):
{
  "job_insights": [3-5 objects: {"phrase": "<keyword from JD>", "meaning": "<professional, constructive explanation of what the employer truly expects — avoid cynical framing>"}],
  "email_template": {"subject": "<professional subject>", "body": "<3-4 paragraph email in specified language>"},
  "whatsapp_message": "<concise 2-3 sentence WhatsApp opener in specified language>",
  "tell_me_about_yourself": "<tailored elevator pitch, 80-120 words, in specified language — realistic for 45-60 second interview delivery>",
  "interview_questions": [3 to 5 objects (prioritize quality, do not pad to 5 if JD is weak): {
    "question_id": "<question in Bahasa Indonesia>",
    "question_en": "<same question in English>",
    "sample_answer": "<STAR-method answer in specified language, 80-120 words. CRITICAL: do NOT invent specific numbers, tools, metrics, or claims not explicitly mentioned in the CV. If the CV lacks detail, keep the answer structured but general.>"
  }]
}
Questions must test the top skills/requirements from the job description. Minimum 3 questions.`;

export async function handleInterviewKit(request, env) {
  const session_id = getSessionIdFromCookie(request);
  if (!session_id) {
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.' }, 401, request, env);
  }

  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawLang = body.language;
  const language = rawLang === 'en' ? 'en' : 'id';

  const { cv_text, job_desc } = session;
  if (!cv_text || !job_desc) {
    return jsonResponse({ message: 'Data sesi tidak lengkap' }, 400, request, env);
  }

  const cacheKey = `kit_${session_id}_${language}`;
  try {
    const cached = await env.GASLAMAR_SESSIONS.get(cacheKey, { type: 'json' });
    if (cached) {
      log('interview_kit_cache_hit', { session_id, language });
      return jsonResponse({ success: true, kit: cached }, 200, request, env);
    }
  } catch {
    // proceed to generate
  }

  try {
    const langLabel = language === 'en' ? 'English' : 'Bahasa Indonesia';
    const userContent = `Language: ${language}\nCandidate CV:\n${cv_text}\n\nJob Description:\n${job_desc}\n\nGenerate the interview kit. All generated text (email, WhatsApp, tell_me_about_yourself, sample_answer) must be in ${langLabel}.`;

    const claudeResponse = await callClaude(env, SYSTEM_PROMPT, userContent, 3000);

    if (claudeResponse.stop_reason === 'max_tokens') {
      throw new Error('Respons AI terpotong. Coba lagi.');
    }

    const parsedKit = JSON.parse(claudeResponse.content[0].text);

    await env.GASLAMAR_SESSIONS.put(cacheKey, JSON.stringify(parsedKit), { expirationTtl: 86400 });

    log('interview_kit_generated', { session_id, language });
    return jsonResponse({ success: true, kit: parsedKit }, 200, request, env);
  } catch (e) {
    logError('interview_kit_failed', { session_id, error: e.message });
    return jsonResponse({ message: e.message || 'Gagal menghasilkan Interview Kit. Coba lagi.' }, 500, request, env);
  }
}
