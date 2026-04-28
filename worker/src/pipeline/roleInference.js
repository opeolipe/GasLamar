/**
 * Stage 2.5 — Role Inference (pure JavaScript, zero AI calls).
 *
 * Classifies the candidate's primary role, seniority, and industry from the
 * Stage 1 extraction output and the Stage 2 analysis result.  Results feed:
 *   - Stage 3 (score.js): weighted 6D scores via applyRoleWeights()
 *   - Stage 4 (diagnose.js): role context block in user message
 *   - Stage 5 (tailoring.js): inferred-mode rewrite guidance
 *
 * No LLM calls are made here.  All classification is keyword-based.
 */

import { ROLE_KEYWORDS, ROLE_PROFILES, DEFAULT_WEIGHTS } from '../roleProfiles.js';

const DIMS = ['north_star', 'recruiter_signal', 'effort', 'opportunity_cost', 'risk', 'portfolio'];

// Dimensions eligible to be the "primary issue" (opportunity_cost is excluded
// because it is derived from effort and doesn't represent a standalone gap).
const ISSUE_DIMS = new Set(['north_star', 'recruiter_signal', 'effort', 'risk', 'portfolio']);

// ---- Private helpers ----

/**
 * Scores each role by counting how many of its keywords appear in signalText.
 * Returns entries sorted descending by score.
 */
function scoreRoles(signalText) {
  return Object.entries(ROLE_KEYWORDS)
    .map(([role, keywords]) => [role, keywords.filter(kw => signalText.includes(kw)).length])
    .sort(([, a], [, b]) => b - a);
}

/**
 * Derives seniority from years of experience and senior/mid title keywords
 * present in the experience text.
 */
function detectSeniority(pengalamanMentah, yearsExp) {
  const text = (pengalamanMentah || '').toLowerCase();
  if (
    (typeof yearsExp === 'number' && yearsExp >= 9) ||
    /senior|manager|manajer|\blead\b|supervisor|kepala\s|direktur|\bvp\b|chief/.test(text)
  ) return 'senior';
  if (
    (typeof yearsExp === 'number' && yearsExp >= 4) ||
    /specialist|spesialis|consultant|konsultan|\bofficer\b|coordinator|koordinator/.test(text)
  ) return 'mid';
  return 'junior';
}

// ---- Public API ----

/**
 * Infers role, confidence, secondary roles, seniority, and industry from the
 * Stage 1 extraction and the Stage 2 experience_years value.
 *
 * @param {object} extractedData  — Stage 1 output
 * @param {object} analysisResult — Stage 2 output (needs experience_years)
 * @returns {{ role, confidence, secondaryRoles, industry, seniority }}
 */
export function inferRole(extractedData, analysisResult) {
  const { cv, jd } = extractedData;

  // Build signal text: skills, experience, and the target job title all contribute.
  const signalText = [
    cv.skills_mentah,
    cv.pengalaman_mentah,
    jd.judul_role,
  ].join(' ').toLowerCase();

  const sorted = scoreRoles(signalText);
  const [[primaryRole, primaryScore], [, secondaryScore] = [null, 0]] = sorted;

  // Confidence is low when primary barely beats secondary, or when no keywords match.
  const confidence = primaryScore === 0
    ? 0
    : Math.round((primaryScore / (primaryScore + secondaryScore + 1)) * 100) / 100;

  const secondaryRoles = sorted.slice(1)
    .filter(([, s]) => s > 0)
    .map(([r]) => r);

  const seniority = detectSeniority(cv.pengalaman_mentah, analysisResult.experience_years);

  // Use JD industry when specific; fall back to generic label when JD is weak.
  const industry = (jd.industri && jd.industri !== 'UMUM') ? jd.industri : 'General';

  return {
    role: primaryRole,
    confidence,
    secondaryRoles,
    industry,
    seniority,
  };
}

/**
 * Multiplies each 6D dimension by the role's weight bias.
 * Result is clamped to [0, 10] to preserve the existing scale.
 * Returns a new object — does not mutate the input.
 *
 * @param {object} skor_6d     — raw scores { north_star, recruiter_signal, … }
 * @param {object|null} roleProfile — profile from ROLE_PROFILES, or null for no bias
 * @returns {object}           — weighted scores, same shape as skor_6d
 */
export function applyRoleWeights(skor_6d, roleProfile) {
  const weights = roleProfile?.weightBias ?? DEFAULT_WEIGHTS;
  const weighted = {};
  for (const dim of DIMS) {
    const raw    = skor_6d[dim] ?? 0;
    const factor = weights[dim] ?? 1.0;
    // Round to 1 decimal to keep scores readable; clamp to valid 0–10 range.
    weighted[dim] = Math.min(10, Math.max(0, Math.round(raw * factor * 10) / 10));
  }
  return weighted;
}

/**
 * Returns the dimension name with the lowest weighted score, restricted to
 * ISSUE_DIMS so that 'opportunity_cost' (a derived value) is never surfaced
 * as the primary issue.
 *
 * @param {object} skor_6d — (weighted) scores
 * @returns {string}        — dimension key
 */
export function computePrimaryIssue(skor_6d) {
  let worstDim   = 'north_star';
  let worstScore = Infinity;
  for (const dim of DIMS) {
    if (!ISSUE_DIMS.has(dim)) continue;
    if (skor_6d[dim] < worstScore) {
      worstScore = skor_6d[dim];
      worstDim   = dim;
    }
  }
  return worstDim;
}

/**
 * Returns true when the JD text has enough content for targeted scoring/rewriting.
 * A 'high' quality JD has ≥ 80 words and contains structural keywords.
 *
 * @param {string} text — raw job description text
 * @returns {boolean}
 */
export function isJDQualityHigh(text) {
  const clean = (text || '').trim().toLowerCase();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  const hasStructure =
    /requirement|qualification|skill|responsibilit|duties/.test(clean) ||
    /kualifikasi|syarat|kemampuan|tanggung jawab|tugas|jobdesk/.test(clean);
  return wordCount >= 80 && hasStructure;
}
