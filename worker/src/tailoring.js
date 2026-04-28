import { SKILL_TAILOR_ID } from './prompts/tailorId.js';
import { SKILL_TAILOR_EN } from './prompts/tailorEn.js';
import { callClaude }      from './claude.js';
import { sha256Hex }       from './utils.js';
import { postProcessCV }   from './rewriteGuard.js';

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
 * @param {string}        cvText
 * @param {string}        jobDesc
 * @param {object}        env
 * @param {string}        [mode='pdf']           - ignored; both pdf+docx are generated internally
 * @param {object}        [options={}]
 * @param {string}        [options.issue]         - Primary issue key for issue-aware fallback
 * @param {string}        [options.previewSample] - Original CV line shown as "before" in Hasil
 * @param {string}        [options.previewAfter]  - Suggested rewrite shown as "after" in Hasil
 * @param {string[]|null} [options.entitasKlaim]  - Whitelist of claims already in user's CV
 * @returns {Promise<{ text: string, docxText: string, isTrusted: boolean }>}
 */
export async function tailorCVID(cvText, jobDesc, env, mode = 'pdf', options = {}) {
  const { issue, previewSample, previewAfter, entitasKlaim = null } = options;

  // KV cache keyed on raw content — post-processing is applied per-call (after cache read)
  const genKey   = `gen_id_${await sha256Hex(cvText + '||' + jobDesc)}`;
  const cached   = await env.GASLAMAR_SESSIONS.get(genKey);
  let   baseText = cached;

  if (!baseText) {
    const systemPrompt = `${SKILL_TAILOR_ID}

--- TASK ---
Tailoring CV ini untuk job description berikut.
PENTING: Jangan ubah fakta, hanya reframe dan highlight yang relevan.

CV ASLI:
${cvText}

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
  const { text: pdfText, isTrusted } = postProcessCV(baseText, cvText, issue, 'pdf',  postOpts);
  const { text: docxText }           = postProcessCV(baseText, cvText, issue, 'docx', postOpts);

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
 * @returns {Promise<{ text: string, docxText: string, isTrusted: boolean }>}
 */
export async function tailorCVEN(cvText, jobDesc, env, mode = 'pdf', options = {}) {
  const { previewSample, previewAfter, entitasKlaim = null } = options;

  const genKey   = `gen_en_${await sha256Hex(cvText + '||' + jobDesc)}`;
  const cached   = await env.GASLAMAR_SESSIONS.get(genKey);
  let   baseText = cached;

  if (!baseText) {
    const systemPrompt = `${SKILL_TAILOR_EN}

--- TASK ---
Translate and tailor this CV for the job description below.
IMPORTANT: Do not change facts - only reframe and highlight what's relevant.

ORIGINAL CV (in Indonesian):
${cvText}

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

  const { text: pdfText, isTrusted } = postProcessCV(baseText, cvText, null, 'pdf',  postOpts);
  const { text: docxText }           = postProcessCV(baseText, cvText, null, 'docx', postOpts);

  return { text: pdfText, docxText, isTrusted };
}
