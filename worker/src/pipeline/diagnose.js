/**
 * Stage 4 — Diagnose (LLM call — text generation only).
 *
 * The LLM is given the deterministic analysis facts (Stage 2) and scores (Stage 3)
 * and asked to produce human-readable explanations only. It is explicitly told:
 *   - which skills are missing (from Stage 2) — it must not invent new gaps
 *   - whether numbers are present — it must not fabricate metrics
 *   - the verdict and scores — it cannot change them
 *
 * Output is validated by validate.js; one retry is attempted on failure.
 *
 * Uses claude-haiku-4-5 (cheap): diagnosis is text formatting, not complex reasoning.
 */

import { SKILL_DIAGNOSE } from '../prompts/diagnose.js';
import { callClaude } from '../claude.js';
import { validateDiagnoseOutput } from './validate.js';

function parseDiagnoseJSON(rawText) {
  const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

/**
 * Builds the structured user message fed to SKILL_DIAGNOSE.
 * Providing explicit analisis_sistem facts prevents the LLM from inferring
 * gaps it wasn't told exist, which is the primary hallucination vector here.
 */
function buildUserMessage(extractedData, analysisResult, scoreResult) {
  const { cv, jd } = extractedData;
  const { skill_match, has_numbers, format_ok, has_certs, konfidensitas } = analysisResult;
  const { skor_6d, skor, veredict, timebox_weeks } = scoreResult;

  const missingStr = skill_match.missing.length > 0
    ? skill_match.missing.join(', ')
    : 'tidak ada — semua skill JD sudah tercakup';
  const matchedStr = skill_match.matched.length > 0
    ? skill_match.matched.join(', ')
    : 'tidak ada skill yang cocok';

  return `data_cv:
pengalaman_mentah: ${cv.pengalaman_mentah}
pendidikan: ${cv.pendidikan}
skills_mentah: ${cv.skills_mentah}
sertifikat: ${cv.sertifikat}
angka_di_cv: ${cv.angka_di_cv}
format_cv: satu_kolom=${cv.format_cv.satu_kolom}, ada_tabel=${cv.format_cv.ada_tabel}

data_jd:
judul_role: ${jd.judul_role}
industri: ${jd.industri}
skills_diminta: ${jd.skills_diminta.join(', ') || 'tidak disebutkan'}
pengalaman_minimal: ${jd.pengalaman_minimal ?? 'tidak disebutkan'}

skor_6d: ${JSON.stringify(skor_6d)}
skor_total: ${skor}
veredict: ${veredict}
timebox_weeks: ${timebox_weeks ?? 'null'}

analisis_sistem:
skill_cocok: ${matchedStr}
skill_kurang: ${missingStr}
ada_angka_di_cv: ${has_numbers}
format_ats_ok: ${format_ok}
ada_sertifikat: ${has_certs}
konfidensitas_data: ${konfidensitas}

INSTRUKSI: Tulis gap HANYA berdasarkan skill_kurang di atas. Jangan tambahkan gap yang tidak ada di skill_kurang.`;
}

async function attemptDiagnose(userMessage, env) {
  const result = await callClaude(env, SKILL_DIAGNOSE, userMessage, 1200, 'claude-haiku-4-5-20251001');
  if (result?.stop_reason === 'max_tokens') {
    throw new Error('TRUNCATED');
  }
  const text = result?.content?.[0]?.text || '{}';
  const parsed = parseDiagnoseJSON(text);
  const validation = validateDiagnoseOutput(parsed);
  if (!validation.valid) {
    throw new Error('Diagnose validation failed: ' + validation.errors.join('; '));
  }
  return parsed;
}

/**
 * Generates human-readable gap analysis and recommendations.
 * Retries once with a schema correction if the first attempt fails validation.
 *
 * @param {object} extractedData  — Stage 1 output
 * @param {object} analysisResult — Stage 2 output
 * @param {object} scoreResult    — { skor_6d, skor, veredict, timebox_weeks }
 * @param {object} env            — Cloudflare Worker env bindings
 * @returns {object}              — validated diagnose result (gap, rekomendasi, etc.)
 */
export async function callDiagnose(extractedData, analysisResult, scoreResult, env) {
  const userMessage = buildUserMessage(extractedData, analysisResult, scoreResult);

  try {
    return await attemptDiagnose(userMessage, env);
  } catch (firstErr) {
    const correction = userMessage
      + '\n\nPENTING: Output harus JSON valid dengan semua field berikut: '
      + 'gap (array), rekomendasi (array), alasan_skor (string), kekuatan (array), '
      + 'konfidensitas ("Rendah"|"Sedang"|"Tinggi"), '
      + 'hr_7_detik.kuat (array), hr_7_detik.diabaikan (array). '
      + 'Jangan tulis apapun selain JSON.';
    return await attemptDiagnose(correction, env);
  }
}
