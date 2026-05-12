import { getSession } from './sessions.js';
import { hexToken } from './utils.js';
import { generateInterviewKitPdf } from './interviewKitPdf.js';

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  // Try to attach the pre-generated interview kit as PDF (non-critical)
  let kitAttachment = null;
  try {
    const kit = await env.GASLAMAR_SESSIONS.get(`kit_${sessionId}_id`, { type: 'json' });
    if (kit) {
      const pdfBytes = await generateInterviewKitPdf(kit);
      kitAttachment = {
        filename: 'interview-kit.pdf',
        content: toBase64(pdfBytes),
      };
    }
  } catch {
    // proceed without attachment
  }

  // Single-use token — protects the session ID from email exposure
  const baseUrl = frontendBaseUrl(env);
  const emailToken = await createEmailToken(env, sessionId);
  const downloadUrl = `${baseUrl}/download.html?token=${emailToken}`;

  const scoreNum   = typeof score === 'number' ? score : parseInt(score, 10) || 0;
  const scoreColor = scoreNum >= 75 ? '#059669' : scoreNum >= 50 ? '#D97706' : '#DC2626';
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

  const kitNoteHtml = kitAttachment
    ? `<div style="background:#F0F9FF;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#0369A1">
        <p style="margin:0 0 4px;font-weight:600;color:#0C4A6E">Interview Kit terlampir</p>
        <p style="margin:0">Email ini dilengkapi file <strong>interview-kit.pdf</strong> berisi pertanyaan interview, contoh jawaban, template email lamaran, pesan WhatsApp, dan perkenalan diri yang disesuaikan dengan posisi yang kamu lamar.</p>
      </div>`
    : '';

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:28px 20px;color:#1F2937">
      <div style="margin-bottom:28px">
        <img src="${baseUrl}/assets/logo.svg" alt="GasLamar" width="120" height="24" style="display:block;border:0">
      </div>

      <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">CV kamu sekarang lebih siap</h1>
      <p style="color:#6B7280;margin:0 0 24px;font-size:15px">Kami sudah analisis dan perbaiki CV kamu.</p>

      <div style="background:#F0FDF4;border-radius:12px;padding:16px 20px;margin-bottom:16px;text-align:center">
        <p style="margin:0;font-size:13px;color:#6B7280">Skor kecocokan</p>
        <p style="margin:4px 0 8px;font-size:40px;font-weight:800;color:${scoreColor}">${scoreNum}<span style="font-size:18px;color:#9CA3AF">/100</span></p>
        <ul style="list-style:none;margin:0;padding:0;font-size:12px;color:#6B7280;line-height:1.7;text-align:left;display:inline-block">
          <li>75+ → Sudah kuat untuk apply</li>
          <li>50–74 → Masih bisa ditingkatkan</li>
          <li>&lt;50 → Perlu perbaikan signifikan</li>
        </ul>
      </div>

      ${gapsHtml}

      ${kitNoteHtml}

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

  const cvRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'GasLamar <noreply@gaslamar.com>',
      to: [session.email],
      subject: `Skor CV kamu: ${scoreNum}/100 — ini yang sudah diperbaiki`,
      html,
      ...(kitAttachment && { attachments: [kitAttachment] }),
    }),
  });
  if (!cvRes.ok) {
    const body = await cvRes.text().catch(() => '');
    console.error(JSON.stringify({ event: 'resend_cv_ready_error', status: cvRes.status, body: body.slice(0, 300), session_id: sessionId }));
    throw new Error(`CV ready email gagal terkirim (Resend ${cvRes.status})`);
  }
  console.log(JSON.stringify({ event: 'resend_cv_ready_sent', session_id: sessionId, to: session.email }));
}
