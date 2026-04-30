import { getSession } from './sessions.js';
import { hexToken } from './utils.js';

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
  if (!session || !session.email) return; // no email stored for this session

  // Use a single-use token in the download link — never the raw session ID.
  // The token exchange endpoint (/exchange-token) sets the session cookie
  // and redirects to /download.html cleanly.
  const emailToken = await createEmailToken(env, sessionId);
  const downloadUrl = `${frontendBaseUrl(env)}/download.html?token=${emailToken}`;

  const tierLabels = {
    coba:    'Coba Dulu (1 CV)',
    single:  'Single (1 CV Bilingual)',
    '3pack': '3-Pack (3 CV Bilingual)',
    jobhunt: 'Job Hunt Pack (10 CV Bilingual)',
  };
  const tierLabel = tierLabels[session.tier] || session.tier;
  const totalCredits = session.total_credits ?? 1;
  const isMulti = totalCredits > 1;
  const validityText = isMulti ? '30 hari' : '7 hari';
  const creditsNote = isMulti
    ? `<div style="background:#EFF6FF;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0;font-size:14px;color:#1E40AF;font-weight:600">Kamu punya ${totalCredits} kredit CV</p>
        <p style="margin:6px 0 0;font-size:13px;color:#3B82F6">Simpan link ini — kamu bisa kembali kapan saja dalam 30 hari untuk generate CV berikutnya dengan job description berbeda.</p>
      </div>`
    : '';

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px">
        <span style="font-weight:800;font-size:20px;color:#1B4FE8">GasLamar</span>
      </div>
      <h1 style="font-size:22px;font-weight:700;color:#1F2937;margin-bottom:8px">Pembayaran Dikonfirmasi</h1>
      <p style="color:#6B7280;margin-bottom:20px">Paket <strong>${escapeHtml(tierLabel)}</strong> kamu sudah aktif.</p>
      ${creditsNote}
      <a href="${downloadUrl}"
        style="display:inline-block;background:#1B4FE8;color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;margin-bottom:24px">
        ${isMulti ? 'Mulai Generate CV →' : 'Download CV Sekarang →'}
      </a>
      <p style="font-size:12px;color:#9CA3AF">Link ini berlaku 1 jam. Kalau sudah kedaluwarsa, mulai ulang dari <a href="https://gaslamar.com/upload.html" style="color:#1B4FE8">sini</a>.</p>
      <p style="font-size:12px;color:#9CA3AF">Setelah membuka link, sesi kamu akan aktif selama ${validityText} di browser tersebut.</p>
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
      subject: `CV kamu siap download — GasLamar ${tierLabel}`,
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

  // Single-use token — protects the session ID from email exposure
  const emailToken = await createEmailToken(env, sessionId);
  const downloadUrl = `${frontendBaseUrl(env)}/download.html?token=${emailToken}`;

  const scoreNum = typeof score === 'number' ? score : parseInt(score, 10) || 0;
  const scoreColor = scoreNum >= 75 ? '#059669' : scoreNum >= 50 ? '#D97706' : '#DC2626';
  const top3 = Array.isArray(gaps) ? gaps.slice(0, 3) : [];
  const gapsHtml = top3.length
    ? `<div style="background:#FFF7ED;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0 0 8px;font-size:14px;color:#92400E;font-weight:600">3 gap utama yang sudah diperbaiki di CV tailored-mu:</p>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#78350F">
          ${top3.map(g => `<li style="margin-bottom:4px">${escapeHtml(String(g).slice(0, 200))}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const tierLabels = { coba: 'Coba Dulu', single: 'Single', '3pack': '3-Pack', jobhunt: 'Job Hunt Pack' };
  const tierLabel = tierLabels[session.tier] || session.tier;
  const isMulti = (session.total_credits ?? 1) > 1;

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px">
        <span style="font-weight:800;font-size:20px;color:#1B4FE8">GasLamar</span>
      </div>
      <h1 style="font-size:22px;font-weight:700;color:#1F2937;margin-bottom:8px">CV tailored-mu siap! 🎯</h1>
      <p style="color:#6B7280;margin-bottom:20px">Paket <strong>${escapeHtml(tierLabel)}</strong> — hasil analisis AI:</p>
      <div style="background:#F0FDF4;border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:center">
        <p style="margin:0;font-size:13px;color:#6B7280">Skor match CV kamu</p>
        <p style="margin:4px 0 0;font-size:40px;font-weight:800;color:${scoreColor}">${scoreNum}<span style="font-size:18px;color:#9CA3AF">/100</span></p>
      </div>
      ${gapsHtml}
      <a href="${downloadUrl}"
        style="display:inline-block;background:#1B4FE8;color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;margin-bottom:24px">
        Download CV Tailored →
      </a>
      ${isMulti ? '' : `<div style="background:#EFF6FF;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0;font-size:13px;color:#1E40AF">Punya loker lain? <a href="https://gaslamar.com/?tier=3pack" style="color:#1B4FE8;font-weight:600">Upgrade ke 3-Pack</a> dan hemat 40%.</p>
      </div>`}
      <p style="font-size:12px;color:#9CA3AF">Link download berlaku 1 jam. Pertanyaan? Email ke <a href="mailto:support@gaslamar.com" style="color:#1B4FE8">support@gaslamar.com</a></p>
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
      subject: `CV tailored-mu siap — skor match ${scoreNum}/100 🎯`,
      html,
    }),
  });
  if (!cvRes.ok) {
    const body = await cvRes.text().catch(() => '');
    console.error(JSON.stringify({ event: 'resend_cv_ready_error', status: cvRes.status, body: body.slice(0, 300), session_id: sessionId }));
    throw new Error(`CV ready email gagal terkirim (Resend ${cvRes.status})`);
  }
  console.log(JSON.stringify({ event: 'resend_cv_ready_sent', session_id: sessionId, to: session.email }));
}
