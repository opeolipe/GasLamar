import { SKILL_ANALYZE } from './prompts/analyze.js';
import { callClaude } from './claude.js';
import { sha256Hex } from './utils.js';

// Private deterministic helpers

function normalize6DScore(v) {
  return Math.min(10, Math.max(0, Math.round(parseFloat(v) || 0)));
}

function computeTotalScore(skor_6d, dims) {
  return dims.reduce((s, d) => s + skor_6d[d], 0);
}

// ---- Analysis ----

export async function analyzeCV(cvText, jobDesc, env) {
  // --- Content-hash cache (v3) ---
  const cacheKey = `analysis_v3_${await sha256Hex(cvText.trim() + '||' + jobDesc.trim())}`;
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

  const userContent = `CV:\n${cvText}\n\nJOB DESCRIPTION:\n${jobDesc}`;
  const result = await callClaude(env, SKILL_ANALYZE, userContent, 1500, 'claude-sonnet-4-6');
  const text = result?.content?.[0]?.text || '{}';

  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const scoring = JSON.parse(cleaned);

  // Normalize 6D sub-scores — clamp each to 0-10 integer
  const dims = ['north_star', 'recruiter_signal', 'effort', 'opportunity_cost', 'risk', 'portfolio'];
  if (!scoring.skor_6d || typeof scoring.skor_6d !== 'object') scoring.skor_6d = {};
  for (const d of dims) {
    scoring.skor_6d[d] = normalize6DScore(scoring.skor_6d[d]);
  }

  // Compute skor deterministically: sum of 6 dims (0-60) scaled to 0-100
  const total6D = computeTotalScore(scoring.skor_6d, dims);
  scoring.skor = Math.round((total6D / 60) * 100);

  // Normalize veredict with fallback from thresholds
  const VALID_VEREDICT = ['DO', 'DO NOT', 'TIMED'];
  if (!VALID_VEREDICT.includes(scoring.veredict)) {
    scoring.veredict = total6D >= 42 ? 'DO' : total6D < 24 ? 'DO NOT' : 'TIMED';
  }

  // timebox_weeks — only valid for TIMED verdict
  if (scoring.veredict === 'TIMED') {
    const tw = parseInt(scoring.timebox_weeks) || 8;
    scoring.timebox_weeks = Math.min(12, Math.max(4, tw));
  } else {
    scoring.timebox_weeks = null;
  }

  // Normalize archetype
  const VALID_ARCHETYPES = ['Administrasi/GA', 'Marketing/Sales', 'Finance/Akuntansi', 'IT/Software', 'HRD', 'Operasional/Logistik', 'Customer Service', 'Manajemen/Leader', 'Fresh Graduate (trainee)', 'Lainnya'];
  if (!VALID_ARCHETYPES.includes(scoring.archetype)) scoring.archetype = 'Lainnya';

  // Confidence
  const VALID_CONF = ['Rendah', 'Sedang', 'Tinggi'];
  if (!VALID_CONF.includes(scoring.konfidensitas)) scoring.konfidensitas = 'Sedang';

  // skor_sesudah (computed before penalty — penalty will adjust it below)
  const sesudahRaw = Math.round((parseInt(scoring.skor_sesudah) || 0) / 5) * 5;
  scoring.skor_sesudah = Math.min(95, Math.max(scoring.skor + 10, sesudahRaw));

  // Ensure arrays contain only non-empty strings
  const ensureArray = val => Array.isArray(val) ? val.filter(s => typeof s === 'string' && s.trim()) : [];
  scoring.gap         = ensureArray(scoring.gap);
  scoring.rekomendasi = ensureArray(scoring.rekomendasi);
  scoring.kekuatan    = ensureArray(scoring.kekuatan);

  if (!scoring.hr_7_detik || typeof scoring.hr_7_detik !== 'object') delete scoring.hr_7_detik;
  if (!Array.isArray(scoring.red_flags) || scoring.red_flags.length === 0) {
    delete scoring.red_flags;
  } else {
    // Apply red-flag score penalty in code — the LLM detects issues but doesn't
    // self-penalise, so we enforce it here to ensure the score reflects the problems.
    applyRedFlagPenalty(scoring);
  }

  // Legacy backward-compat fields (mapped from 6D scores)
  scoring.skor_relevansi    = scoring.skor_6d.north_star * 4;
  scoring.skor_requirements = Math.round(scoring.skor_6d.recruiter_signal * 3);
  scoring.skor_kualitas     = Math.round(scoring.skor_6d.portfolio * 2);
  scoring.skor_keywords     = Math.round(scoring.skor_6d.recruiter_signal);

  // Store in cache (48-hour TTL).
  await env.GASLAMAR_SESSIONS.put(cacheKey, JSON.stringify(scoring), { expirationTtl: 172800 });

  return scoring;
}

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

  // Base + per-extra-flag (capped at -25 for this component)
  const extraFlags  = Math.min(flags.length - 1, 2);
  const basePenalty = 15 + extraFlags * 5;

  // Formatting-specific extra penalty
  const FORMAT_KEYWORDS = /format|karakter|parsing|ATS/i;
  const formattingPenalty = flags.some(f => FORMAT_KEYWORDS.test(f)) ? 10 : 0;

  const totalPenalty = basePenalty + formattingPenalty;

  scoring.skor = Math.max(0, scoring.skor - totalPenalty);
  // skor_sesudah must stay ≥ skor+10 and ≤ 95
  scoring.skor_sesudah = Math.min(95, Math.max(scoring.skor + 10, scoring.skor_sesudah - totalPenalty));
}
