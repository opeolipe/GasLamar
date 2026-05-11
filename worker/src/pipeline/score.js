/**
 * Stage 3 — Deterministic Scoring (pure JavaScript, zero AI calls).
 *
 * All 6D scores, the overall skor, verdict, and skor_sesudah are computed
 * entirely from the Stage 1 extraction and Stage 2 analysis outputs.
 * No LLM input is involved at this stage.
 *
 * Scoring logic follows the draft provided during planning; any deviation
 * from the previous LLM-generated scores is intentional and expected —
 * the new values are consistent across identical inputs, which the old
 * LLM-generated values were not.
 */

const DIMS = ['north_star', 'recruiter_signal', 'effort', 'opportunity_cost', 'risk', 'portfolio'];

// ---- Private helpers ----

/**
 * Lightweight typo/informal-language heuristic.
 * Detects common Indonesian CV writing anti-patterns that would make an
 * HRD doubt the candidate's attention to detail.
 * Used only to reduce recruiter_signal — never to reject a CV.
 */
function hasTypos(text) {
  const str = text || '';
  const patterns = [
    /\bdi\s+[a-z]+kan\b/i,     // "di kerjakan" → should be "dikerjakan"
    /\bdi\s+[a-z]+i\b/i,       // "di perbaiki" → should be "diperbaiki"
    /\byg\b/i,                  // informal "yg" instead of "yang"
    /\btdk\b/i,                 // informal "tdk" instead of "tidak"
    /\bdg\b/i,                  // informal "dg" instead of "dengan"
    /\baku\b/i,                 // informal first-person pronoun
    /\bgue\b|\bgua\b|\blu\b/i,  // very informal pronouns
  ];
  return patterns.some(p => p.test(str));
}

// ---- Public API ----

/**
 * Computes the 6D sub-scores from extracted data and the Stage 2 analysis result.
 * Each dimension is an integer 0-10.
 *
 * @param {object} extractedData  — Stage 1 output
 * @param {object} analysisResult — Stage 2 output
 * @returns {object} skor_6d with keys matching the schema
 */
export function calculateScores(extractedData, analysisResult) {
  const { cv, jd } = extractedData;
  const { skill_match, format_ok, has_numbers, number_count, has_certs } = analysisResult;
  const matchRatio = skill_match.match_ratio;

  // --- north_star: how well CV content aligns with target role ---
  let north_star = 0;
  if (matchRatio >= 0.7)      north_star += 6;
  else if (matchRatio >= 0.4) north_star += 4;
  else                        north_star += 2;

  // Bonus: role title appears in experience text
  if (cv.pengalaman_mentah.toLowerCase().includes(jd.judul_role.toLowerCase())) north_star += 2;
  // Bonus: industry appears in experience text (only meaningful when JD names an industry)
  if (jd.industri !== 'UMUM' && cv.pengalaman_mentah.toLowerCase().includes(jd.industri.toLowerCase())) north_star += 2;
  north_star = Math.min(north_star, 10);

  // --- recruiter_signal: first-7-second impression ---
  let recruiter_signal = 0;
  if (format_ok) recruiter_signal += 5;                                    // clean ATS layout
  if (!hasTypos(cv.pengalaman_mentah)) recruiter_signal += 3;              // no informal writing
  if (cv.pengalaman_mentah.toLowerCase().includes(jd.judul_role.toLowerCase())) recruiter_signal += 2; // role keyword in headline/exp
  recruiter_signal = Math.min(recruiter_signal, 10);

  // --- effort: time needed to close all gaps (10 = fast, 0 = months away) ---
  let effort = 10;
  if (matchRatio < 0.3)      effort = 2;
  else if (matchRatio < 0.5) effort = 5;
  // matchRatio >= 0.5 → effort stays 10

  // --- opportunity_cost: sacrifice required to fix gaps (10 = near-zero cost) ---
  // Low effort means skills are acquirable cheaply; high missing-skills ratio means
  // the candidate must invest more (time, money, foregone earnings).
  const opportunity_cost = effort < 5 ? 5 : 10;

  // --- risk: will these skills still be in demand in 2-3 years? ---
  let risk = 5; // neutral baseline
  const fundamentalSkills = ['excel', 'komunikasi', 'manajemen proyek', 'leadership'];
  if (jd.skills_diminta.some(s => fundamentalSkills.includes(s.toLowerCase()))) risk += 3;
  // Stable-demand industries get a bonus
  if (['FMCG', 'Finance', 'Pemerintahan'].includes(jd.industri)) risk += 2;
  risk = Math.min(risk, 10);

  // --- portfolio: evidence of real-world impact ---
  let portfolio = 0;
  if (has_numbers) {
    portfolio = number_count >= 3 ? 8 : 5;
  } else {
    portfolio = 2; // no quantified achievements — weak signal
  }
  if (has_certs) portfolio = Math.min(portfolio + 2, 10);

  return { north_star, recruiter_signal, effort, opportunity_cost, risk, portfolio };
}

/**
 * Sums the 6D dimensions and scales to 0-100.
 * Identical formula to the pre-refactor code.
 */
export function computeSkor(skor_6d) {
  const total6D = DIMS.reduce((s, d) => s + skor_6d[d], 0);
  return { total6D, skor: Math.round((total6D / 60) * 100) };
}

/**
 * Determines DO/DO NOT/TIMED verdict and computes timebox_weeks for TIMED.
 * Thresholds match the pre-refactor code exactly.
 * timebox_weeks is now derived from missing skill count (was previously LLM-provided).
 */
export function determineVeredict(total6D, analysisResult) {
  const veredict = total6D >= 42 ? 'DO' : total6D < 24 ? 'DO NOT' : 'TIMED';

  let timebox_weeks = null;
  if (veredict === 'TIMED') {
    // 1.5 weeks per missing skill + 4-week base; clamped to [4, 12]
    const raw = Math.round(analysisResult.skill_match.missing.length * 1.5 + 4);
    timebox_weeks = Math.min(12, Math.max(4, raw));
  }

  return { veredict, timebox_weeks };
}

/**
 * Estimates the candidate's projected score after fixing closeable gaps.
 *
 * Formula: skor + 10 (minimum headroom) + improvement potential, rounded to
 * nearest 5, clamped to [skor+10, 95].
 *
 * Improvement potential = min(20, missing_skills * 3) + 5 if no numbers.
 *
 * NOTE: This replaces the previous LLM-generated skor_sesudah, which was
 * arbitrary and inconsistent. The new value is deterministic and based on
 * actual identified gaps.
 */
export function computeSkorSesudah(skor, analysisResult) {
  const gapPotential      = Math.min(20, analysisResult.skill_match.missing.length * 3);
  const numberPotential   = analysisResult.has_numbers ? 0 : 5;
  const improvementTotal  = Math.min(25, gapPotential + numberPotential);
  const raw = skor + 10 + improvementTotal;
  // Math.round can push below skor+10 when skor%5 ∈ {2,3,4}. Clamp explicitly.
  return Math.min(95, Math.max(skor + 10, Math.round(raw / 5) * 5));
}
