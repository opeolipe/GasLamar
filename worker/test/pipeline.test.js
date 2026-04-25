/**
 * pipeline.test.js — Unit tests for pure pipeline functions.
 * No HTTP, no KV, no fetchMock — pure function calls only.
 */
import { describe, it, expect } from 'vitest';
import { runAnalysis } from '../src/pipeline/analyze.js';
import { calculateScores, computeSkor, determineVeredict, computeSkorSesudah } from '../src/pipeline/score.js';
import { validateExtractOutput, validateDiagnoseOutput } from '../src/pipeline/validate.js';
import { detectArchetype } from '../src/pipeline/archetypes.js';
import { addsNewNumbers, addsNewClaims, validateRewrite, postProcessCV } from '../src/rewriteGuard.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function extracted({
  skills_mentah     = 'Node.js React SQL',
  pengalaman_mentah = 'Software Engineer PT XYZ 2020-2024 Node.js React SQL REST API backend',
  angka_di_cv       = '4 tahun pengalaman 30% peningkatan 2x produktivitas',
  sertifikat        = 'TIDAK ADA',
  satu_kolom        = true,
  ada_tabel         = false,
  skills_diminta    = ['Node.js', 'React', 'SQL'],
  pengalaman_minimal = 3,
  industri          = 'Tech',
  judul_role        = 'Software Engineer',
} = {}) {
  return {
    cv: {
      pengalaman_mentah,
      pendidikan: 'S1 Informatika UI 2020',
      skills_mentah,
      sertifikat,
      angka_di_cv,
      format_cv: { satu_kolom, ada_tabel },
    },
    jd: { skills_diminta, pengalaman_minimal, industri, judul_role },
  };
}

// ── runAnalysis — skill matching ──────────────────────────────────────────────

describe('runAnalysis — skill matching', () => {
  it('perfect match → match_ratio = 1, missing = []', () => {
    const r = runAnalysis(extracted());
    expect(r.skill_match.match_ratio).toBe(1);
    expect(r.skill_match.matched).toEqual(['Node.js', 'React', 'SQL']);
    expect(r.skill_match.missing).toEqual([]);
  });

  it('partial match (2 of 3) → match_ratio ≈ 0.667, one missing', () => {
    const r = runAnalysis(extracted({ skills_mentah: 'Node.js React' }));
    expect(r.skill_match.match_ratio).toBeCloseTo(0.667, 2);
    expect(r.skill_match.missing).toEqual(['SQL']);
  });

  it('no match → match_ratio = 0, all skills missing', () => {
    const r = runAnalysis(extracted({ skills_mentah: 'Word Excel PowerPoint' }));
    expect(r.skill_match.match_ratio).toBe(0);
    expect(r.skill_match.missing).toEqual(['Node.js', 'React', 'SQL']);
  });

  it('matching is case-insensitive', () => {
    const r = runAnalysis(extracted({ skills_mentah: 'node.js react sql' }));
    expect(r.skill_match.match_ratio).toBe(1);
  });

  it('empty JD skills → match_ratio = 0', () => {
    const r = runAnalysis(extracted({ skills_diminta: [] }));
    expect(r.skill_match.match_ratio).toBe(0);
    expect(r.skill_match.matched).toEqual([]);
  });
});

// ── runAnalysis — format and signals ─────────────────────────────────────────

describe('runAnalysis — format and signals', () => {
  it('satu_kolom=true, ada_tabel=false → format_ok = true', () => {
    expect(runAnalysis(extracted({ satu_kolom: true, ada_tabel: false })).format_ok).toBe(true);
  });

  it('satu_kolom=false → format_ok = false', () => {
    expect(runAnalysis(extracted({ satu_kolom: false })).format_ok).toBe(false);
  });

  it('ada_tabel=true → format_ok = false', () => {
    expect(runAnalysis(extracted({ ada_tabel: true })).format_ok).toBe(false);
  });

  it('angka_di_cv !== "NOL ANGKA" → has_numbers = true', () => {
    expect(runAnalysis(extracted({ angka_di_cv: '3 tahun' })).has_numbers).toBe(true);
  });

  it('angka_di_cv === "NOL ANGKA" → has_numbers = false', () => {
    expect(runAnalysis(extracted({ angka_di_cv: 'NOL ANGKA' })).has_numbers).toBe(false);
  });

  it('sertifikat !== "TIDAK ADA" → has_certs = true', () => {
    expect(runAnalysis(extracted({ sertifikat: 'AWS Certified Developer' })).has_certs).toBe(true);
  });

  it('red_flag_types.multi_column = true when !format_ok', () => {
    const r = runAnalysis(extracted({ satu_kolom: false }));
    expect(r.red_flag_types.multi_column).toBe(true);
    expect(r.red_flag_types.no_numbers).toBe(false);
  });

  it('red_flag_types.no_numbers = true when angka = NOL ANGKA', () => {
    expect(runAnalysis(extracted({ angka_di_cv: 'NOL ANGKA' })).red_flag_types.no_numbers).toBe(true);
  });

  it('red_flag_types.very_short = true for very short experience text', () => {
    expect(runAnalysis(extracted({ pengalaman_mentah: 'Admin kantor' })).red_flag_types.very_short).toBe(true);
  });
});

// ── runAnalysis — konfidensitas ───────────────────────────────────────────────

describe('runAnalysis — konfidensitas', () => {
  it('Rendah: short CV (< 30 total words)', () => {
    const r = runAnalysis(extracted({ pengalaman_mentah: 'Admin staff kantor', skills_mentah: 'Excel Word' }));
    expect(r.konfidensitas).toBe('Rendah');
  });

  it('Rendah: industri = UMUM regardless of word count', () => {
    const r = runAnalysis(extracted({ pengalaman_mentah: 'Developer berpengalaman '.repeat(10), industri: 'UMUM' }));
    expect(r.konfidensitas).toBe('Rendah');
  });

  it('Tinggi: >= 100 words and >= 3 skills_diminta', () => {
    // 9 × 12-word phrase = 108 words + 3 from skills_mentah = 111 total → Tinggi
    const r = runAnalysis(extracted({
      pengalaman_mentah: 'Membangun sistem aplikasi enterprise yang kompleks dan scalable dengan Node.js dan React '.repeat(9),
      skills_diminta: ['Node.js', 'React', 'SQL'],
      industri: 'Tech',
    }));
    expect(r.konfidensitas).toBe('Tinggi');
  });

  it('Sedang: enough words but only 2 skills_diminta', () => {
    const r = runAnalysis(extracted({
      pengalaman_mentah: 'Membangun sistem aplikasi enterprise yang kompleks dan scalable dengan Node.js dan React '.repeat(9),
      skills_diminta: ['Node.js', 'React'],
      industri: 'Tech',
    }));
    expect(r.konfidensitas).toBe('Sedang');
  });
});

// ── calculateScores — north_star ─────────────────────────────────────────────

describe('calculateScores — north_star thresholds', () => {
  it('matchRatio >= 0.7 → north_star >= 6', () => {
    const ext = extracted();
    expect(calculateScores(ext, runAnalysis(ext)).north_star).toBeGreaterThanOrEqual(6);
  });

  it('matchRatio 0.4–0.69 → north_star = 4 (no bonuses)', () => {
    // 2 of 4 = 0.5, role/industry not in exp text
    const ext = extracted({
      skills_mentah: 'Node.js React',
      skills_diminta: ['Node.js', 'React', 'SQL', 'TypeScript'],
      pengalaman_mentah: 'Developer backend tanpa skill yang relevan sekali',
      industri: 'Xyz',
      judul_role: 'Backend Developer',
    });
    const analysis = runAnalysis(ext);
    expect(analysis.skill_match.match_ratio).toBe(0.5);
    expect(calculateScores(ext, analysis).north_star).toBe(4);
  });

  it('matchRatio < 0.4 → north_star = 2 (no bonuses)', () => {
    const ext = extracted({
      skills_mentah: 'Word Excel',
      skills_diminta: ['Node.js', 'React', 'SQL', 'AWS', 'Docker'],
      pengalaman_mentah: 'Staff admin perkantoran biasa',
      industri: 'Xyz',
      judul_role: 'DevOps Engineer',
    });
    const analysis = runAnalysis(ext);
    expect(analysis.skill_match.match_ratio).toBe(0);
    expect(calculateScores(ext, analysis).north_star).toBe(2);
  });
});

// ── calculateScores — effort and opportunity_cost ─────────────────────────────

describe('calculateScores — effort and opportunity_cost', () => {
  it('matchRatio >= 0.5 → effort = 10, opportunity_cost = 10', () => {
    const ext = extracted();
    const scores = calculateScores(ext, runAnalysis(ext));
    expect(scores.effort).toBe(10);
    expect(scores.opportunity_cost).toBe(10);
  });

  it('matchRatio 0.4 (exactly) → effort = 5, opportunity_cost = 10', () => {
    // 2 of 5 = 0.4
    const ext = extracted({
      skills_mentah: 'Node.js React',
      skills_diminta: ['Node.js', 'React', 'SQL', 'AWS', 'Docker'],
    });
    const analysis = runAnalysis(ext);
    expect(analysis.skill_match.match_ratio).toBe(0.4);
    const scores = calculateScores(ext, analysis);
    expect(scores.effort).toBe(5);
    expect(scores.opportunity_cost).toBe(10); // 5 is not < 5
  });

  it('matchRatio < 0.3 → effort = 2, opportunity_cost = 5', () => {
    // 1 of 4 = 0.25
    const ext = extracted({
      skills_mentah: 'Node.js',
      skills_diminta: ['Node.js', 'React', 'SQL', 'AWS'],
    });
    const analysis = runAnalysis(ext);
    expect(analysis.skill_match.match_ratio).toBe(0.25);
    const scores = calculateScores(ext, analysis);
    expect(scores.effort).toBe(2);
    expect(scores.opportunity_cost).toBe(5);
  });
});

// ── calculateScores — recruiter_signal ───────────────────────────────────────

describe('calculateScores — recruiter_signal typo detection', () => {
  it('informal "yg" loses the 3-point typo-free bonus', () => {
    const extClean = extracted({ pengalaman_mentah: 'Software Engineer yang berpengalaman di Node.js REST API' });
    const extTypo  = extracted({ pengalaman_mentah: 'Software Engineer yg berpengalaman di Node.js REST API' });
    const clean = calculateScores(extClean, runAnalysis(extClean));
    const typo  = calculateScores(extTypo,  runAnalysis(extTypo));
    expect(clean.recruiter_signal - typo.recruiter_signal).toBe(3);
  });
});

// ── calculateScores — portfolio ───────────────────────────────────────────────

describe('calculateScores — portfolio', () => {
  it('no numbers, no certs → portfolio = 2', () => {
    const ext = extracted({ angka_di_cv: 'NOL ANGKA', sertifikat: 'TIDAK ADA' });
    expect(calculateScores(ext, runAnalysis(ext)).portfolio).toBe(2);
  });

  it('1 number (< 3), no certs → portfolio = 5', () => {
    const ext = extracted({ angka_di_cv: '3 tahun', sertifikat: 'TIDAK ADA' });
    expect(calculateScores(ext, runAnalysis(ext)).portfolio).toBe(5);
  });

  it('>= 3 numbers, no certs → portfolio = 8', () => {
    const ext = extracted({ angka_di_cv: '4 tahun 30% 2x output', sertifikat: 'TIDAK ADA' });
    expect(calculateScores(ext, runAnalysis(ext)).portfolio).toBe(8);
  });

  it('no numbers + certs → portfolio = 4 (2 + 2)', () => {
    const ext = extracted({ angka_di_cv: 'NOL ANGKA', sertifikat: 'AWS Certified' });
    expect(calculateScores(ext, runAnalysis(ext)).portfolio).toBe(4);
  });
});

// ── calculateScores — risk ────────────────────────────────────────────────────

describe('calculateScores — risk', () => {
  it('fundamental skill "excel" in JD → risk = 8 (base 5 + 3)', () => {
    const ext = extracted({ skills_diminta: ['excel', 'reporting'] });
    expect(calculateScores(ext, runAnalysis(ext)).risk).toBe(8);
  });

  it('stable industry "Finance" → risk >= 7 (base 5 + 2)', () => {
    const ext = extracted({ industri: 'Finance' });
    expect(calculateScores(ext, runAnalysis(ext)).risk).toBeGreaterThanOrEqual(7);
  });

  it('neutral industry, no fundamental skills → risk = 5', () => {
    const ext = extracted({ industri: 'Tech', skills_diminta: ['Node.js', 'React'] });
    expect(calculateScores(ext, runAnalysis(ext)).risk).toBe(5);
  });
});

// ── computeSkor ───────────────────────────────────────────────────────────────

describe('computeSkor', () => {
  it('total6D = 60 → skor = 100', () => {
    const dims = { north_star: 10, recruiter_signal: 10, effort: 10, opportunity_cost: 10, risk: 10, portfolio: 10 };
    expect(computeSkor(dims).skor).toBe(100);
  });

  it('total6D = 51 → skor = 85 (matches happy-path fixture)', () => {
    const dims = { north_star: 8, recruiter_signal: 10, effort: 10, opportunity_cost: 10, risk: 8, portfolio: 5 };
    expect(computeSkor(dims).skor).toBe(85);
  });

  it('total6D = 0 → skor = 0', () => {
    const dims = { north_star: 0, recruiter_signal: 0, effort: 0, opportunity_cost: 0, risk: 0, portfolio: 0 };
    expect(computeSkor(dims).skor).toBe(0);
  });

  it('exposes total6D for downstream use', () => {
    const dims = { north_star: 10, recruiter_signal: 10, effort: 10, opportunity_cost: 10, risk: 10, portfolio: 10 };
    expect(computeSkor(dims).total6D).toBe(60);
  });
});

// ── determineVeredict ─────────────────────────────────────────────────────────

describe('determineVeredict', () => {
  const noMissing   = { skill_match: { missing: [] } };
  const twoMissing  = { skill_match: { missing: ['SQL', 'Docker'] } };
  const manyMissing = { skill_match: { missing: new Array(20).fill('x') } };

  it('total6D >= 42 → DO, timebox_weeks = null', () => {
    const { veredict, timebox_weeks } = determineVeredict(42, noMissing);
    expect(veredict).toBe('DO');
    expect(timebox_weeks).toBeNull();
  });

  it('total6D < 24 → DO NOT, timebox_weeks = null', () => {
    const { veredict, timebox_weeks } = determineVeredict(23, noMissing);
    expect(veredict).toBe('DO NOT');
    expect(timebox_weeks).toBeNull();
  });

  it('24 <= total6D < 42 → TIMED with timebox_weeks', () => {
    const { veredict, timebox_weeks } = determineVeredict(30, twoMissing);
    expect(veredict).toBe('TIMED');
    expect(timebox_weeks).toBe(7); // round(2 * 1.5 + 4) = 7
  });

  it('timebox_weeks minimum = 4 even with 0 missing skills', () => {
    const { timebox_weeks } = determineVeredict(30, noMissing);
    expect(timebox_weeks).toBe(4); // round(0 * 1.5 + 4) = 4
  });

  it('timebox_weeks capped at 12 for many missing skills', () => {
    const { timebox_weeks } = determineVeredict(30, manyMissing);
    expect(timebox_weeks).toBe(12);
  });
});

// ── computeSkorSesudah ────────────────────────────────────────────────────────

describe('computeSkorSesudah', () => {
  it('missing skills raise the projected score', () => {
    const analysis = { skill_match: { missing: ['SQL', 'Docker'] }, has_numbers: true };
    // gapPotential=6, numberPotential=0, improvement=6, raw=66, round(66/5)*5=65
    expect(computeSkorSesudah(50, analysis)).toBe(65);
  });

  it('no numbers adds +5 to improvement', () => {
    const analysis = { skill_match: { missing: [] }, has_numbers: false };
    // improvement=5, raw=65, round(13)*5=65
    expect(computeSkorSesudah(50, analysis)).toBe(65);
  });

  it('result always >= skor + 10', () => {
    const analysis = { skill_match: { missing: [] }, has_numbers: true };
    // raw=70, round(14)*5=70
    expect(computeSkorSesudah(60, analysis)).toBeGreaterThanOrEqual(70);
  });

  it('result capped at 95', () => {
    const analysis = { skill_match: { missing: new Array(10).fill('x') }, has_numbers: false };
    // raw=120, min(95,120)=95
    expect(computeSkorSesudah(85, analysis)).toBe(95);
  });
});

// ── validateExtractOutput ─────────────────────────────────────────────────────

const VALID_EXTRACT = {
  cv: {
    pengalaman_mentah: 'Developer PT XYZ',
    pendidikan: 'S1 Informatika',
    skills_mentah: 'Node.js React',
    sertifikat: 'TIDAK ADA',
    angka_di_cv: '3 tahun',
    format_cv: { satu_kolom: true, ada_tabel: false },
  },
  jd: { skills_diminta: ['Node.js'], pengalaman_minimal: 2, industri: 'Tech', judul_role: 'Developer' },
};

describe('validateExtractOutput', () => {
  it('valid input → { valid: true, errors: [] }', () => {
    const r = validateExtractOutput(VALID_EXTRACT);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('null → invalid', () => {
    expect(validateExtractOutput(null).valid).toBe(false);
  });

  it('missing cv → invalid with cv-related error', () => {
    const r = validateExtractOutput({ jd: VALID_EXTRACT.jd });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('cv'))).toBe(true);
  });

  it('cv.pengalaman_mentah not a string → invalid', () => {
    const bad = { ...VALID_EXTRACT, cv: { ...VALID_EXTRACT.cv, pengalaman_mentah: 42 } };
    const r = validateExtractOutput(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('pengalaman_mentah'))).toBe(true);
  });

  it('jd.skills_diminta not array → invalid', () => {
    const bad = { ...VALID_EXTRACT, jd: { ...VALID_EXTRACT.jd, skills_diminta: 'Node.js' } };
    expect(validateExtractOutput(bad).valid).toBe(false);
  });

  it('jd.pengalaman_minimal = null → valid (null is allowed)', () => {
    const ok = { ...VALID_EXTRACT, jd: { ...VALID_EXTRACT.jd, pengalaman_minimal: null } };
    expect(validateExtractOutput(ok).valid).toBe(true);
  });
});

// ── validateDiagnoseOutput ────────────────────────────────────────────────────

const VALID_DIAGNOSE = {
  gap: ['kurang pengalaman SQL'],
  rekomendasi: ['Tambah proyek SQL'],
  kekuatan: ['Node.js solid'],
  alasan_skor: 'CV cukup baik',
  konfidensitas: 'Tinggi',
  hr_7_detik: { kuat: ['Node.js'], diabaikan: [] },
};

describe('validateDiagnoseOutput', () => {
  it('valid input → { valid: true }', () => {
    expect(validateDiagnoseOutput(VALID_DIAGNOSE).valid).toBe(true);
  });

  it('null → invalid', () => {
    expect(validateDiagnoseOutput(null).valid).toBe(false);
  });

  it('gap not array → invalid', () => {
    expect(validateDiagnoseOutput({ ...VALID_DIAGNOSE, gap: 'string' }).valid).toBe(false);
  });

  it('invalid konfidensitas value → invalid with error message', () => {
    const r = validateDiagnoseOutput({ ...VALID_DIAGNOSE, konfidensitas: 'High' });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('konfidensitas'))).toBe(true);
  });

  it('red_flags as array → valid (optional field)', () => {
    expect(validateDiagnoseOutput({ ...VALID_DIAGNOSE, red_flags: ['multi_column'] }).valid).toBe(true);
  });

  it('red_flags as non-array → invalid', () => {
    expect(validateDiagnoseOutput({ ...VALID_DIAGNOSE, red_flags: 'multi_column' }).valid).toBe(false);
  });
});

// ── detectArchetype ───────────────────────────────────────────────────────────

describe('detectArchetype', () => {
  it.each([
    ['Software Engineer',    'IT/Software'],
    ['Data Analyst',         'IT/Software'],
    ['Marketing Manager',    'Marketing/Sales'],
    ['Sales Executive',      'Marketing/Sales'],
    ['Akuntan Senior',       'Finance/Akuntansi'],
    ['Finance Controller',   'Finance/Akuntansi'],
    ['Staff Administrasi',   'Administrasi/GA'],
    ['General Affair',       'Administrasi/GA'],
    ['HRD Specialist',       'HRD'],
    ['Supervisor Gudang',    'Operasional/Logistik'],
    ['Customer Service Rep', 'Customer Service'],
    ['Senior Manager',       'Manajemen/Leader'],
    ['Head of Product',      'Manajemen/Leader'],
    ['Magang UI/UX',         'Fresh Graduate (trainee)'],
    ['Penulis Konten',       'Lainnya'],
  ])('%s → %s', (title, expected) => {
    expect(detectArchetype(title)).toBe(expected);
  });

  it('empty string → Lainnya', () => {
    expect(detectArchetype('')).toBe('Lainnya');
  });

  it('null → Lainnya', () => {
    expect(detectArchetype(null)).toBe('Lainnya');
  });
});

// ── addsNewNumbers ────────────────────────────────────────────────────────────

describe('addsNewNumbers', () => {
  it('new tahun metric in after → true', () => {
    expect(addsNewNumbers('pengalaman kerja solid', 'pengalaman kerja 5 tahun solid')).toBe(true);
  });

  it('same metric in both → false', () => {
    expect(addsNewNumbers('5 tahun pengalaman', 'lebih dari 5 tahun pengalaman kerja')).toBe(false);
  });

  it('no numbers in either → false', () => {
    expect(addsNewNumbers('bekerja keras setiap hari', 'bekerja keras dan disiplin setiap hari')).toBe(false);
  });

  it('percentage added → true', () => {
    expect(addsNewNumbers('meningkatkan penjualan produk', 'meningkatkan penjualan produk 30%')).toBe(true);
  });
});

// ── addsNewClaims ─────────────────────────────────────────────────────────────

describe('addsNewClaims', () => {
  it('new uppercase tool term (AWS) not in before → true', () => {
    expect(addsNewClaims('Membangun REST API backend', 'Membangun REST API backend menggunakan AWS')).toBe(true);
  });

  it('tool term already present in before → false', () => {
    expect(addsNewClaims('Membangun REST API AWS backend', 'Membangun REST API dan AWS Lambda backend')).toBe(false);
  });

  it('inflation "tim X orang" (no impliedBy required) → true', () => {
    expect(addsNewClaims('mengerjakan proyek frontend', 'memimpin tim 5 orang untuk proyek frontend')).toBe(true);
  });

  it('"memimpin tim" implied by "memimpin" already in before → false', () => {
    expect(addsNewClaims('memimpin pengembangan fitur produk', 'memimpin tim backend dan pengembangan fitur')).toBe(false);
  });

  it('"led a team" NOT implied by before → true', () => {
    expect(addsNewClaims('worked on frontend features daily', 'led a team on frontend features daily')).toBe(true);
  });

  it('"led a team" implied by "lead" in before → false', () => {
    expect(addsNewClaims('lead developer on frontend features', 'led a team on frontend features daily')).toBe(false);
  });

  it('term in entitasKlaim whitelist → false', () => {
    expect(addsNewClaims('built API backend', 'built API backend using AWS', ['aws'])).toBe(false);
  });
});

// ── validateRewrite ───────────────────────────────────────────────────────────

describe('validateRewrite', () => {
  it('identical before/after → false', () => {
    expect(validateRewrite('Membangun fitur backend Node.js REST API', 'Membangun fitur backend Node.js REST API')).toBe(false);
  });

  it('after shorter than before → false', () => {
    expect(validateRewrite('Membangun fitur backend Node.js dan REST API endpoint', 'Membangun fitur backend')).toBe(false);
  });

  it('adds new number → false', () => {
    expect(validateRewrite(
      'Meningkatkan performa aplikasi backend perusahaan',
      'Meningkatkan performa aplikasi backend perusahaan sebesar 40%',
    )).toBe(false);
  });

  it('weak filler "lebih baik" → false', () => {
    expect(validateRewrite(
      'Menyelesaikan tugas administratif harian di kantor',
      'Menyelesaikan tugas administratif harian di kantor dengan lebih baik dari sebelumnya',
    )).toBe(false);
  });

  it('valid improvement (longer, no new metrics/claims/filler) → true', () => {
    expect(validateRewrite(
      'Membangun REST API untuk sistem internal perusahaan',
      'Membangun dan memelihara REST API untuk sistem internal perusahaan menggunakan arsitektur yang bersih',
    )).toBe(true);
  });

  it('null/empty inputs → false', () => {
    expect(validateRewrite(null, 'some long enough text here')).toBe(false);
    expect(validateRewrite('some long enough text here', null)).toBe(false);
    expect(validateRewrite('', 'some long enough text here')).toBe(false);
  });
});

// ── postProcessCV ─────────────────────────────────────────────────────────────

describe('postProcessCV', () => {
  it('section headings pass through unchanged, isTrusted = true (no bullets)', () => {
    const cv = 'PENGALAMAN KERJA\nPENDIDIKAN\nKEAHLIAN';
    const { text, isTrusted } = postProcessCV(cv, cv);
    expect(text).toBe(cv);
    expect(isTrusted).toBe(true);
  });

  it('placeholder [..] in bullet → removed from output', () => {
    const original = 'Membangun sistem backend untuk platform e-commerce yang digunakan oleh ribuan pengguna aktif';
    const llm = `PENGALAMAN KERJA\n${original} [tingkatkan 40% efisiensi]`;
    const { text } = postProcessCV(llm, `PENGALAMAN KERJA\n${original}`);
    expect(text).not.toMatch(/\[.*\]/);
  });

  it('DOCX mode appends Indonesian guidance after first 3 bullet lines only', () => {
    const lines = [
      'Membangun REST API untuk sistem backend perusahaan yang skalabel dan andal',
      'Mengelola infrastruktur cloud dan pipeline deployment secara rutin harian',
      'Melakukan code review dan mentoring junior developer di dalam tim',
      'Menulis dokumentasi teknis lengkap untuk semua komponen sistem yang ada',
    ].map(b => `- ${b}`).join('\n');
    const cv = `PENGALAMAN KERJA\n${lines}`;
    const { text } = postProcessCV(cv, cv, null, 'docx');
    expect(text).toContain('catatan: tambahkan');
    expect((text.match(/catatan: tambahkan/g) || []).length).toBe(3);
  });

  it('DOCX mode with language=en uses English guidance', () => {
    const bullet = '- Developed REST API for enterprise backend systems and large applications';
    const cv = `WORK EXPERIENCE\n${bullet}`;
    const { text } = postProcessCV(cv, cv, null, 'docx', { language: 'en' });
    expect(text).toContain('note: add concrete results');
  });
});
