/**
 * GasLamar Cloudflare Worker
 * Secure API proxy + session manager for GasLamar.com
 *
 * Endpoints:
 *   POST /analyze         — CV scoring + gap analysis
 *   POST /create-payment  — Create Mayar invoice + KV session
 *   POST /webhook/mayar   — Receive Mayar webhook, update session status
 *   GET  /check-session   — Poll session status
 *   POST /get-session     — Retrieve CV data (post-payment, one-time)
 *   POST /generate        — Generate tailored CV via Claude API
 *
 * Environment variables (set via wrangler secret put):
 *   ANTHROPIC_API_KEY
 *   MAYAR_API_KEY
 *   MAYAR_API_KEY_SANDBOX
 *   MAYAR_WEBHOOK_SECRET
 *   ENVIRONMENT  ("production" | "sandbox")
 *
 * KV Binding: GASLAMAR_SESSIONS
 */

// ---- CORS ----

const ALLOWED_ORIGINS = [
  'https://gaslamar.com',
  'https://www.gaslamar.com',
  'https://gaslamar.pages.dev',
];

// Add localhost for local development
const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080'];

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ENVIRONMENT === 'production'
    ? ALLOWED_ORIGINS
    : [...ALLOWED_ORIGINS, ...DEV_ORIGINS];

  const allowedOrigin = allowed.includes(origin) ? origin : 'null';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function corsResponse(body, status, headers, request, env) {
  const corsHeaders = getCorsHeaders(request, env);
  return new Response(body, {
    status,
    headers: { ...corsHeaders, ...headers }
  });
}

function jsonResponse(data, status = 200, request, env) {
  return corsResponse(
    JSON.stringify(data),
    status,
    { 'Content-Type': 'application/json' },
    request,
    env
  );
}

// ---- Rate Limiting ----
//
// Uses Cloudflare Workers Rate Limiting API (atomic, no TOCTOU race).
// Each endpoint has its own binding declared in wrangler.toml [[unsafe.bindings]].
// The binding's .limit({ key }) call is atomic at the CF edge.
//
// Fallback: if the binding is absent (e.g. local dev without wrangler), allow through.
// This is safe — local dev is not public traffic.

async function checkRateLimit(env, limiterBinding, ip) {
  if (!limiterBinding) return true; // binding absent in local dev — allow
  const { success } = await limiterBinding.limit({ key: ip });
  return success;
}

// ---- File Validation ----

function validateFileData(cvData) {
  // cvData is JSON string: { type: 'pdf'|'docx', data: base64 }
  try {
    const parsed = JSON.parse(cvData);
    if (!parsed.type || !parsed.data) return { valid: false, error: 'Format data tidak valid' };

    const bytes = atob(parsed.data.slice(0, 8));
    const codes = Array.from(bytes).map(c => c.charCodeAt(0));

    if (parsed.type === 'pdf') {
      // PDF magic: %PDF (0x25 0x50 0x44 0x46)
      if (codes[0] !== 0x25 || codes[1] !== 0x50 || codes[2] !== 0x44 || codes[3] !== 0x46) {
        return { valid: false, error: 'File bukan PDF yang valid' };
      }
    } else if (parsed.type === 'docx') {
      // DOCX magic: PK (0x50 0x4B)
      if (codes[0] !== 0x50 || codes[1] !== 0x4B) {
        return { valid: false, error: 'File bukan DOCX yang valid' };
      }
    }

    // Size check: base64 size → actual size ≈ base64.length × 0.75
    const approxSize = parsed.data.length * 0.75;
    if (approxSize > 5 * 1024 * 1024) {
      return { valid: false, error: 'Ukuran file melebihi 5MB' };
    }

    return { valid: true, parsed };
  } catch (e) {
    return { valid: false, error: 'Data CV tidak dapat dibaca' };
  }
}

// ---- CV Text Extraction ----

async function extractCVText(cvData, env) {
  // For PDF/DOCX, we need to extract text server-side
  // Using a simple approach: send to Claude with vision/document capability
  // or use a basic text extraction

  try {
    const parsed = typeof cvData === 'string' ? JSON.parse(cvData) : cvData;

    // Use Claude to extract text from the document
    const response = await callClaude(
      env,
      'Ekstrak semua teks dari dokumen CV ini. Output hanya teks mentah tanpa formatting tambahan.',
      parsed,
      500
    );

    const text = response?.content?.[0]?.text || '';

    if (text.length < 100) {
      return { success: false, error: 'CV kamu tidak bisa dibaca. Pastikan CV dalam format teks, bukan hasil scan atau foto.' };
    }

    return { success: true, text };
  } catch (e) {
    return { success: false, error: 'Gagal memproses file CV' };
  }
}

// ---- Claude API ----

async function callClaude(env, systemPrompt, userContent, maxTokens = 2000) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('API key tidak tersedia');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  const messages = [];

  // Build message content
  if (typeof userContent === 'string') {
    messages.push({ role: 'user', content: userContent });
  } else if (userContent && userContent.type && userContent.data) {
    // Document file passed
    const mediaType = userContent.type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    messages.push({
      role: 'user',
      content: [{
        type: 'document',
        source: { type: 'base64', media_type: mediaType, data: userContent.data }
      }]
    });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude API error: ${res.status}`);
    }

    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Analisis timeout. Coba lagi.');
    throw e;
  }
}

async function analyzeCV(cvText, jobDesc, env) {
  const systemPrompt = `Kamu adalah HR expert Indonesia dengan 10 tahun pengalaman merekrut.

Analisis CV berikut terhadap job description ini:

CV:
${cvText}

JOB DESCRIPTION:
${jobDesc}

Berikan output JSON:
{
  "skor": <0-100>,
  "alasan_skor": "<1 kalimat>",
  "gap": ["<gap 1>", "<gap 2>", "<gap 3>"],
  "rekomendasi": ["<rekomendasi 1>", "<rekomendasi 2>", "<rekomendasi 3>"],
  "kekuatan": ["<kekuatan 1>", "<kekuatan 2>"]
}

Skor:
- 80-100: CV sangat match, kemungkinan besar lolos ATS
- 60-79: CV cukup match, ada beberapa gap minor
- 40-59: CV kurang match, perlu improvement signifikan
- 0-39: CV tidak match, banyak gap kritis

Output hanya JSON, tidak ada teks lain.`;

  const result = await callClaude(env, systemPrompt, 'Analisis sekarang.', 1000);
  const text = result?.content?.[0]?.text || '{}';

  // Parse JSON — Claude should return clean JSON
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned);
}

async function tailorCVID(cvText, jobDesc, env) {
  const systemPrompt = `Kamu adalah career coach Indonesia yang membantu pencari kerja menulis CV profesional.

Tailoring CV ini untuk job description berikut.
PENTING: Jangan ubah fakta, hanya reframe dan highlight yang relevan.
Bahasa harus natural dan human — bukan terkesan ditulis AI.
Format ATS-friendly: tidak ada tabel, tidak ada kolom, tidak ada gambar.

CV ASLI:
${cvText}

JOB DESCRIPTION:
${jobDesc}

Output CV dalam Bahasa Indonesia dengan sections:
1. RINGKASAN PROFESIONAL (3-4 kalimat, highlight yang paling relevan untuk posisi ini)
2. PENGALAMAN KERJA (bullet points, gunakan kata kerja aktif, kuantifikasi achievement)
3. PENDIDIKAN
4. KEAHLIAN (prioritaskan yang disebutkan di job description)
5. SERTIFIKASI (jika ada)

Output hanya teks CV, tidak ada komentar atau penjelasan tambahan.`;

  const result = await callClaude(env, systemPrompt, 'Tailoring CV sekarang.', 2000);
  return result?.content?.[0]?.text || '';
}

async function tailorCVEN(cvText, jobDesc, env) {
  const systemPrompt = `You are a professional career coach helping Indonesian job seekers write international CVs.

Translate and tailor this CV for the job description below.
IMPORTANT: Do not change facts — only reframe and highlight what's relevant.
Language must sound natural and human — not AI-generated.
ATS-friendly format: no tables, no columns, no images.

ORIGINAL CV (in Indonesian):
${cvText}

JOB DESCRIPTION:
${jobDesc}

Output the CV in English with sections:
1. PROFESSIONAL SUMMARY (3-4 sentences, highlight most relevant for this role)
2. WORK EXPERIENCE (bullet points, action verbs, quantified achievements)
3. EDUCATION
4. SKILLS (prioritize those mentioned in job description)
5. CERTIFICATIONS (if any)

Output only the CV text, no additional comments.`;

  const result = await callClaude(env, systemPrompt, 'Tailor the CV now.', 2000);
  return result?.content?.[0]?.text || '';
}

// ---- Mayar API ----

function getMayarApiUrl(env) {
  return env.ENVIRONMENT === 'production'
    ? 'https://api.mayar.id/hl/v1'
    : 'https://api.mayar.club/hl/v1';
}

function getMayarApiKey(env) {
  return env.ENVIRONMENT === 'production'
    ? env.MAYAR_API_KEY
    : env.MAYAR_API_KEY_SANDBOX;
}

const TIER_PRICES = {
  coba:    { label: 'GasLamar — Coba Dulu',      amount: 29000  },
  single:  { label: 'GasLamar — Single',         amount: 59000  },
  '3pack': { label: 'GasLamar — 3-Pack',         amount: 149000 },
  jobhunt: { label: 'GasLamar — Job Hunt Pack',  amount: 299000 },
};

// Number of CV generations included per tier
const TIER_CREDITS = {
  coba:    1,
  single:  1,
  '3pack': 3,
  jobhunt: 10,
};

async function createMayarInvoice(sessionId, tier, env) {
  const tierConfig = TIER_PRICES[tier];
  if (!tierConfig) throw new Error('Tier tidak valid');

  const apiUrl = getMayarApiUrl(env);
  const apiKey = getMayarApiKey(env);

  if (!apiKey) throw new Error('Mayar API key tidak tersedia');

  const redirectUrl = `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`;

  const body = {
    name: tierConfig.label,
    amount: tierConfig.amount,
    description: `CV Tailoring ${tierConfig.label} — GasLamar.com`,
    redirect_url: redirectUrl,
    is_one_time: true,
  };

  const res = await fetch(`${apiUrl}/invoice/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.messages?.[0] || `Mayar error: ${res.status}`);
  }

  const data = await res.json();
  return {
    invoice_id: data.data?.id || data.id,
    invoice_url: data.data?.link || data.link
  };
}

// ---- Webhook Verification ----

async function verifyMayarWebhook(request, env) {
  const signature = request.headers.get('x-mayar-signature') || request.headers.get('X-Mayar-Signature');
  if (!signature) return { valid: false, body: null };

  const body = await request.text();
  const secret = env.MAYAR_WEBHOOK_SECRET;

  if (!secret) {
    // In sandbox without secret, log and allow
    if (env.ENVIRONMENT !== 'production') return { valid: true, body };
    return { valid: false, body };
  }

  // HMAC-SHA256 verification
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to prevent timing attacks
  const sigLower = signature.toLowerCase();
  if (sigLower.length !== expected.length) return { valid: false, body };
  const sigBytes = new TextEncoder().encode(sigLower);
  const expBytes = new TextEncoder().encode(expected);
  let diff = 0;
  for (let i = 0; i < expBytes.length; i++) diff |= sigBytes[i] ^ expBytes[i];
  const valid = diff === 0;
  return { valid, body };
}

// ---- KV Session Helpers ----

const SESSION_TTL = 1800; // 30 minutes

async function createSession(env, sessionId, data) {
  await env.GASLAMAR_SESSIONS.put(
    sessionId,
    JSON.stringify({ ...data, created_at: Date.now() }),
    { expirationTtl: SESSION_TTL }
  );
}

async function getSession(env, sessionId) {
  const raw = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
  return raw;
}

async function updateSession(env, sessionId, updates) {
  const existing = await getSession(env, sessionId);
  if (!existing) return false;
  await env.GASLAMAR_SESSIONS.put(
    sessionId,
    JSON.stringify({ ...existing, ...updates }),
    { expirationTtl: SESSION_TTL }
  );
  return true;
}

async function deleteSession(env, sessionId) {
  await env.GASLAMAR_SESSIONS.delete(sessionId);
}

// ---- Route Handlers ----

async function handleAnalyze(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const allowed = await checkRateLimit(env, env.RATE_LIMITER_ANALYZE, ip);
  if (!allowed) {
    return jsonResponse({ message: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' }, 429, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { cv, job_desc } = body;

  if (!cv || !job_desc) {
    return jsonResponse({ message: 'CV dan job description wajib diisi' }, 400, request, env);
  }

  if (job_desc.length > 3000) {
    return jsonResponse({ message: 'Job description terlalu panjang (maks 3.000 karakter)' }, 400, request, env);
  }

  // Validate file
  const validation = validateFileData(cv);
  if (!validation.valid) {
    return jsonResponse({ message: validation.error }, 400, request, env);
  }

  // Extract text from CV
  const extraction = await extractCVText(cv, env);
  if (!extraction.success) {
    return jsonResponse({ message: extraction.error }, 422, request, env);
  }

  // Run scoring and store extracted text under a short-lived key
  // so /create-payment can reuse it without re-extracting the file
  try {
    const scoring = await analyzeCV(extraction.text, job_desc, env);
    const cvTextKey = `cvtext_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(cvTextKey, JSON.stringify({
      text: extraction.text,
      job_desc: job_desc.slice(0, 3000)
    }), { expirationTtl: 3600 });

    return jsonResponse({ ...scoring, cv_text_key: cvTextKey }, 200, request, env);
  } catch (e) {
    return jsonResponse({ message: e.message || 'Analisis gagal. Coba lagi.' }, 500, request, env);
  }
}

async function handleCreatePayment(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const allowed = await checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip);
  if (!allowed) {
    return jsonResponse({ message: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' }, 429, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { tier, cv_text_key, email: rawEmail } = body;

  // Optional email — basic validation, silently ignore if malformed
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const sessionEmail = (rawEmail && typeof rawEmail === 'string' && emailRegex.test(rawEmail) && rawEmail.length <= 254)
    ? rawEmail.toLowerCase().trim()
    : null;

  if (!tier || !cv_text_key) {
    return jsonResponse({ message: 'Data tidak lengkap' }, 400, request, env);
  }

  if (!['coba', 'single', '3pack', 'jobhunt'].includes(tier)) {
    return jsonResponse({ message: 'Tier tidak valid' }, 400, request, env);
  }

  // Look up extracted CV text from KV (set by /analyze) — never re-extract
  if (!cv_text_key.startsWith('cvtext_')) {
    return jsonResponse({ message: 'cv_text_key tidak valid' }, 400, request, env);
  }
  const stored = await env.GASLAMAR_SESSIONS.get(cv_text_key, { type: 'json' });
  if (!stored || !stored.text) {
    return jsonResponse({ message: 'Sesi analisis kedaluwarsa. Ulangi upload CV.' }, 400, request, env);
  }
  // Consume key — one-time use
  await env.GASLAMAR_SESSIONS.delete(cv_text_key);

  // Create session
  const sessionId = `sess_${crypto.randomUUID()}`;

  try {
    // Create Mayar invoice
    const { invoice_id, invoice_url } = await createMayarInvoice(sessionId, tier, env);

    // Store session in KV using pre-extracted text from /analyze
    const credits = TIER_CREDITS[tier] ?? 1;
    await createSession(env, sessionId, {
      cv_text: stored.text,
      job_desc: stored.job_desc,
      tier,
      status: 'pending',
      mayar_invoice_id: invoice_id,
      credits_remaining: credits,
      total_credits: credits,
      ip,
      ...(sessionEmail ? { email: sessionEmail } : {}),
    });

    return jsonResponse({ session_id: sessionId, invoice_url }, 200, request, env);
  } catch (e) {
    return jsonResponse({ message: e.message || 'Gagal membuat invoice' }, 500, request, env);
  }
}

// ---- Resend Email ----
//
// Sends a post-payment confirmation email via Resend API.
// RESEND_API_KEY must be set via: wrangler secret put RESEND_API_KEY
// FROM_EMAIL must be set or defaults to noreply@gaslamar.com.
// Silently skips if RESEND_API_KEY is absent — email is non-critical.

async function sendPaymentConfirmationEmail(sessionId, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return; // skip if not configured

  const session = await getSession(env, sessionId);
  if (!session || !session.email) return; // no email stored for this session

  const downloadUrl = `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`;
  const tierLabels = {
    coba:    'Coba Dulu (1 CV)',
    single:  'Single (1 CV Bilingual)',
    '3pack': '3-Pack (3 CV Bilingual)',
    jobhunt: 'Job Hunt Pack (10 CV Bilingual)',
  };
  const tierLabel = tierLabels[session.tier] || session.tier;

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px">
        <span style="font-weight:800;font-size:20px;color:#1B4FE8">GasLamar</span>
      </div>
      <h1 style="font-size:22px;font-weight:700;color:#1F2937;margin-bottom:8px">Pembayaran Dikonfirmasi ✓</h1>
      <p style="color:#6B7280;margin-bottom:24px">Paket <strong>${tierLabel}</strong> kamu sudah aktif.</p>
      <a href="${downloadUrl}"
        style="display:inline-block;background:#1B4FE8;color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;margin-bottom:24px">
        Download CV Sekarang →
      </a>
      <p style="font-size:12px;color:#9CA3AF">Link ini berlaku 30 menit. Kalau sudah kedaluwarsa, mulai ulang dari <a href="https://gaslamar.com/upload.html" style="color:#1B4FE8">sini</a>.</p>
    </div>`;

  await fetch('https://api.resend.com/emails', {
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
}

async function handleMayarWebhook(request, env) {
  const { valid, body } = await verifyMayarWebhook(request, env);

  if (!valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return new Response('Bad Request', { status: 400 });
  }

  // Extract session ID from Mayar's redirect_url or metadata
  // Mayar sends the invoice data — find our session by invoice ID or redirect URL
  const invoiceId = payload.id || payload.invoice_id || payload.data?.id;
  const redirectUrl = payload.redirect_url || payload.data?.redirect_url || '';
  const status = payload.status || payload.data?.status;

  if (!invoiceId && !redirectUrl) {
    return new Response('OK', { status: 200 });
  }

  // Extract session_id from redirect URL
  let sessionId = null;
  if (redirectUrl) {
    try {
      const url = new URL(redirectUrl);
      sessionId = url.searchParams.get('session');
    } catch (e) {
      // ignore
    }
  }

  if (!sessionId) {
    // Try to find session by invoice ID
    // This requires a secondary index — for now log and return 200
    return new Response('OK', { status: 200 });
  }

  // Check if payment is successful
  const isPaid = ['paid', 'settlement', 'capture', 'PAID', 'SETTLEMENT'].includes(status);

  if (isPaid) {
    await updateSession(env, sessionId, { status: 'paid', paid_at: Date.now() });
    // Fire-and-forget confirmation email via Resend
    sendPaymentConfirmationEmail(sessionId, env).catch(() => {});
  }

  return new Response('OK', { status: 200 });
}

async function handleCheckSession(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  return jsonResponse({ status: session.status }, 200, request, env);
}

async function handleGetSession(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { session_id } = body;

  if (!session_id || !session_id.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
  }

  const session = await getSession(env, session_id);

  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  // Strict status check — only allow 'paid'
  if (session.status !== 'paid') {
    return jsonResponse({ message: 'Pembayaran belum dikonfirmasi' }, 403, request, env);
  }

  // Mark as generating to prevent race conditions
  await updateSession(env, session_id, { status: 'generating' });

  return jsonResponse({
    cv: session.cv_text,
    job_desc: session.job_desc,
    tier: session.tier,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
  }, 200, request, env);
}

async function handleGenerate(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const allowed = await checkRateLimit(env, env.RATE_LIMITER_GENERATE, ip);
  if (!allowed) {
    return jsonResponse({ message: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' }, 429, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { session_id, job_desc: newJobDesc } = body;

  if (!session_id || !session_id.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
  }

  // Optional new job_desc for multi-credit re-use (3-Pack / JobHunt)
  if (newJobDesc !== undefined) {
    if (typeof newJobDesc !== 'string' || newJobDesc.length > 3000) {
      return jsonResponse({ message: 'Job description terlalu panjang (maks 3.000 karakter)' }, 400, request, env);
    }
  }

  // Verify session exists and has status 'generating' (set by /get-session)
  // All CV data comes from KV — browser cannot inject arbitrary content
  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }
  if (session.status !== 'generating') {
    return jsonResponse({ message: 'Sesi tidak valid atau pembayaran belum dikonfirmasi' }, 403, request, env);
  }

  const { cv_text, job_desc: storedJobDesc, tier } = session;
  const effectiveJobDesc = (newJobDesc && newJobDesc.trim()) ? newJobDesc.trim() : storedJobDesc;

  if (!cv_text || !effectiveJobDesc || !tier) {
    return jsonResponse({ message: 'Data sesi tidak lengkap' }, 400, request, env);
  }

  // Credits: legacy sessions without the field get 1 (they paid for single use)
  const creditsRemaining = typeof session.credits_remaining === 'number' ? session.credits_remaining : 1;
  const isBilingual = tier !== 'coba';

  try {
    // Generate from KV data only — never from request body (except allowed job_desc override).
    // Run ID and EN tailoring in parallel to stay within Cloudflare's 30s wall-clock limit.
    // Sequential calls could reach 50s (2 × 25s Claude timeout) and hard-kill the Worker.
    let cvId, cvEn;
    if (isBilingual) {
      [cvId, cvEn] = await Promise.all([
        tailorCVID(cv_text, effectiveJobDesc, env),
        tailorCVEN(cv_text, effectiveJobDesc, env),
      ]);
    } else {
      cvId = await tailorCVID(cv_text, effectiveJobDesc, env);
      cvEn = null;
    }

    const newCreditsRemaining = creditsRemaining - 1;

    if (newCreditsRemaining <= 0) {
      // Last credit used — delete session
      await deleteSession(env, session_id);
    } else {
      // Credits remain — reset to 'paid' for next generation, persist updated job_desc if changed
      const updates = { status: 'paid', credits_remaining: newCreditsRemaining };
      if (newJobDesc && newJobDesc.trim()) updates.job_desc = effectiveJobDesc;
      await updateSession(env, session_id, updates);
    }

    return jsonResponse({ cv_id: cvId, cv_en: cvEn, credits_remaining: newCreditsRemaining }, 200, request, env);
  } catch (e) {
    // On failure, reset to 'paid' so user can retry (don't consume the credit)
    await updateSession(env, session_id, { status: 'paid' }).catch(() => {});
    return jsonResponse({ message: e.message || 'Generate CV gagal. Coba lagi.' }, 500, request, env);
  }
}

async function handleSubmitEmail(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Reuse payment rate limiter (5 req/min per IP)
  const allowed = await checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip);
  if (!allowed) {
    return jsonResponse({ message: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' }, 429, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { email } = body;

  if (!email || typeof email !== 'string') {
    return jsonResponse({ message: 'Email tidak valid' }, 400, request, env);
  }

  // Basic format + length check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return jsonResponse({ message: 'Format email tidak valid' }, 400, request, env);
  }

  // Store with 30-day TTL — keyed by timestamp + short UUID to avoid collisions
  const key = `email_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  await env.GASLAMAR_SESSIONS.put(
    key,
    JSON.stringify({ email: email.toLowerCase().trim(), submitted_at: Date.now(), ip }),
    { expirationTtl: 86400 * 30 }
  );

  return jsonResponse({ ok: true }, 200, request, env);
}

// ---- Main Handler ----

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request, env)
      });
    }

    // Route matching
    try {
      if (method === 'POST' && pathname === '/analyze') {
        return handleAnalyze(request, env);
      }

      if (method === 'POST' && pathname === '/create-payment') {
        return handleCreatePayment(request, env);
      }

      if (method === 'POST' && pathname === '/webhook/mayar') {
        return handleMayarWebhook(request, env);
      }

      if (method === 'GET' && pathname === '/check-session') {
        return handleCheckSession(request, env);
      }

      if (method === 'POST' && pathname === '/get-session') {
        return handleGetSession(request, env);
      }

      if (method === 'POST' && pathname === '/generate') {
        return handleGenerate(request, env);
      }

      if (method === 'POST' && pathname === '/submit-email') {
        return handleSubmitEmail(request, env);
      }

      if (pathname === '/health') {
        return jsonResponse({ status: 'ok' }, 200, request, env);
      }

      return jsonResponse({ message: 'Not found' }, 404, request, env);

    } catch (err) {
      console.error('Unhandled error:', err);
      return jsonResponse({ message: 'Internal server error' }, 500, request, env);
    }
  }
};
