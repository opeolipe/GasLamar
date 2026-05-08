/**
 * CV Analysis Orchestrator — 6-stage pipeline
 *
 * Stage 1: EXTRACT      (LLM)   — callExtract()        — verbatim data from CV + JD
 * Stage 2: ANALYZE      (Code)  — runAnalysis()         — deterministic skill/format comparison
 * Stage 2.5: ROLE INFER (Code)  — inferRole()           — role, seniority, industry classification
 * Stage 3: SCORE        (Code)  — calculateScores()     — raw 6D scores, then role-weighted
 * Stage 4: DIAGNOSE     (LLM)   — callDiagnose()        — human-readable explanations only
 * Stage 5: REWRITE      (LLM)   — tailoring.js          — unchanged, called from /generate
 * Stage 6: VALIDATE     (Code)  — validate.js           — called inside stage 1 and 4 modules
 *
 * Role inference (Stage 2.5) feeds:
 *   • weighted 6D scores (Stage 3)
 *   • role context block in the diagnose prompt (Stage 4)
 *   • inferred-mode tailoring in /generate (Stage 5)
 */

import { callExtract }    from './pipeline/extract.js';
import { runAnalysis }    from './pipeline/analyze.js';
import {
  calculateScores,
  computeSkor,
  determineVeredict,
  computeSkorSesudah,
} from './pipeline/score.js';
import {
  inferRole,
  applyRoleWeights,
  computePrimaryIssue,
  isJDQualityHigh,
} from './pipeline/roleInference.js';
import { getRoleProfile } from './roleProfiles.js';
import { callDiagnose }  from './pipeline/diagnose.js';
import { sha256Hex }     from './utils.js';

// ---- Cache key versions --------------------------------------------------
// DEPLOY CHECKLIST: Bump ANALYSIS_CACHE_VERSION when changing pipeline/ or prompts/.
//                   Bump EXTRACT_CACHE_VERSION when changing pipeline/extract.js or prompts/extract.js.
// Stale KV entries with old version prefixes are ignored automatically.
const EXTRACT_CACHE_VERSION  = 'v2'; // current key: extract_v2_<hash>
const ANALYSIS_CACHE_VERSION = 'v6'; // current key: analysis_v6_<hash> (bumped: role-weighted 6D scores)

// ---- Orchestrator ----

export async function analyzeCV(cvText, jobDesc, env) {
  // ── Cache check ───────────────────────────────────────────────────────────
  // Bump ANALYSIS_CACHE_VERSION (top of file) when changing pipeline/ or prompts/.
  const cacheKey = `analysis_${ANALYSIS_CACHE_VERSION}_${await sha256Hex(cvText.trim() + '||' + jobDesc.trim())}`;
  const cached = await env.GASLAMAR_SESSIONS.get(cacheKey, { type: 'json' });
  if (cached) {
    // H8 FIX: Re-apply red-flag penalty unconditionally for any cached entry that has
    // red flags. The previous gate `cached.skor > 85` meant entries with skor ≤ 85
    // and red flags were served without the penalty, inflating their scores.
    // Unconditional re-application is idempotent for entries already correctly penalised
    // (they would fail the `cached.red_flags.length > 0` check if penalty was already
    // applied and flags were cleared, which they are not — so we re-compute safely).
    if (Array.isArray(cached.red_flags) && cached.red_flags.length > 0) {
      applyRedFlagPenalty(cached);
    }
    return cached;
  }

  // ── Stage 1: EXTRACT ──────────────────────────────────────────────────────
  // Extraction is cached independently so the LLM call is skipped on repeated
  // analysis of identical CV+JD content (e.g. user re-runs after payment).
  // Bump EXTRACT_CACHE_VERSION (top of file) when changing extract.js or prompts/extract.js.
  const extractKey = `extract_${EXTRACT_CACHE_VERSION}_${await sha256Hex(cvText.trim() + '||' + jobDesc.trim())}`;
  let extractedData = await env.GASLAMAR_SESSIONS.get(extractKey, { type: 'json' });
  if (!extractedData) {
    extractedData = await callExtract(cvText, jobDesc, env);
    await env.GASLAMAR_SESSIONS.put(
      extractKey,
      JSON.stringify(extractedData),
      { expirationTtl: 86400 },
    );
  }

  // ── Stage 2: ANALYZE (code, no AI) ────────────────────────────────────────
  const analysisResult = runAnalysis(extractedData);

  // ── Stage 2.5: ROLE INFERENCE (code, no AI) ───────────────────────────────
  const roleInferenceResult = inferRole(extractedData, analysisResult);
  const roleProfile         = getRoleProfile(roleInferenceResult.role);
  const jd_mode             = isJDQualityHigh(jobDesc) ? 'targeted' : 'inferred';

  // ── Stage 3: SCORE (code, no AI) ─────────────────────────────────────────
  // Raw scores first, then weight-adjust by the inferred role's dimension biases.
  const rawSkor6d                   = calculateScores(extractedData, analysisResult);
  const skor_6d                     = applyRoleWeights(rawSkor6d, roleProfile);
  const { total6D, skor }           = computeSkor(skor_6d);
  const { veredict, timebox_weeks } = determineVeredict(total6D, analysisResult);
  const skor_sesudah                = computeSkorSesudah(skor, analysisResult);
  const primary_issue_dim           = computePrimaryIssue(skor_6d);

  // ── Stage 4: DIAGNOSE (LLM — text only, cannot alter scores or gap list) ──
  const diagnoseResult = await callDiagnose(
    extractedData,
    analysisResult,
    { skor_6d, skor, veredict, timebox_weeks },
    roleInferenceResult,
    env,
  );

  // Discard the LLM's konfidensitas — Stage 2 computed the authoritative value.
  delete diagnoseResult.konfidensitas;

  // ── Build red_flags ───────────────────────────────────────────────────────
  const codeFlags = [];
  if (analysisResult.red_flag_types.multi_column) {
    codeFlags.push('Format CV multi-kolom atau ada tabel — parsing ATS akan gagal');
  }
  if (analysisResult.red_flag_types.no_numbers) {
    codeFlags.push('CV tidak memiliki angka atau metrik kuantitatif');
  }
  if (analysisResult.red_flag_types.very_short) {
    codeFlags.push('Bagian pengalaman CV terlalu singkat — kurang detail');
  }

  const llmFlags = Array.isArray(diagnoseResult.red_flags)
    ? diagnoseResult.red_flags.filter(s => typeof s === 'string' && s.trim())
    : [];

  const allFlags = [...codeFlags, ...llmFlags];

  // ── Assemble final response ───────────────────────────────────────────────
  const ensureArray = val =>
    Array.isArray(val) ? val.filter(s => typeof s === 'string' && s.trim()) : [];

  const scoring = {
    archetype:     analysisResult.archetype,
    skor_6d,
    skor,
    veredict,
    timebox_weeks,
    alasan_skor:   diagnoseResult.alasan_skor || '',
    gap:           ensureArray(diagnoseResult.gap),
    rekomendasi:   ensureArray(diagnoseResult.rekomendasi),
    kekuatan:      ensureArray(diagnoseResult.kekuatan),
    konfidensitas: analysisResult.konfidensitas,
    skor_sesudah,
    hr_7_detik:    (diagnoseResult.hr_7_detik && typeof diagnoseResult.hr_7_detik === 'object')
                     ? diagnoseResult.hr_7_detik
                     : undefined,
    // Role inference results — consumed by /generate (tailoring mode) and frontend (UX banner)
    inferred_role:        roleInferenceResult.role,
    inferred_confidence:  roleInferenceResult.confidence,
    inferred_seniority:   roleInferenceResult.seniority,
    inferred_industry:    roleInferenceResult.industry,
    primary_issue_dim,
    jd_mode,
  };

  if (!scoring.hr_7_detik) delete scoring.hr_7_detik;

  if (Array.isArray(extractedData?.cv?.entitas_klaim)) {
    scoring.entitas_klaim = extractedData.cv.entitas_klaim.slice(0, 20);
  }

  if (allFlags.length > 0) {
    scoring.red_flags = allFlags;
    applyRedFlagPenalty(scoring);
  }

  // Legacy backward-compat fields — kept for clients that still read the old shape.
  // These are NOT independently scored dimensions; they are projections of existing 6D scores
  // using multipliers chosen to match the scale of the original pre-6D scoring system:
  //   skor_relevansi    ≈ north_star × 4    (north_star is 0–25, old relevansi was 0–100)
  //   skor_requirements ≈ recruiter_signal × 3 (old requirements was 0–30 out of a 100-pt scale)
  //   skor_kualitas     ≈ portfolio × 2       (old kualitas was 0–20)
  //   skor_keywords     ≈ recruiter_signal     (raw, maps 0–10 to an informal keyword score)
  // Do not add new scoring logic here — use skor_6d instead.
  scoring.skor_relevansi    = skor_6d.north_star * 4;
  scoring.skor_requirements = Math.round(skor_6d.recruiter_signal * 3);
  scoring.skor_kualitas     = Math.round(skor_6d.portfolio * 2);
  scoring.skor_keywords     = Math.round(skor_6d.recruiter_signal);

  // ── Store in cache (48h TTL) ───────────────────────────────────────────────
  await env.GASLAMAR_SESSIONS.put(cacheKey, JSON.stringify(scoring), { expirationTtl: 172800 });

  return scoring;
}

// ---- Red-flag penalty (exported for cache-hit patch path) ----

/**
 * Applies a deterministic score penalty for detected red flags.
 * Mutates scoring.skor and scoring.skor_sesudah in-place.
 * skor_6d sub-scores are never touched.
 *
 * Penalty schedule:
 *   Base (any flag present)   -15
 *   2nd flag                   -5  (total -20)
 *   3rd flag                   -5  (total -25, hard cap)
 *   Formatting flag extra      -10 (triggered by: format|karakter|parsing|ATS)
 */
export function applyRedFlagPenalty(scoring) {
  const flags = scoring.red_flags;
  if (!Array.isArray(flags) || flags.length === 0) return;

  const extraFlags        = Math.min(flags.length - 1, 2);
  const basePenalty       = 15 + extraFlags * 5;
  const FORMAT_KEYWORDS   = /format|karakter|parsing|ATS/i;
  const formattingPenalty = flags.some(f => FORMAT_KEYWORDS.test(f)) ? 10 : 0;
  const totalPenalty      = basePenalty + formattingPenalty;

  scoring.skor = Math.max(0, scoring.skor - totalPenalty);
  scoring.skor_sesudah = Math.min(95, Math.max(scoring.skor + 10, scoring.skor_sesudah - totalPenalty));
}
