import { getSession } from './sessions.js';
import { hexToken } from './utils.js';
import { generateInterviewKitPdf } from './interviewKitPdf.js';
import { generateCVPdf } from './cvPdf.js';
import { generateCVDocx } from './cvDocx.js';
import { KV_CV_RESULT_PREFIX } from './constants.js';

function sanitizeFinalExportText(text) {
  return String(text || '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}(?=\s*[A-Za-z\u00C0-\u017E])\s*/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .trimEnd()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeInterviewKitPayload(value) {
  if (typeof value === 'string') return sanitizeFinalExportText(value);
  if (Array.isArray(value)) return value.map(sanitizeInterviewKitPayload);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeInterviewKitPayload(v);
    return out;
  }
  return value;
}

function toBase64(bytes) {
  // Pre-collect into an array then join once — avoids O(n) string copies from repeated +=
  // which causes quadratic memory behaviour on large PDFs (e.g. 2 MB → ~8 MB peak).
  const chars = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) chars[i] = String.fromCharCode(bytes[i]);
  return btoa(chars.join(''));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function classifyAttachment(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.includes('interview-kit')) return 'kit';
  // Anchor on the language label immediately before the extension so user names or
  // company names containing "indonesia"/"english" don't cause false positives.
  if (/[_-]indonesia\.pdf$/.test(lower))  return 'cv_id_pdf';
  if (/[_-]indonesia\.docx$/.test(lower)) return 'cv_id_docx';
  if (/[_-]english\.pdf$/.test(lower))    return 'cv_en_pdf';
  if (/[_-]english\.docx$/.test(lower))   return 'cv_en_docx';
  return 'other';
}

// ── Filename builder ─────────────────────────────────────────────────────────
// Mirrors buildCVFilename() in lib/downloadUtils.ts — keep both in sync.

function sanitizeFilenamePart(raw, maxLen) {
  if (!raw) return null;
  const ACCENT_MAP = {
    é:'e', è:'e', ê:'e', ë:'e', à:'a', â:'a', ä:'a',
    î:'i', ï:'i', ô:'o', ö:'o', ù:'u', û:'u', ü:'u',
    ç:'c', ñ:'n', ã:'a', õ:'o',
  };
  let s = raw.replace(/[éèêëàâäîïôöùûüçñãõ]/gi, c => ACCENT_MAP[c.toLowerCase()] ?? '');
  s = s.replace(/[^a-zA-Z0-9\s-]/g, '').trim()
       .replace(/\s+/g, '-')
       .replace(/-+/g, '-')
       .slice(0, maxLen)
       .replace(/-+$/, '');
  return s || null;
}

function buildEmailFilename(cvText, jobTitle, company, lang, ext) {
  const nameLine = String(cvText || '')
    .split('\n').map(l => l.trim().replace(/^#+\s*/, ''))
    .find(l => l.length > 1 && l.length < 60) ?? null;
  const firstName = nameLine ? sanitizeFilenamePart(nameLine.split(/\s+/)[0], 20) : null;
  const langLabel = lang === 'id' ? 'Indonesia' : 'English';
  const parts = [firstName, sanitizeFilenamePart(jobTitle, 20), sanitizeFilenamePart(company, 20), langLabel].filter(Boolean);
  if (parts.length === 1) return `CV-${langLabel}.${ext}`;
  return parts.join('_') + '.' + ext;
}

async function readKitForEmail(env, sessionId) {
  // Prefer Indonesian cache for consistency with email body language,
  // then fallback to English cache so attachment is still present.
  const idEntry = await env.GASLAMAR_SESSIONS.get(`kit_${sessionId}_id`, { type: 'json' });
  const idKit = idEntry?.kit ?? idEntry;
  if (idKit && idKit.interview_questions) return idKit;

  const enEntry = await env.GASLAMAR_SESSIONS.get(`kit_${sessionId}_en`, { type: 'json' });
  const enKit = enEntry?.kit ?? enEntry;
  if (enKit && enKit.interview_questions) return enKit;
  return null;
}

// ---- Resend Email ----
//
// Sends a post-payment confirmation email via Resend API.
// RESEND_API_KEY must be set via: wrangler secret put RESEND_API_KEY
// FROM_EMAIL must be set or defaults to noreply@gaslamar.com.
// Silently skips if RESEND_API_KEY is absent — email is non-critical.
//
// Email links use a short-lived, single-use email_token instead of the raw
// session_id. This prevents session hijacking when emails are forwarded,
// cached by mail providers, or opened on a different device/browser.
// The token is stored in KV with a 1-hour TTL and deleted on first use.

const EMAIL_TOKEN_TTL = 3600; // 1 hour

/**
 * Generate a short-lived, single-use email token and store it in KV.
 * Returns the token string (32-char hex).
 */
async function createEmailToken(env, sessionId) {
  const token = hexToken(16); // 128 bits of entropy
  await env.GASLAMAR_SESSIONS.put(
    `email_token_${token}`,
    JSON.stringify({ session_id: sessionId }),
    { expirationTtl: EMAIL_TOKEN_TTL }
  );
  return token;
}

// Build an environment-aware frontend base URL so that email links point to
// the correct Pages deployment. In staging the email token is stored in the
// staging KV; if the link pointed to production the token lookup would 404.
function frontendBaseUrl(env) {
  return env.ENVIRONMENT === 'staging'
    ? 'https://staging.gaslamar.pages.dev'
    : 'https://gaslamar.com';
}

export async function sendPaymentConfirmationEmail(sessionId, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(JSON.stringify({ event: 'resend_api_key_missing', session_id: sessionId }));
    return;
  }

  const session = await getSession(env, sessionId);
  if (!session || !session.email) return;

  const baseUrl = frontendBaseUrl(env);
  const emailToken = await createEmailToken(env, sessionId);
  const downloadUrl = `${baseUrl}/download.html?token=${emailToken}`;

  const tierLabels = {
    coba:    'Coba Dulu (1 CV)',
    single:  'Single (1 CV Bilingual)',
    '3pack': '3-Pack (3 CV Bilingual)',
    jobhunt: 'Job Hunt Pack (10 CV Bilingual)',
  };
  const tierLabel       = tierLabels[session.tier] || session.tier;
  const totalCredits    = session.total_credits ?? 1;
  const creditsRemaining = session.credits_remaining ?? totalCredits;
  const isMulti         = totalCredits > 1;
  const validityText    = isMulti ? '30 hari' : '7 hari';

  const creditsNote = isMulti && creditsRemaining > 0
    ? `<div style="background:#EFF6FF;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0;font-size:14px;color:#1E40AF;font-weight:600">Kamu punya ${creditsRemaining} kredit CV tersisa</p>
        <p style="margin:6px 0 0;font-size:13px;color:#3B82F6">Gunakan untuk apply ke beberapa posisi berbeda — hasilnya bisa disesuaikan tiap job.</p>
      </div>`
    : '';

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:28px 20px;color:#1F2937">
      <div style="margin-bottom:28px">
        <img src="${baseUrl}/assets/logo.svg" alt="GasLamar" width="120" height="24" style="display:block;border:0">
      </div>

      <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">CV kamu sudah siap</h1>
      <p style="color:#6B7280;margin:0 0 24px;font-size:15px">Pembayaran berhasil. Hasil CV kamu sudah siap dibuka.</p>

      <p style="margin:0 0 20px;font-size:14px">Paket: <strong>${escapeHtml(tierLabel)}</strong></p>

      ${creditsNote}

      <div style="margin-bottom:20px">
        <a href="${downloadUrl}"
          style="display:inline-block;min-width:240px;background:#1B4FE8;color:#fff;font-weight:700;padding:14px 20px;border-radius:14px;text-decoration:none;font-size:16px;text-align:center">
          Buka hasil CV →
        </a>
      </div>

      <p style="font-size:13px;color:#6B7280;margin:0 0 24px">
        Tidak perlu login &bull; Bisa dibuka dari device mana saja &bull; Proses &plusmn;30 detik
      </p>

      <p style="font-size:13px;color:#6B7280;margin:0 0 4px">
        Link email berlaku 1 jam. Setelah dibuka, akses tetap aktif selama ${validityText}.
      </p>
      <p style="font-size:13px;color:#6B7280;margin:0 0 20px">
        Butuh link baru? <a href="${baseUrl}/access" style="color:#1B4FE8">${baseUrl.replace('https://', '')}/access</a>
      </p>

      <p style="font-size:13px;color:#6B7280;margin:0">
        Butuh bantuan? <a href="mailto:support@gaslamar.com" style="color:#1B4FE8">support@gaslamar.com</a>
      </p>
    </div>`;
  const text =
`CV kamu sudah siap.

Paket: ${tierLabel}
${isMulti && creditsRemaining > 0 ? `Kredit tersisa: ${creditsRemaining}\n` : ''}
Buka hasil CV: ${downloadUrl}

Link email berlaku 1 jam. Setelah dibuka, akses tetap aktif selama ${validityText}.
Butuh link baru: ${baseUrl}/access
Butuh bantuan: support@gaslamar.com`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'GasLamar <noreply@gaslamar.com>',
      to: [session.email],
      subject: 'Pembayaran berhasil — lanjut lihat hasil CV kamu',
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(JSON.stringify({ event: 'resend_api_error', status: res.status, body: body.slice(0, 300), session_id: sessionId }));
    throw new Error(`Email gagal terkirim (Resend ${res.status})`);
  }
  console.log(JSON.stringify({ event: 'resend_email_sent', session_id: sessionId, to: session.email }));
}

export async function sendResendAccessEmail(sessionId, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(JSON.stringify({ event: 'resend_api_key_missing', context: 'resend_access', session_id: sessionId }));
    return;
  }

  const session = await getSession(env, sessionId);
  if (!session || !session.email) return;

  const baseUrl = frontendBaseUrl(env);
  const emailToken = await createEmailToken(env, sessionId);
  const downloadUrl = `${baseUrl}/download.html?token=${emailToken}`;

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:28px 20px;color:#1F2937">
      <div style="margin-bottom:28px">
        <img src="${baseUrl}/assets/logo.svg" alt="GasLamar" width="120" height="24" style="display:block;border:0">
      </div>

      <p style="font-size:15px;color:#374151;margin:0 0 24px">
        Klik link di bawah untuk kembali ke hasil CV kamu.
      </p>

      <div style="margin-bottom:20px">
        <a href="${downloadUrl}"
          style="display:inline-block;min-width:240px;background:#1B4FE8;color:#fff;font-weight:700;padding:14px 20px;border-radius:14px;text-decoration:none;font-size:16px;text-align:center">
          Buka CV kamu →
        </a>
      </div>

      <p style="font-size:13px;color:#6B7280;margin:0 0 4px">
        Link email berlaku 1 jam untuk dibuka kembali.
      </p>
      <p style="font-size:13px;color:#6B7280;margin:0 0 20px">
        Butuh link baru? <a href="${baseUrl}/access" style="color:#1B4FE8">${baseUrl.replace('https://', '')}/access</a>
      </p>

      <p style="font-size:13px;color:#6B7280;margin:0">
        Butuh bantuan? <a href="mailto:support@gaslamar.com" style="color:#1B4FE8">support@gaslamar.com</a>
      </p>
    </div>`;
  const text =
`Klik link berikut untuk kembali ke hasil CV kamu:
${downloadUrl}

Link email berlaku 1 jam untuk dibuka kembali.
Butuh link baru: ${baseUrl}/access
Butuh bantuan: support@gaslamar.com`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'GasLamar <noreply@gaslamar.com>',
      to: [session.email],
      subject: 'Akses CV kamu — GasLamar',
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(JSON.stringify({ event: 'resend_access_email_error', status: res.status, body: body.slice(0, 300), session_id: sessionId }));
    throw new Error(`Access email gagal terkirim (Resend ${res.status})`);
  }
  console.log(JSON.stringify({ event: 'resend_access_email_sent', session_id: sessionId, to: session.email }));
}

// Sends a "CV siap" email after generation completes, with score badge + gaps + upsell.
// score: integer 0-100 (from frontend sessionStorage)
// gaps: string[] top 3 gaps from analysis result
export async function sendCVReadyEmail(sessionId, score, gaps, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(JSON.stringify({ event: 'resend_api_key_missing', context: 'cv_ready', session_id: sessionId }));
    return;
  }

  const session = await getSession(env, sessionId);
  if (!session || !session.email) return;

  // score may be null/undefined when called from resend-email (no frontend score available)
  const hasScore = score !== null && score !== undefined && !isNaN(Number(score));

  // ── Build email attachments (all non-critical — failures don't block the email) ──
  const attachments = [];

  // CV PDF + DOCX — always attach Indonesian; attach English for bilingual tiers.
  // Uses cv_id/cv_en (plain text) for PDFs and cv_id_docx/cv_en_docx for DOCX,
  // matching the website where PDF and DOCX use slightly different text variants.
  try {
    const cvResult = await env.GASLAMAR_SESSIONS.get(`${KV_CV_RESULT_PREFIX}${sessionId}`, { type: 'json' });
    if (cvResult) {
      const cvTier         = cvResult.tier ?? session.tier;
      const isBilingualTier = cvTier !== 'coba';
      const jobTitle       = cvResult.job_title ?? null;
      const company        = cvResult.company   ?? null;

      const sanitizedIdPdf  = typeof cvResult.cv_id       === 'string' ? sanitizeFinalExportText(cvResult.cv_id)       : null;
      const sanitizedEnPdf  = typeof cvResult.cv_en       === 'string' ? sanitizeFinalExportText(cvResult.cv_en)       : null;
      const sanitizedIdDocx = typeof cvResult.cv_id_docx  === 'string' ? sanitizeFinalExportText(cvResult.cv_id_docx)  : sanitizedIdPdf;
      const sanitizedEnDocx = typeof cvResult.cv_en_docx  === 'string' ? sanitizeFinalExportText(cvResult.cv_en_docx)  : sanitizedEnPdf;

      if (sanitizedIdPdf) {
        // generateCVDocx returns a base64 string (Packer.toBase64String) — use directly.
        const idDocxText = sanitizedIdDocx || sanitizedIdPdf;
        const [pdfBytes, idDocxB64] = await Promise.all([
          generateCVPdf(sanitizedIdPdf),
          generateCVDocx(idDocxText),
        ]);
        attachments.push({ filename: buildEmailFilename(sanitizedIdPdf, jobTitle, company, 'id', 'pdf'),  content: toBase64(pdfBytes) });
        attachments.push({ filename: buildEmailFilename(idDocxText,     jobTitle, company, 'id', 'docx'), content: idDocxB64 });
      }

      if (isBilingualTier && sanitizedEnPdf) {
        const enDocxText = sanitizedEnDocx || sanitizedEnPdf;
        const [pdfBytes, enDocxB64] = await Promise.all([
          generateCVPdf(sanitizedEnPdf),
          generateCVDocx(enDocxText),
        ]);
        attachments.push({ filename: buildEmailFilename(sanitizedEnPdf, jobTitle, company, 'en', 'pdf'),  content: toBase64(pdfBytes) });
        attachments.push({ filename: buildEmailFilename(enDocxText,     jobTitle, company, 'en', 'docx'), content: enDocxB64 });
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ event: 'cv_attachment_generation_failed', session_id: sessionId, error: e?.message }));
    // proceed without CV attachments
  }

  // Interview kit PDF
  // KV stores { kit: {...}, session_secret_hash } — extract the inner kit.
  try {
    const kitData = await readKitForEmail(env, sessionId);
    if (kitData) {
      const sanitizedKitData = sanitizeInterviewKitPayload(kitData);
      const pdfBytes = await generateInterviewKitPdf(sanitizedKitData);
      attachments.push({ filename: 'interview-kit.pdf', content: toBase64(pdfBytes) });
    }
  } catch (e) {
    console.error(JSON.stringify({ event: 'kit_attachment_generation_failed', session_id: sessionId, error: e?.message }));
    // proceed without interview kit attachment
  }

  const kitAttachment = attachments.find(a => classifyAttachment(a.filename) === 'kit') ?? null;

  // Single-use token — protects the session ID from email exposure
  const baseUrl = frontendBaseUrl(env);
  const emailToken = await createEmailToken(env, sessionId);
  const downloadUrl = `${baseUrl}/download.html?token=${emailToken}`;

  const scoreNum   = hasScore ? (typeof score === 'number' ? score : parseInt(score, 10) || 0) : null;
  const scoreColor = scoreNum !== null ? (scoreNum >= 75 ? '#059669' : scoreNum >= 50 ? '#D97706' : '#DC2626') : '#059669';
  const top3       = Array.isArray(gaps) ? gaps.slice(0, 3) : [];

  const gapsHtml = top3.length
    ? `<div style="background:#FFF7ED;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0 0 8px;font-size:14px;color:#92400E;font-weight:600">Perubahan utama yang meningkatkan peluang kamu:</p>
        <ol style="margin:0;padding-left:18px;font-size:13px;color:#78350F;line-height:1.8">
          ${top3.map(g => `<li>${escapeHtml(String(g).slice(0, 200))}</li>`).join('')}
        </ol>
      </div>`
    : '';

  const tierLabels   = { coba: 'Coba Dulu', single: 'Single', '3pack': '3-Pack', jobhunt: 'Job Hunt Pack' };
  const tierLabel    = tierLabels[session.tier] || session.tier;
  const isMulti      = (session.total_credits ?? 1) > 1;
  const validityText = isMulti ? '30 hari' : '7 hari';

  const upsellHtml = !isMulti
    ? `<div style="background:#EFF6FF;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:13px;color:#1E40AF;font-weight:600">Mau apply ke lebih banyak posisi?</p>
        <p style="margin:0;font-size:13px;color:#3B82F6">Gunakan <a href="${baseUrl}/?tier=3pack" style="color:#1B4FE8;font-weight:600">3-Pack</a> untuk generate CV berbeda per job. Lebih hemat dan peluang lebih tinggi.</p>
      </div>`
    : '';

  const hasIdPdf  = attachments.some(a => classifyAttachment(a.filename) === 'cv_id_pdf');
  const hasIdDocx = attachments.some(a => classifyAttachment(a.filename) === 'cv_id_docx');
  const hasEnPdf  = attachments.some(a => classifyAttachment(a.filename) === 'cv_en_pdf');
  const hasEnDocx = attachments.some(a => classifyAttachment(a.filename) === 'cv_en_docx');
  const hasKit    = !!kitAttachment;
  const attachNoteHtml = attachments.length > 0
    ? `<div style="background:#F0F9FF;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#0369A1">
        <p style="margin:0 0 6px;font-weight:600;color:#0C4A6E">File terlampir di email ini:</p>
        <ul style="margin:0;padding-left:18px;line-height:1.9">
          ${hasIdPdf  ? '<li><strong>CV Indonesia (.pdf)</strong> — siap kirim ke HRD</li>' : ''}
          ${hasIdDocx ? '<li><strong>CV Indonesia (.docx)</strong> — bisa diedit sebelum dikirim</li>' : ''}
          ${hasEnPdf  ? '<li><strong>CV English (.pdf)</strong> — for international applications</li>' : ''}
          ${hasEnDocx ? '<li><strong>CV English (.docx)</strong> — editable version for international applications</li>' : ''}
          ${hasKit ? '<li><strong>interview-kit.pdf</strong> — pertanyaan interview, contoh jawaban STAR, template email & WhatsApp</li>' : ''}
        </ul>
      </div>`
    : '';

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:28px 20px;color:#1F2937">
      <div style="margin-bottom:28px">
        <img src="${baseUrl}/assets/logo.svg" alt="GasLamar" width="120" height="24" style="display:block;border:0">
      </div>

      <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">CV kamu sekarang lebih siap</h1>
      <p style="color:#6B7280;margin:0 0 24px;font-size:15px">Kami sudah analisis dan perbaiki CV kamu.</p>

      ${scoreNum !== null ? `<div style="background:#F0FDF4;border-radius:12px;padding:16px 20px;margin-bottom:16px;text-align:center">
        <p style="margin:0;font-size:13px;color:#6B7280">Skor kecocokan</p>
        <p style="margin:4px 0 8px;font-size:40px;font-weight:800;color:${scoreColor}">${scoreNum}<span style="font-size:18px;color:#9CA3AF">/100</span></p>
        <ul style="list-style:none;margin:0;padding:0;font-size:12px;color:#6B7280;line-height:1.7;text-align:left;display:inline-block">
          <li>75+ → Sudah kuat untuk apply</li>
          <li>50–74 → Masih bisa ditingkatkan</li>
          <li>&lt;50 → Perlu perbaikan signifikan</li>
        </ul>
      </div>` : ''}

      ${gapsHtml}

      ${attachNoteHtml}

      <div style="margin-bottom:20px">
        <a href="${downloadUrl}"
          style="display:inline-block;min-width:240px;background:#1B4FE8;color:#fff;font-weight:700;padding:14px 20px;border-radius:14px;text-decoration:none;font-size:16px;text-align:center">
          Download CV kamu →
        </a>
      </div>

      <p style="font-size:13px;color:#6B7280;margin:0 0 24px">
        Lebih relevan &bull; Lebih jelas menunjukkan value &bull; Lebih mudah dibaca recruiter
      </p>

      ${upsellHtml}

      <p style="font-size:13px;color:#6B7280;margin:0 0 4px">
        Link email berlaku 1 jam. Setelah dibuka, akses tetap aktif selama ${validityText}.
      </p>
      <p style="font-size:13px;color:#6B7280;margin:0 0 20px">
        Butuh link baru? <a href="${baseUrl}/access" style="color:#1B4FE8">${baseUrl.replace('https://', '')}/access</a>
      </p>

      <p style="font-size:13px;color:#6B7280;margin:0">
        Butuh bantuan? <a href="mailto:support@gaslamar.com" style="color:#1B4FE8">support@gaslamar.com</a>
      </p>
    </div>`;
  const text =
`CV kamu sekarang lebih siap.
${scoreNum !== null ? `Skor kecocokan: ${scoreNum}/100\n` : ''}Paket: ${tierLabel}
${top3.length ? `Perubahan utama:\n- ${top3.map(g => String(g).slice(0, 200)).join('\n- ')}\n` : ''}
Download CV kamu: ${downloadUrl}

Link email berlaku 1 jam. Setelah dibuka, akses tetap aktif selama ${validityText}.
Butuh link baru: ${baseUrl}/access
Butuh bantuan: support@gaslamar.com`;

  const cvRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'GasLamar <noreply@gaslamar.com>',
      to: [session.email],
      subject: scoreNum !== null
        ? `Skor CV kamu: ${scoreNum}/100${hasKit ? ' — CV, DOCX & Interview Kit terlampir' : ' — CV & DOCX terlampir'}`
        : `CV kamu siap${hasKit ? ' — CV, DOCX & Interview Kit terlampir' : ' — CV & DOCX terlampir'}`,
      html,
      text,
      ...(attachments.length > 0 && { attachments }),
    }),
  });
  if (!cvRes.ok) {
    const body = await cvRes.text().catch(() => '');
    console.error(JSON.stringify({ event: 'resend_cv_ready_error', status: cvRes.status, body: body.slice(0, 300), session_id: sessionId }));
    throw new Error(`CV ready email gagal terkirim (Resend ${cvRes.status})`);
  }
  console.log(JSON.stringify({ event: 'resend_cv_ready_sent', session_id: sessionId, to: session.email }));
}
