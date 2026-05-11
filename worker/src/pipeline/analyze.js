/**
 * Stage 2 — Rule Engine (pure JavaScript, zero AI calls).
 * Takes the structured extraction output from Stage 1 and produces a
 * deterministic analysis object that feeds Stage 3 (scoring) and
 * Stage 4 (diagnose context).
 */

import { detectArchetype } from './archetypes.js';

// ---- Private helpers ----

/**
 * Bidirectional Indonesian ↔ English synonym map for common CV/JD skill terms.
 * Both directions are listed explicitly so lookups are O(1) regardless of
 * which language the JD or CV uses.
 */
const SKILL_SYNONYMS = {
  // Communication / soft skills
  'komunikasi':          'communication',
  'communication':       'komunikasi',
  'kepemimpinan':        'leadership',
  'leadership':          'kepemimpinan',
  'kerja tim':           'teamwork',
  'kerjasama':           'teamwork',
  'teamwork':            'kerja tim',
  'pemecahan masalah':   'problem solving',
  'problem solving':     'pemecahan masalah',
  'berpikir kritis':     'critical thinking',
  'critical thinking':   'berpikir kritis',
  'presentasi':          'presentation',
  'presentation':        'presentasi',
  'negosiasi':           'negotiation',
  'negotiation':         'negosiasi',
  'kreativitas':         'creativity',
  'creativity':          'kreativitas',
  'inovasi':             'innovation',
  'innovation':          'inovasi',
  'adaptasi':            'adaptability',
  'adaptability':        'adaptasi',
  // Business / functional skills
  'manajemen proyek':    'project management',
  'project management':  'manajemen proyek',
  'pemasaran':           'marketing',
  'marketing':           'pemasaran',
  'penjualan':           'sales',
  'sales':               'penjualan',
  'keuangan':            'finance',
  'finance':             'keuangan',
  'akuntansi':           'accounting',
  'accounting':          'akuntansi',
  'pengembangan bisnis': 'business development',
  'business development':'pengembangan bisnis',
  'layanan pelanggan':   'customer service',
  'pelayanan pelanggan': 'customer service',
  'customer service':    'layanan pelanggan',
  'manajemen':           'management',
  'management':          'manajemen',
  'pengadaan':           'procurement',
  'procurement':         'pengadaan',
  'perekrutan':          'recruitment',
  'rekrutmen':           'recruitment',
  'recruitment':         'perekrutan',
  'pelatihan':           'training',
  'training':            'pelatihan',
  'analisis':            'analysis',
  'analysis':            'analisis',
  'analitik':            'analytics',
  'analytics':           'analitik',
  'pelaporan':           'reporting',
  'reporting':           'pelaporan',
  'kepuasan pelanggan':  'customer satisfaction',
  'customer satisfaction':'kepuasan pelanggan',
  'keselamatan kerja':   'occupational safety',
  'occupational safety': 'keselamatan kerja',
};

/**
 * Case-insensitive substring matching of JD skills against the CV skills string.
 * Falls back to a synonym lookup when a direct match is not found, bridging
 * Indonesian ↔ English skill terms (e.g. JD "communication" matches CV "komunikasi").
 */
function matchSkills(cvSkillsStr, jdSkills) {
  const cv = (cvSkillsStr || '').toLowerCase();
  const total = jdSkills.length;
  // No skills specified → vacuous truth: all (zero) requirements are met. Avoids
  // unfairly penalising candidates whose JD simply didn't list skill keywords.
  if (total === 0) return { matched: [], missing: [], match_ratio: 1 };

  function skillFound(s) {
    const term = s.toLowerCase();
    if (cv.includes(term)) return true;
    const synonym = SKILL_SYNONYMS[term];
    return synonym ? cv.includes(synonym) : false;
  }

  const matched = jdSkills.filter(s => skillFound(s));
  const missing  = jdSkills.filter(s => !skillFound(s));
  return { matched, missing, match_ratio: matched.length / total };
}

/**
 * Strips calendar years (1900–2099) and phone-like sequences (9+ digits) from
 * angka_di_cv so they don't inflate has_numbers / number_count.
 * The raw string is still used by extractExperienceYears for "X tahun" parsing.
 */
function stripNonAchievementNumbers(angkaDiCv) {
  if (!angkaDiCv || angkaDiCv === 'NOL ANGKA') return angkaDiCv;
  return angkaDiCv
    .replace(/\b(19|20)\d{2}\b/g, '')               // calendar years: 2022, 2013, 1999 …
    .replace(/\b\d{9,}\b/g, '')                      // phone / ID numbers (9+ consecutive digits)
    .replace(/\b[DS][1-4]\b/gi, '')                  // Indonesian education degrees: D1–D4, S1–S3
    .replace(/\b\d{1,2}\+?\s*tahun\s+pengalaman\b/gi, '') // bare tenure: "14 tahun pengalaman", "14+ tahun pengalaman"
    .trim();
}

/**
 * Parses "X tahun" / "X+ tahun" patterns from the angka_di_cv string.
 * Returns the first matched number, or null if none found.
 */
function extractExperienceYears(angkaDiCv) {
  if (!angkaDiCv || angkaDiCv === 'NOL ANGKA') return null;
  // M11: Accept comma-decimal format ("10,5 tahun") common in Indonesian text.
  const m = angkaDiCv.match(/(\d+(?:[.,]\d+)?)\s*\+?\s*tahun/i);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
}

/**
 * Determines data quality confidence from CV word count and JD specificity.
 * This value is computed in code and overwrites any konfidensitas the LLM returns.
 */
function computeKonfidensitas(extractedData) {
  const { cv, jd } = extractedData;
  const totalWords = (cv.pengalaman_mentah + ' ' + cv.skills_mentah)
    .split(/\s+/).filter(Boolean).length;

  // 30-word floor: below this the LLM extraction has too little text to be reliable.
  // Threshold is intentionally conservative — a 25-word CV is still insufficient.
  if (totalWords < 30 || jd.industri === 'UMUM') return 'Rendah';
  if (totalWords >= 100 && jd.skills_diminta.length >= 3) return 'Tinggi';
  return 'Sedang';
}

// ---- Public API ----

/**
 * Runs the deterministic rule-engine analysis.
 *
 * @param {object} extractedData — output from Stage 1 (callExtract)
 * @returns {object} analysisResult — consumed by score.js and diagnose.js
 */
export function runAnalysis(extractedData) {
  const { cv, jd } = extractedData;

  const skill_match      = matchSkills(cv.skills_mentah, jd.skills_diminta);
  const experienceYears  = extractExperienceYears(cv.angka_di_cv);
  const experience_ok    = jd.pengalaman_minimal === null
    ? true
    : (experienceYears !== null && experienceYears >= jd.pengalaman_minimal);

  const angkaFiltered = stripNonAchievementNumbers(cv.angka_di_cv);
  const has_numbers   = angkaFiltered !== 'NOL ANGKA' && /\d/.test(angkaFiltered);
  const number_count  = has_numbers
    ? (angkaFiltered.match(/\d+/g) || []).length
    : 0;

  const format_ok   = !!(cv.format_cv.satu_kolom && !cv.format_cv.ada_tabel);

  // Normalize sertifikat before checking: strip degree codes the LLM may include
  // despite prompt instructions (e.g. "D1 Business Management"), and guard against
  // null/undefined if the field is missing from a malformed extraction.
  const sertifikatNorm = (cv.sertifikat || '').replace(/\b[DS][1-4]\b/gi, '').trim();
  const has_certs = sertifikatNorm.length > 0 && sertifikatNorm !== 'TIDAK ADA';

  // Word count of the experience section (proxy for CV completeness)
  const expWordCount = (cv.pengalaman_mentah || '').split(/\s+/).filter(Boolean).length;

  const red_flag_types = {
    multi_column:   !format_ok,
    no_numbers:     !has_numbers,
    very_short:     expWordCount < 30,
    // Explicit experience requirement exists in the JD but candidate doesn't meet it.
    // Only fires when pengalaman_minimal is a concrete number (not null).
    experience_gap: jd.pengalaman_minimal !== null && !experience_ok,
  };

  return {
    skill_match,
    experience_ok,
    experience_years: experienceYears,
    has_numbers,
    number_count,
    format_ok,
    has_certs,
    archetype:     detectArchetype(jd.judul_role),
    konfidensitas: computeKonfidensitas(extractedData),
    red_flag_types,
  };
}
