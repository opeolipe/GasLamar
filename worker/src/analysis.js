/**
 * CV Analysis Orchestrator — 6-stage pipeline
 *
 * Stage 1: EXTRACT  (LLM)   — callExtract()      — verbatim data from CV + JD
 * Stage 2: ANALYZE  (Code)  — runAnalysis()       — deterministic skill/format comparison
 * Stage 3: SCORE    (Code)  — calculateScores()   — deterministic 6D scores
 * Stage 4: DIAGNOSE (LLM)   — callDiagnose()      — human-readable explanations only
 * Stage 5: REWRITE  (LLM)   — tailoring.js        — unchanged, called from /generate
 * Stage 6: VALIDATE (Code)  — validate.js         — called inside stage 1 and 4 modules
 *
 * The LLM is now responsible for:
 *   - Verbatim data extraction (Stage 1, minimal hallucination risk)
 *   - Text phrasing only (Stage 4, cannot change scores or gap list)
 *
 * The previous SKILL_ANALYZE prompt (prompts/analyze.js) is retired.
 * It remains on disk for git history but is no longer imported.
 */

import { callExtract }    from './pipeline/extract.js';
import { runAnalysis }    from './pipeline/analyze.js';
import {
  calculateScores,
  computeSkor,
  determineVeredict,
  computeSkorSesudah,
} from './pipeline/score.js';
import { callDiagnose }  from './pipeline/diagnose.js';
import { sha256Hex }     from './utils.js';

// ---- Orchestrator ----

export async function analyzeCV(cvText, jobDesc, env) {
  // ── Cache check (v4) ──────────────────────────────────────────────────────
  // Bump to analysis_v5_ if the scoring formula or pipeline structure changes.
  // v3 entries (from the monolithic SKILL_ANALYZE pipeline) are intentionally
  // stale and will not be returned.
  const cacheKey = `analysis_v4_${await sha256Hex(cvText.trim() + '||' + jobDesc.trim())}`;
  const cached = await env.GASLAMAR_SESSIONS.get(cacheKey, { type: 'json' });
  if (cached) {
    // Re-apply red-flag penalty for entries cached before this logic was added.
    // Any valid post-penalty skor with red_flags present cannot exceed 85
    // (100 − minimum 15 penalty), so skor > 85 + red_flags = definitively old entry.
    if (Array.isArray(cached.red_flags) && cached.red_flags.length > 0 && cached.skor > 85) {
      applyRedFlagPenalty(cached);
    }
    return cached;
  }

  // ── Stage 1: EXTRACT ──────────────────────────────────────────────────────
  // Extraction is cached independently so the LLM call is skipped on repeated
  // analysis of identical CV+JD content (e.g. user re-runs after payment).
  // Bump to extract_v2_ when SKILL_EXTRACT prompt changes significantly.
  const extractKey = `extract_v1_${await sha256Hex(cvText.trim() + '||' + jobDesc.trim())}`;
  let extractedData = await env.GASLAMAR_SESSIONS.get(extractKey, { type: 'json' });
  if (!extractedData) {
    extractedData = await callExtract(cvText, jobDesc, env);
    await env.GASLAMAR_SESSIONS.put(
      extractKey,
      JSON.stringify(extractedData),
      { expirationTtl: 86400 }, // 24h — extraction is a snapshot of the exact input
    );
  }

  // ── Stage 2: ANALYZE (code, no AI) ────────────────────────────────────────
  const analysisResult = runAnalysis(extractedData);

  // ── Stage 3: SCORE (code, no AI) ─────────────────────────────────────────
  const skor_6d                     = calculateScores(extractedData, analysisResult);
  const { total6D, skor }           = computeSkor(skor_6d);
  const { veredict, timebox_weeks } = determineVeredict(total6D, analysisResult);
  const skor_sesudah                = computeSkorSesudah(skor, analysisResult);

  // ── Stage 4: DIAGNOSE (LLM — text only, cannot alter scores or gap list) ──
  const diagnoseResult = await callDiagnose(
    extractedData,
    analysisResult,
    { skor_6d, skor, veredict, timebox_weeks },
    env,
  );

  // Discard the LLM's konfidensitas — Stage 2 computed the authoritative value.
  delete diagnoseResult.konfidensitas;

  // ── Build red_flags: code-detected structural + LLM-detected content flags ─
  // Code-detected flags use keywords ("format", "ATS") that trigger the extra
  // formatting penalty inside applyRedFlagPenalty (see below).
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
  // Shape is identical to the pre-refactor output so the frontend requires
  // no changes. Differences from old output:
  //   • skor_sesudah: formula-based (was LLM-provided, ±5-10pt variance OK)
  //   • timebox_weeks: derived from missing_skills count (was LLM-provided)
  //   • archetype: keyword-matched (was LLM-provided; more reliable)
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
  };

  // Clean up undefined hr_7_detik so it doesn't appear as a null key
  if (!scoring.hr_7_detik) delete scoring.hr_7_detik;

  if (allFlags.length > 0) {
    scoring.red_flags = allFlags;
    applyRedFlagPenalty(scoring);
  }

  // Legacy backward-compat fields — consumed by the frontend's scoring.js
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
 *
 * Example: 1 formatting flag → -15 - 10 = -25 → 100 becomes 75.
 */
export function applyRedFlagPenalty(scoring) {
  const flags = scoring.red_flags;
  if (!Array.isArray(flags) || flags.length === 0) return;

  const extraFlags      = Math.min(flags.length - 1, 2);
  const basePenalty     = 15 + extraFlags * 5;

  const FORMAT_KEYWORDS = /format|karakter|parsing|ATS/i;
  const formattingPenalty = flags.some(f => FORMAT_KEYWORDS.test(f)) ? 10 : 0;

  const totalPenalty = basePenalty + formattingPenalty;

  scoring.skor = Math.max(0, scoring.skor - totalPenalty);
  // skor_sesudah must stay ≥ skor+10 and ≤ 95
  scoring.skor_sesudah = Math.min(95, Math.max(scoring.skor + 10, scoring.skor_sesudah - totalPenalty));
}
