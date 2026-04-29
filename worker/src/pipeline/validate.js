/**
 * Stage 6 — Schema validators for all LLM outputs.
 * Every validator returns { valid: boolean, errors: string[] }.
 * Callers throw on failure and may retry once with a correction prompt.
 */

/**
 * Validates the JSON object returned by SKILL_EXTRACT (Stage 1).
 */
export function validateExtractOutput(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['Output bukan object JSON'] };
  }

  const errors = [];
  const { cv, jd } = parsed;

  if (!cv || typeof cv !== 'object') errors.push('cv missing or not object');
  if (!jd || typeof jd !== 'object') errors.push('jd missing or not object');
  if (errors.length) return { valid: false, errors };

  // cv field checks
  if (typeof cv.pengalaman_mentah !== 'string') errors.push('cv.pengalaman_mentah must be string');
  if (typeof cv.skills_mentah     !== 'string') errors.push('cv.skills_mentah must be string');
  if (typeof cv.angka_di_cv       !== 'string') errors.push('cv.angka_di_cv must be string');

  if (!cv.format_cv || typeof cv.format_cv !== 'object') {
    errors.push('cv.format_cv missing or not object');
  } else {
    // LLM sometimes returns "true"/"false" strings — coerce them before type check
    if (typeof cv.format_cv.satu_kolom === 'string') cv.format_cv.satu_kolom = cv.format_cv.satu_kolom === 'true';
    if (typeof cv.format_cv.ada_tabel  === 'string') cv.format_cv.ada_tabel  = cv.format_cv.ada_tabel  === 'true';
    if (typeof cv.format_cv.satu_kolom !== 'boolean') errors.push('cv.format_cv.satu_kolom must be boolean');
    if (typeof cv.format_cv.ada_tabel  !== 'boolean') errors.push('cv.format_cv.ada_tabel must be boolean');
  }

  // jd field checks
  if (!Array.isArray(jd.skills_diminta)) errors.push('jd.skills_diminta must be array');
  if (jd.pengalaman_minimal !== null && typeof jd.pengalaman_minimal !== 'number') {
    errors.push('jd.pengalaman_minimal must be number or null');
  }
  if (typeof jd.industri   !== 'string') errors.push('jd.industri must be string');
  if (typeof jd.judul_role !== 'string') errors.push('jd.judul_role must be string');

  return { valid: errors.length === 0, errors };
}

/**
 * Validates the JSON object returned by SKILL_DIAGNOSE (Stage 4).
 */
export function validateDiagnoseOutput(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['Output bukan object JSON'] };
  }

  const errors = [];

  if (!Array.isArray(parsed.gap))          errors.push('gap must be array');
  if (!Array.isArray(parsed.rekomendasi))  errors.push('rekomendasi must be array');
  if (!Array.isArray(parsed.kekuatan))     errors.push('kekuatan must be array');

  if (!parsed.alasan_skor || typeof parsed.alasan_skor !== 'string') {
    errors.push('alasan_skor must be non-empty string');
  }

  if (!['Rendah', 'Sedang', 'Tinggi'].includes(parsed.konfidensitas)) {
    errors.push('konfidensitas must be "Rendah", "Sedang", or "Tinggi"');
  }

  if (!parsed.hr_7_detik || typeof parsed.hr_7_detik !== 'object') {
    errors.push('hr_7_detik missing or not object');
  } else {
    if (!Array.isArray(parsed.hr_7_detik.kuat))      errors.push('hr_7_detik.kuat must be array');
    if (!Array.isArray(parsed.hr_7_detik.diabaikan)) errors.push('hr_7_detik.diabaikan must be array');
  }

  // red_flags is optional — only validate type when present
  if (parsed.red_flags !== undefined && !Array.isArray(parsed.red_flags)) {
    errors.push('red_flags must be array when present');
  }

  return { valid: errors.length === 0, errors };
}
