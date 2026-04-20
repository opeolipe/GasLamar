/**
 * Stage 1 — Extract (LLM call, hardened against hallucination).
 *
 * Calls Claude with SKILL_EXTRACT and returns a validated extraction object.
 * The prompt strictly forbids inference — all fields must be verbatim from the source.
 * Output is validated by validate.js; if validation fails, one retry is attempted
 * with a correction hint before throwing.
 *
 * Uses claude-haiku-4-5 (cheap + fast): extraction is mechanical pattern-matching,
 * not reasoning. Sonnet-class models are saved for the richer diagnose step.
 */

import { SKILL_EXTRACT } from '../prompts/extract.js';
import { callClaude } from '../claude.js';
import { validateExtractOutput } from './validate.js';

function parseExtractJSON(rawText) {
  const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Calls the extraction LLM once and validates the result.
 * Throws if the response cannot be parsed or fails schema validation.
 */
async function attemptExtract(userContent, env) {
  const result = await callClaude(env, SKILL_EXTRACT, userContent, 1500, 'claude-haiku-4-5-20251001');
  if (result?.stop_reason === 'max_tokens') {
    throw new Error('TRUNCATED');
  }
  const text = result?.content?.[0]?.text || '{}';
  const parsed = parseExtractJSON(text);
  const validation = validateExtractOutput(parsed);
  if (!validation.valid) {
    throw new Error('Extract validation failed: ' + validation.errors.join('; '));
  }
  return parsed;
}

/**
 * Extracts structured data from CV text and job description.
 * Retries once with a correction hint if the first attempt fails validation.
 *
 * @param {string} cvText   — raw text of the CV
 * @param {string} jobDesc  — raw text of the job description
 * @param {object} env      — Cloudflare Worker env bindings
 * @returns {object}        — validated extraction matching the SKILL_EXTRACT schema
 */
export async function callExtract(cvText, jobDesc, env) {
  const userContent = `CV:\n${cvText}\n\nJOB DESCRIPTION:\n${jobDesc}`;

  try {
    return await attemptExtract(userContent, env);
  } catch (firstErr) {
    // Retry once with an explicit schema reminder
    const correction = userContent
      + '\n\nPENTING: Output harus JSON valid persis sesuai schema. '
      + 'Pastikan semua field ada: cv.pengalaman_mentah, cv.skills_mentah, cv.angka_di_cv, '
      + 'cv.format_cv.satu_kolom (boolean), cv.format_cv.ada_tabel (boolean), '
      + 'jd.skills_diminta (array), jd.pengalaman_minimal (number atau null), '
      + 'jd.industri, jd.judul_role. Jangan tulis apapun selain JSON.';
    return await attemptExtract(correction, env);
  }
}
