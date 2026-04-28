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
  // 1. Strip markdown fences
  let cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();

  // 2. Try direct parse first (fast path — Claude followed instructions)
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // 3. Fallback: extract first {...} block in case Claude added preamble/postamble
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }

  // 4. Nothing worked — log diagnostic snippet and throw retryable error
  const e = new SyntaxError('no valid JSON object found');
  const pos = Number(e.message.match(/position (\d+)/)?.[1] ?? -1);
  console.error(JSON.stringify({
    event: 'diagnose_json_parse_error',
    error: e.message,
    raw_length: cleaned.length,
    snippet: pos >= 0 ? cleaned.slice(Math.max(0, pos - 40), pos + 40) : cleaned.slice(-80),
  }));
  throw new Error('INVALID_JSON');
}

/**
 * Builds the structured user message fed to SKILL_DIAGNOSE.
 * Providing explicit analisis_sistem facts prevents the LLM from inferring
 * gaps it wasn't told exist, which is the primary hallucination vector here.
 * roleInferenceResult is optional; when present it adds a role_context block.
 */
function buildUserMessage(extractedData, analysisResult, scoreResult, roleInferenceResult) {
  const { cv, jd } = extractedData;
  const { skill_match, has_numbers, format_ok, has_certs, konfidensitas } = analysisResult;
  const { skor_6d, skor, veredict, timebox_weeks } = scoreResult;

  const missingStr = skill_match.missing.length > 0
    ? skill_match.missing.join(', ')
    : 'tidak ada — semua skill JD sudah tercakup';
  const matchedStr = skill_match.matched.length > 0
    ? skill_match.matched.join(', ')
    : 'tidak ada skill yang cocok';

  // Optional role context block — injected when role inference has run.
  // The LLM uses this to phrase recommendations that fit the candidate's actual role
  // rather than generic advice.  Confidence < 0.6 is still shown but flagged as low.
  const roleBlock = roleInferenceResult
    ? `\nrole_context:
inferred_role: ${roleInferenceResult.role}
confidence: ${roleInferenceResult.confidence}
seniority: ${roleInferenceResult.seniority}
industry: ${roleInferenceResult.industry}
`
    : '';

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
${roleBlock}
analisis_sistem:
skill_cocok: ${matchedStr}
skill_kurang: ${missingStr}
ada_angka_di_cv: ${has_numbers}
format_ats_ok: ${format_ok}
ada_sertifikat: ${has_certs}
konfidensitas_data: ${konfidensitas}

INSTRUKSI: Tulis gap HANYA berdasarkan skill_kurang di atas. Jangan tambahkan gap yang tidak ada di skill_kurang.`;
}

async function attemptDiagnose(userMessage, env, maxTokens) {
  const result = await callClaude(env, SKILL_DIAGNOSE, userMessage, maxTokens, 'claude-haiku-4-5-20251001');
  console.log(JSON.stringify({
    event: 'diagnose_response',
    stop_reason: result?.stop_reason,
    raw_length: result?.content?.[0]?.text?.length ?? 0,
    max_tokens: maxTokens,
  }));
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
 * First attempt uses 2500 tokens; on any failure retries once with 3000 tokens
 * and an explicit schema correction prompt.
 *
 * @param {object}      extractedData       — Stage 1 output
 * @param {object}      analysisResult      — Stage 2 output
 * @param {object}      scoreResult         — { skor_6d, skor, veredict, timebox_weeks }
 * @param {object|null} roleInferenceResult — Stage 2.5 output, or null if unavailable
 * @param {object}      env                 — Cloudflare Worker env bindings
 * @returns {object}                        — validated diagnose result (gap, rekomendasi, etc.)
 */
export async function callDiagnose(extractedData, analysisResult, scoreResult, roleInferenceResult, env) {
  const userMessage = buildUserMessage(extractedData, analysisResult, scoreResult, roleInferenceResult);

  try {
    return await attemptDiagnose(userMessage, env, 2500);
  } catch (firstErr) {
    console.error(JSON.stringify({
      event: 'diagnose_retry',
      reason: firstErr.message,
    }));
    const correction = userMessage
      + '\n\nPENTING: Output harus JSON valid dengan semua field berikut: '
      + 'gap (array), rekomendasi (array), alasan_skor (string), kekuatan (array), '
      + 'konfidensitas ("Rendah"|"Sedang"|"Tinggi"), '
      + 'hr_7_detik.kuat (array), hr_7_detik.diabaikan (array). '
      + 'Jangan tulis apapun selain JSON.';
    return await attemptDiagnose(correction, env, 3000);
  }
}
