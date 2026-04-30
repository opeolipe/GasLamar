import { SKILL_TAILOR_ID } from './prompts/tailorId.js';
import { SKILL_TAILOR_EN } from './prompts/tailorEn.js';
import { callClaude }      from './claude.js';
import { sha256Hex }       from './utils.js';
import { postProcessCV }   from './rewriteGuard.js';

const GEN_KEY_PREFIX_ID = 'gen_id_v2_';
const GEN_KEY_PREFIX_EN = 'gen_en_v2_';

/**
 * Returns the first missing required section heading, 'too short' if the text
 * is under 200 chars, or null if the CV passes all checks.
 */
export function validateCVSections(text, lang) {
  const required = lang === 'id'
    ? ['RINGKASAN PROFESIONAL', 'PENGALAMAN KERJA', 'PENDIDIKAN', 'KEAHLIAN']
    : ['PROFESSIONAL SUMMARY', 'WORK EXPERIENCE', 'EDUCATION', 'SKILLS'];
  for (const h of required) {
    if (!text.includes(h)) return h;
  }
  if (text.trim().length < 200) return 'too short';
  return null;
}

/**
 * Builds a ground-truth anchor block from Stage 1 extraction data.
 * Injected into the tailor prompt so the model has an explicit list of what
 * numbers and tool terms it is allowed to use — the primary hallucination guard.
 */
function buildGroundTruthBlock(cv, lang = 'id') {
  if (!cv) return '';
  const entitasStr = cv.entitas_klaim && cv.entitas_klaim.length > 0
    ? cv.entitas_klaim.join(', ').slice(0, 500)
    : null;

  if (lang === 'id') {
    return `\n--- GROUND TRUTH (dari ekstraksi otomatis CV asli) ---
Angka di CV: ${cv.angka_di_cv || 'NOL ANGKA'}
Skills eksplisit: ${(cv.skills_mentah || '').slice(0, 300) || '(tidak tersedia)'}
Tools/entitas: ${entitasStr || 'tidak tersedia'}
LARANGAN:
· Jangan menambahkan angka baru yang tidak ada di daftar di atas
· Jangan mengklaim pengalaman atau tool yang tidak ada di CV asli
BOLEH:
· Menggunakan istilah dari job description TANPA mengklaim pengalaman baru
--- AKHIR GROUND TRUTH ---\n`;
  }

  return `\n--- GROUND TRUTH (auto-extracted from original CV) ---
Numbers in CV: ${cv.angka_di_cv || 'NONE'}
Explicit skills: ${(cv.skills_mentah || '').slice(0, 300) || '(not available)'}
Tools/entities: ${entitasStr || 'not available'}
PROHIBITED:
· Do not add numbers not listed above
· Do not claim experience or tools not in the original CV
ALLOWED:
· Use terms from the job description WITHOUT claiming new experience
--- END GROUND TRUTH ---\n`;
}

/**
 * Truncates very long CVs before sending to the LLM.
 * Only applies when cvText.length > 4000.
 * Strategy: section-aware — keep header + 2 most recent experience entries + skills.
 * Falls back to a hard cut at 10 000 chars if section parsing yields no reduction.
 */
function truncateCV(cvText) {
  const THRESHOLD  = 4000;
  const HARD_LIMIT = 10000;
  if (cvText.length <= THRESHOLD) return cvText;

  const lines     = cvText.split('\n');
  const EXP_RE    = /^(PENGALAMAN KERJA|WORK EXPERIENCE|EXPERIENCE)\s*$/i;
  const SKILLS_RE = /^(KEAHLIAN|SKILLS|TECHNICAL SKILLS)\s*$/i;
  const ROLE_SEP  = /(?:—|–|--)/;

  let expIdx    = -1;
  let skillsIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (EXP_RE.test(t) && expIdx === -1) expIdx = i;
    if (SKILLS_RE.test(t)) skillsIdx = i;
  }

  if (expIdx >= 0) {
    const expEnd = skillsIdx > expIdx ? skillsIdx : lines.length;
    const roleHeaderIdxs = [];
    for (let i = expIdx + 1; i < expEnd; i++) {
      if (ROLE_SEP.test(lines[i])) roleHeaderIdxs.push(i);
    }
    if (roleHeaderIdxs.length >= 3) {
      const cutLine = roleHeaderIdxs[2];
      const kept    = [
        ...lines.slice(0, cutLine),
        ...(skillsIdx > 0 ? lines.slice(skillsIdx) : []),
      ];
      const result = kept.join('\n');
      if (result.length < cvText.length) {
        console.warn(JSON.stringify({ event: 'cv_truncated', original_len: cvText.length, result_len: result.length }));
        return result + '\n\n[... sebagian entri pengalaman dihapus untuk efisiensi pemrosesan ...]';
      }
    }
  }

  if (cvText.length > HARD_LIMIT) {
    const slice = cvText.slice(0, HARD_LIMIT);
    const cutAt = Math.max(slice.lastIndexOf('\n'), HARD_LIMIT - 200);
    console.warn(JSON.stringify({ event: 'cv_truncated_hard', original_len: cvText.length }));
    return cvText.slice(0, cutAt) + '\n\n[... CV diperpendek karena terlalu panjang ...]';
  }

  return cvText;
}

/**
 * @param {string}        cvText
 * @param {string}        jobDesc
 * @param {object}        env
 * @param {string}        [mode='pdf']           - ignored; both pdf+docx are generated internally
 * @param {object}        [options={}]
 * @param {string}        [options.issue]         - Primary issue key for issue-aware fallback
 * @param {string}        [options.previewSample] - Original CV line shown as "before" in Hasil
 * @param {string}        [options.previewAfter]  - Suggested rewrite shown as "after" in Hasil
 * @param {string[]|null} [options.entitasKlaim]  - Whitelist of claims already in user's CV
 * @param {object|null}   [options.roleProfile]   - Role profile from roleProfiles.js (inferred mode only)
 * @param {string}        [options.jdMode]        - 'targeted' | 'inferred'
 * @returns {Promise<{ text: string, docxText: string, isTrusted: boolean }>}
 */
export async function tailorCVID(cvText, jobDesc, env, mode = 'pdf', options = {}) {
  const { issue, previewSample, previewAfter, entitasKlaim = null, roleProfile = null, jdMode = 'targeted', extractedCV = null } = options;
  const effectiveCVText = truncateCV(cvText);

  // KV cache keyed on raw content — post-processing is applied per-call (after cache read)
  const genKey   = `${GEN_KEY_PREFIX_ID}${await sha256Hex(effectiveCVText + '||' + jobDesc)}`;
  const cached   = await env.GASLAMAR_SESSIONS.get(genKey);
  let   baseText = cached;

  if (!baseText) {
    // Inject role context only in inferred mode (weak JD) to guide bullet emphasis.
    // In targeted mode the JD is rich enough — role context would add noise.
    const roleContextBlock = (jdMode === 'inferred' && roleProfile)
      ? `\n--- ROLE CONTEXT (gunakan karena JD kurang detail) ---
Peran yang terdeteksi: ${roleProfile.label}
Kekuatan utama yang perlu ditonjolkan: ${roleProfile.keyStrengths.join(', ')}
Kata kerja yang disarankan: ${roleProfile.actionVerbs.slice(0, 5).join(', ')}
Tanggung jawab umum untuk peran ini: ${roleProfile.commonResponsibilities.join('; ')}

PENTING: Gunakan konteks ini untuk memilih bullet mana yang perlu ditekankan.
JANGAN tambahkan skill, angka, atau pengalaman yang tidak ada di CV asli.\n`
      : '';

    const groundTruthBlock = buildGroundTruthBlock(extractedCV, 'id');

    const systemPrompt = `${SKILL_TAILOR_ID}${roleContextBlock}${groundTruthBlock}
--- TASK ---
Tailoring CV ini untuk job description berikut.
PENTING: Jangan ubah fakta, hanya reframe dan highlight yang relevan.

CV ASLI:
${effectiveCVText}

JOB DESCRIPTION:
${jobDesc}

HEADING WAJIB - gunakan TEPAT teks ini, huruf kapital semua, tanpa titik dua:
RINGKASAN PROFESIONAL
PENGALAMAN KERJA
PENDIDIKAN
KEAHLIAN
SERTIFIKASI

Aturan heading: jangan ubah nama, jangan tambah heading lain.
Jika kandidat tidak punya sertifikasi, hapus section SERTIFIKASI sepenuhnya.

PRESERVASI WAJIB — TIDAK BOLEH DIUBAH SAMA SEKALI:
- Nama lengkap kandidat (baris pertama CV)
- Nama perusahaan / instansi tempat bekerja
- Jabatan / posisi di setiap peran
- Lokasi dan rentang tanggal (contoh: "Jan 2020 – Mar 2023")
- Nama institusi pendidikan dan gelar
- Baris header peran (format: "Nama Perusahaan — Jabatan") harus identik dengan CV asli

YANG BOLEH DIUBAH:
- Bullet point pengalaman (reframe, tambah konteks, perkuat kata kerja)
- Ringkasan profesional (tulis ulang agar relevan dengan posisi target)
- Urutan keahlian (prioritaskan yang sesuai JD)

Output CV dalam Bahasa Indonesia dengan urutan section di atas:
- RINGKASAN PROFESIONAL: 3-4 kalimat, highlight yang paling relevan untuk posisi ini
- PENGALAMAN KERJA: bullet points dengan kata kerja aktif Harvard, kuantifikasi achievement
- PENDIDIKAN
- KEAHLIAN: Core Skills | Tools | Bahasa

Output hanya teks CV, tidak ada komentar atau penjelasan tambahan.`;

    const result = await callClaude(env, systemPrompt, 'Tailoring CV sekarang.', 4096, 'claude-haiku-4-5-20251001');
    let text = result?.content?.[0]?.text?.trim() ?? '';
    const missing = result?.stop_reason === 'max_tokens' ? 'too short' : validateCVSections(text, 'id');
    if (missing) {
      const correction = missing === 'too short'
        ? 'PENTING: Output terlalu pendek. Tulis CV lengkap dengan semua sections.'
        : `PENTING: Section "${missing}" tidak ditemukan di output. Wajib disertakan persis seperti heading yang diminta.`;
      const retry = await callClaude(env, systemPrompt + '\n\n' + correction, 'Tailoring CV sekarang.', 4096, 'claude-haiku-4-5-20251001');
      if (retry?.stop_reason === 'max_tokens') throw new Error('CV terlalu besar untuk diproses. Coba ringkas CV kamu.');
      text = retry?.content?.[0]?.text?.trim() ?? text;
    }
    if (!text) throw new Error('CV Bahasa Indonesia kosong dari AI. Coba lagi.');

    baseText = text;
    await env.GASLAMAR_SESSIONS.put(genKey, baseText, { expirationTtl: 172800 });
  }

  const postOpts = { previewSample, previewAfter, entitasKlaim, language: 'id' };

  // Generate both variants from the same validated base text
  const { text: pdfText, isTrusted } = postProcessCV(baseText, effectiveCVText, issue, 'pdf',  postOpts);
  const { text: docxText }           = postProcessCV(baseText, effectiveCVText, issue, 'docx', postOpts);

  return { text: pdfText, docxText, isTrusted };
}

/**
 * @param {string}        cvText
 * @param {string}        jobDesc
 * @param {object}        env
 * @param {string}        [mode='pdf']           - ignored; both pdf+docx are generated internally
 * @param {object}        [options={}]
 * @param {string}        [options.previewSample]
 * @param {string}        [options.previewAfter]
 * @param {string[]|null} [options.entitasKlaim]
 * @param {object|null}   [options.roleProfile]   - Role profile from roleProfiles.js (inferred mode only)
 * @param {string}        [options.jdMode]        - 'targeted' | 'inferred'
 * @returns {Promise<{ text: string, docxText: string, isTrusted: boolean }>}
 */
export async function tailorCVEN(cvText, jobDesc, env, mode = 'pdf', options = {}) {
  const { previewSample, previewAfter, entitasKlaim = null, roleProfile = null, jdMode = 'targeted', extractedCV = null } = options;
  const effectiveCVText = truncateCV(cvText);

  const genKey   = `${GEN_KEY_PREFIX_EN}${await sha256Hex(effectiveCVText + '||' + jobDesc)}`;
  const cached   = await env.GASLAMAR_SESSIONS.get(genKey);
  let   baseText = cached;

  if (!baseText) {
    const roleContextBlock = (jdMode === 'inferred' && roleProfile)
      ? `\n--- ROLE CONTEXT (use because JD lacks detail) ---
Detected role: ${roleProfile.label}
Key strengths to highlight: ${roleProfile.keyStrengths.join(', ')}
Suggested action verbs: ${roleProfile.actionVerbs.slice(0, 5).join(', ')}
Common responsibilities for this role: ${roleProfile.commonResponsibilities.join('; ')}

IMPORTANT: Use this context to choose which bullets to emphasise.
Do NOT add skills, numbers, or experience not present in the original CV.\n`
      : '';

    const groundTruthBlock = buildGroundTruthBlock(extractedCV, 'en');

    const systemPrompt = `${SKILL_TAILOR_EN}${roleContextBlock}${groundTruthBlock}
--- TASK ---
Translate and tailor this CV for the job description below.
IMPORTANT: Do not change facts - only reframe and highlight what's relevant.

ORIGINAL CV (in Indonesian):
${effectiveCVText}

JOB DESCRIPTION:
${jobDesc}

MANDATORY HEADINGS - use EXACTLY these, all caps, no colon:
PROFESSIONAL SUMMARY
WORK EXPERIENCE
EDUCATION
SKILLS
CERTIFICATIONS

Heading rules: do not alter heading names, do not add other headings.
If the candidate has no certifications, omit the CERTIFICATIONS section entirely.

MANDATORY VERBATIM PRESERVATION — DO NOT ALTER:
- Candidate's full name (first line of CV)
- All company / employer names
- All job titles / roles at each position
- All locations and date ranges (e.g., "Jan 2020 – Mar 2023")
- All education institution names and degree names
- Role header lines (format: "Company Name — Job Title") must be identical to the original

WHAT YOU MAY CHANGE:
- Experience bullet points (reframe, add context, strengthen action verbs)
- Professional summary (rewrite to be relevant to the target role)
- Skills ordering (prioritize those matching the JD)

Output the CV in English with sections in that order:
- PROFESSIONAL SUMMARY: 3-4 sentences, highlight most relevant for this role
- WORK EXPERIENCE: Harvard action verb bullets, quantified achievements (only original numbers)
- EDUCATION
- SKILLS: Core Skills | Tools | Languages

Output only the CV text, no additional comments.`;

    const result = await callClaude(env, systemPrompt, 'Tailor the CV now.', 4096, 'claude-haiku-4-5-20251001');
    let text = result?.content?.[0]?.text?.trim() ?? '';
    const missing = result?.stop_reason === 'max_tokens' ? 'too short' : validateCVSections(text, 'en');
    if (missing) {
      const correction = missing === 'too short'
        ? 'IMPORTANT: Output too short. Write the complete CV with all sections.'
        : `IMPORTANT: Section "${missing}" is missing from the output. It must be included exactly as shown in the heading list.`;
      const retry = await callClaude(env, systemPrompt + '\n\n' + correction, 'Tailor the CV now.', 4096, 'claude-haiku-4-5-20251001');
      if (retry?.stop_reason === 'max_tokens') throw new Error('CV is too large to process. Please shorten your CV.');
      text = retry?.content?.[0]?.text?.trim() ?? text;
    }
    if (!text) throw new Error('English CV returned empty from AI. Please retry.');

    baseText = text;
    await env.GASLAMAR_SESSIONS.put(genKey, baseText, { expirationTtl: 172800 });
  }

  // For English CV: skip issue-based fallback (fallbacks are in Indonesian)
  // but still validate rewrites and enforce preview consistency
  const postOpts = { previewSample, previewAfter, entitasKlaim, language: 'en' };

  const { text: pdfText, isTrusted } = postProcessCV(baseText, effectiveCVText, null, 'pdf',  postOpts);
  const { text: docxText }           = postProcessCV(baseText, effectiveCVText, null, 'docx', postOpts);

  return { text: pdfText, docxText, isTrusted };
}
