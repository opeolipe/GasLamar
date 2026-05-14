/**
 * Stage 3 — Deterministic Scoring (pure JavaScript, zero AI calls).
 *
 * All 5D scores, the overall skor, verdict, and skor_sesudah are computed
 * entirely from the Stage 1 extraction and Stage 2 analysis outputs.
 * No LLM input is involved at this stage.
 *
 * Scoring logic follows the draft provided during planning; any deviation
 * from the previous LLM-generated scores is intentional and expected —
 * the new values are consistent across identical inputs, which the old
 * LLM-generated values were not.
 */

const DIMS = ['north_star', 'recruiter_signal', 'effort', 'risk', 'portfolio'];
const SCORE_BANDS = [2, 4, 6, 8, 10];

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

function splitExperienceLines(text) {
  return (text || '')
    .split(/\n|•|●|▪|◦|;|(?<=\.)\s+(?=[A-Z])/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function firstLine(text) {
  const [line = ''] = splitExperienceLines(text);
  return line.toLowerCase();
}

function isGenericOpening(line) {
  if (!line || line.length < 24) return true;
  const genericPatterns = [
    /bertanggung jawab/i,
    /pekerja keras/i,
    /mampu bekerja/i,
    /cepat belajar/i,
    /berpengalaman/i,
    /fresh graduate/i,
    /staff admin/i,
  ];
  return genericPatterns.some(p => p.test(line));
}

function hasScanabilityIssue(text) {
  const lines = splitExperienceLines(text);
  const words = (text || '').split(/\s+/).filter(Boolean).length;
  const hasBulletLike = /•|●|▪|◦|\n/.test(text || '') || lines.length >= 3;
  return words >= 80 && !hasBulletLike;
}

function passiveVagueRatio(text) {
  const lines = splitExperienceLines(text);
  if (lines.length === 0) return 1;
  const vagueRe = /\bmembantu\b|\bmelakukan\b|\bbertanggung jawab\b|\bmengerjakan\b|\bterlibat\b|\bmengikuti\b/i;
  let vague = 0;
  for (const line of lines) {
    if (vagueRe.test(line)) vague++;
  }
  return vague / lines.length;
}

function quantizeBand(raw, { allowTen = true } = {}) {
  const clamped = Math.max(0, Math.min(10, raw));
  const maxBand = allowTen ? 10 : 8;
  for (let i = SCORE_BANDS.length - 1; i >= 0; i--) {
    const band = SCORE_BANDS[i];
    if (band > maxBand) continue;
    if (clamped >= band) return band;
  }
  return 2;
}

// ---- Public API ----

/**
 * Computes the 5D sub-scores from extracted data and the Stage 2 analysis result.
 * Each dimension is an integer 0-10.
 *
 * @param {object} extractedData  — Stage 1 output
 * @param {object} analysisResult — Stage 2 output
 * @returns {object} skor_6d with keys matching the schema
 */
// Stop-words excluded when splitting a JD title into match tokens.
const TITLE_STOP_WORDS = new Set([
  'and', 'the', 'of', 'for', 'in', 'at', 'to', 'a', 'an',
  'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'yang', 'atau', 'pada',
]);

/**
 * Splits a JD title into meaningful keyword tokens (min 3 chars, no stop-words).
 * "Senior Marketing Manager" → ["senior", "marketing", "manager"]
 * Used for north_star and recruiter_signal bonuses so a partial title match
 * (e.g. CV says "Marketing" when JD says "Senior Marketing Manager") still scores.
 */
function titleTokens(judulRole) {
  return (judulRole || '')
    .toLowerCase()
    .split(/[\s\/\-,()]+/)
    .filter(t => t.length >= 3 && !TITLE_STOP_WORDS.has(t));
}

export function calculateScores(extractedData, analysisResult) {
  const { cv, jd } = extractedData;
  const { skill_match, format_ok, has_numbers, number_count, has_certs } = analysisResult;
  const matchRatio = skill_match.match_ratio;
  const expLower   = cv.pengalaman_mentah.toLowerCase();

  // Pre-compute title tokens once — reused in north_star and recruiter_signal.
  const tokens      = titleTokens(jd.judul_role);
  const titleInExp  = tokens.length > 0 && tokens.some(t => expLower.includes(t));

  // --- north_star: how well CV content aligns with target role ---
  let north_star = 0;
  if (matchRatio >= 0.7)      north_star += 6;
  else if (matchRatio >= 0.4) north_star += 4;
  else                        north_star += 2;

  // Bonus: any role-title keyword appears in experience text
  if (titleInExp) north_star += 2;
  // Bonus: industry appears in experience text (only meaningful when JD names an industry)
  if (jd.industri !== 'UMUM' && expLower.includes(jd.industri.toLowerCase())) north_star += 2;
  north_star = Math.min(north_star, 10);

  // --- recruiter_signal: recruiter first impression (7-second scan) ---
  const expText = cv.pengalaman_mentah || '';
  const opening = firstLine(expText);
  const genericOpening = isGenericOpening(opening);
  const scanabilityIssue = hasScanabilityIssue(expText);
  const typoIssue = hasTypos(expText);
  const vagueMajority = passiveVagueRatio(expText) > 0.5;
  const weakRolePositioning = !titleInExp && matchRatio < 0.5;

  let recruiter_signal_raw = 8;
  if (genericOpening) recruiter_signal_raw -= 2;
  if (!has_numbers) recruiter_signal_raw -= 2;
  if (vagueMajority) recruiter_signal_raw -= 1;
  if (scanabilityIssue) recruiter_signal_raw -= 1;
  if (typoIssue) recruiter_signal_raw -= 1;
  if (weakRolePositioning) recruiter_signal_raw -= 1;
  if (!format_ok) recruiter_signal_raw -= 1; // layout only prevents penalty

  // Small positive nudge: title match helps only when baseline is already strong.
  if (titleInExp && recruiter_signal_raw >= 7) recruiter_signal_raw += 1;

  let recruiterCap = 10;
  if (!has_numbers) recruiterCap = 6;
  if (genericOpening || scanabilityIssue) recruiterCap = Math.min(recruiterCap, 5);
  // Strict exception for clean but non-quantified CV.
  if (
    !has_numbers &&
    !genericOpening &&
    !scanabilityIssue &&
    !typoIssue &&
    !vagueMajority &&
    titleInExp &&
    format_ok &&
    matchRatio >= 0.7
  ) {
    recruiterCap = 8;
  }
  let recruiter_signal = Math.max(0, Math.min(recruiter_signal_raw, recruiterCap));

  // --- effort: time needed to close all gaps (10 = fast, 0 = months away) ---
  let effort = 8;
  if (matchRatio < 0.3)      effort = 2;
  else if (matchRatio < 0.5) effort = 6;

  // --- risk: will these skills still be in demand in 2-3 years? ---
  let risk = 5; // neutral baseline
  // Fundamental/durable skills listed in both Indonesian and English so JDs in
  // either language both receive the stability bonus (Set for O(1) lookup).
  const fundamentalSkills = new Set([
    'excel', 'spreadsheet',
    'komunikasi', 'communication',
    'kepemimpinan', 'leadership',
    'manajemen proyek', 'project management',
    'kerja tim', 'kerjasama', 'teamwork', 'collaboration',
    'pemecahan masalah', 'problem solving',
    'presentasi', 'presentation',
    'negosiasi', 'negotiation',
    'manajemen', 'management',
    'analisis', 'analysis', 'analitik', 'analytics',
    'layanan pelanggan', 'customer service',
  ]);
  if (jd.skills_diminta.some(s => fundamentalSkills.has(s.toLowerCase()))) risk += 3;
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

  north_star       = quantizeBand(north_star);
  recruiter_signal = quantizeBand(recruiter_signal, { allowTen: recruiterCap >= 10 });
  effort           = quantizeBand(effort);
  risk             = quantizeBand(risk);
  portfolio        = quantizeBand(portfolio);

  return { north_star, recruiter_signal, effort, risk, portfolio };
}

/**
 * Sums the 5D dimensions and scales to 0-100.
 * Identical formula to the pre-refactor code.
 */
export function computeSkor(skor_6d) {
  const total5D = DIMS.reduce((s, d) => s + (skor_6d[d] ?? 0), 0);
  return { total5D, skor: Math.round((total5D / 50) * 100) };
}

/**
 * Determines DO/DO NOT/TIMED verdict and computes timebox_weeks for TIMED.
 * Thresholds match the pre-refactor code exactly.
 * timebox_weeks is now derived from missing skill count (was previously LLM-provided).
 */
export function determineVeredict(total5D, analysisResult) {
  const veredict = total5D >= 35 ? 'DO' : total5D < 20 ? 'DO NOT' : 'TIMED';

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
