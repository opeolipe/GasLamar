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
  'https://staging.gaslamar.pages.dev',
];

// Add localhost for local development
const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080'];

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ENVIRONMENT === 'production'
    ? ALLOWED_ORIGINS
    : [...ALLOWED_ORIGINS, ...DEV_ORIGINS];

  const isAllowed = allowed.includes(origin) || origin.endsWith('.gaslamar.pages.dev');
  const allowedOrigin = isAllowed ? origin : 'null';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Secret',
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

// Returns a properly-formed 429 with Retry-After header (RFC 7231 §7.1.3).
// All rate-limited endpoints must use this instead of a plain jsonResponse 429.
function rateLimitResponse(request, env) {
  return corsResponse(
    JSON.stringify({ message: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' }),
    429,
    { 'Content-Type': 'application/json', 'Retry-After': '60' },
    request,
    env
  );
}

// ---- Structured Logging ----
function log(event, data = {}) {
  console.log(JSON.stringify({ event, ts: Date.now(), ...data }));
}
function logError(event, data = {}) {
  console.error(JSON.stringify({ event, ts: Date.now(), ...data }));
}

// ---- File Validation ----

function validateFileData(cvData) {
  // cvData is JSON string: { type: 'pdf'|'docx'|'txt', data: base64|plaintext }
  try {
    const parsed = JSON.parse(cvData);
    if (!parsed.type || !parsed.data) return { valid: false, error: 'Format data tidak valid' };

    // txt files carry raw text — no magic-byte check needed, just size guard
    if (parsed.type === 'txt') {
      if (typeof parsed.data !== 'string') return { valid: false, error: 'Data teks tidak valid' };
      if (parsed.data.length > 5 * 1024 * 1024) return { valid: false, error: 'Ukuran file melebihi 5MB' };
      return { valid: true, parsed };
    }

    // pdf / docx: data is base64-encoded binary — check magic bytes
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
  try {
    const parsed = typeof cvData === 'string' ? JSON.parse(cvData) : cvData;

    // TXT files: text is already extracted on the frontend, no Claude call needed
    if (parsed.type === 'txt') {
      const text = parsed.data || '';
      if (text.trim().length < 100) {
        return { success: false, error: 'CV kamu tidak bisa dibaca. Pastikan file berisi teks CV yang lengkap.' };
      }
      return { success: true, text };
    }

    // DOCX: extract text locally via ZIP+XML parsing (no API call needed)
    if (parsed.type === 'docx') {
      const text = await extractTextFromDOCX(parsed.data);
      if (text.length < 100) {
        return { success: false, error: 'CV kamu tidak bisa dibaca. Pastikan CV berisi teks, bukan tabel gambar atau file hasil scan.' };
      }
      return { success: true, text };
    }

    // PDF: use Claude document API
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
    console.error('[extractCVText]', e.message);
    return { success: false, error: 'Gagal memproses file CV: ' + e.message };
  }
}

// ---- DOCX text extraction (client-side ZIP+XML parsing) ----

async function extractTextFromDOCX(base64Data) {
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const target = 'word/document.xml';

  for (let i = 0; i < bytes.length - 30; i++) {
    // ZIP local file header signature: PK\x03\x04
    if (bytes[i] !== 0x50 || bytes[i+1] !== 0x4B || bytes[i+2] !== 0x03 || bytes[i+3] !== 0x04) continue;

    const flags        = bytes[i+6]  | (bytes[i+7]  << 8);
    const comprMethod  = bytes[i+8]  | (bytes[i+9]  << 8);
    let   compressedSz = (bytes[i+18] | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24)) >>> 0;
    const filenameLen  = bytes[i+26] | (bytes[i+27] << 8);
    const extraLen     = bytes[i+28] | (bytes[i+29] << 8);

    const filename = new TextDecoder().decode(bytes.slice(i + 30, i + 30 + filenameLen));
    if (filename !== target) continue;

    const dataStart = i + 30 + filenameLen + extraLen;

    // Bit 3 of general-purpose flags = data descriptor mode: Word, LibreOffice, and Google Docs
    // all set this flag, meaning compressedSz in the local header is 0 and the real size is
    // written in a data descriptor record (PK\x07\x08) AFTER the compressed data.
    // Scan forward to find either the data descriptor or the next local file header.
    if ((flags & 0x08) || compressedSz === 0) {
      let end = dataStart;
      while (end < bytes.length - 4) {
        if (bytes[end] === 0x50 && bytes[end+1] === 0x4B) {
          // Data descriptor signature (PK\x07\x08) or next local file header (PK\x03\x04)
          if ((bytes[end+2] === 0x07 && bytes[end+3] === 0x08) ||
              (bytes[end+2] === 0x03 && bytes[end+3] === 0x04)) {
            break;
          }
        }
        end++;
      }
      compressedSz = end - dataStart;
    }

    const compressed = bytes.slice(dataStart, dataStart + compressedSz);

    let xmlBytes;
    if (comprMethod === 0) {
      xmlBytes = compressed; // stored, no compression
    } else if (comprMethod === 8) {
      // raw DEFLATE (ZIP uses no zlib header)
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      xmlBytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    } else {
      throw new Error('File CV tampak rusak atau tidak lengkap. Coba upload file yang berbeda.');
    }

    const xmlText = new TextDecoder('utf-8').decode(xmlBytes);
    // Extract text from <w:t> elements, preserving space runs
    const parts = [];
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xmlText)) !== null) parts.push(m[1]);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  throw new Error('File CV tampak rusak atau tidak lengkap. Coba upload file yang berbeda.');
}

// ---- Claude API ----

async function callClaude(env, systemPrompt, userContent, maxTokens = 2000) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('API key tidak tersedia');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);

  const messages = [];

  // Build message content
  if (typeof userContent === 'string') {
    messages.push({ role: 'user', content: userContent });
  } else if (userContent && userContent.type && userContent.data) {
    if (userContent.type === 'txt') {
      // Plain text — send directly as text message
      messages.push({ role: 'user', content: userContent.data });
    } else {
      // PDF document block (DOCX is handled before reaching callClaude)
      messages.push({
        role: 'user',
        content: [{
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: userContent.data }
        }]
      });
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'pdfs-2024-09-25',
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: env.ENVIRONMENT === 'production' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        temperature: 0,
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

// ---- AI Skill constants ----

const SKILL_ANALYZE = `PERAN: Kamu adalah HR expert Indonesia senior dengan 10+ tahun pengalaman merekrut.
Bukan AI generik - kamu bicara seperti HR berpengalaman yang jujur dan helpful.

BAHASA & TONE:
- Semua output dalam Bahasa Indonesia. Istilah teknis Inggris boleh (React, agile, API).
- Hindari "Indoglish" (misalnya "kamu perlu improve skill" -> "kamu perlu tingkatkan skill ini").
- Jangan tulis "Based on my analysis..." - langsung to the point.
- Gunakan kalimat pendek, natural, seperti bicara ke teman kerja.

KARAKTER YANG DILARANG:
- Tidak boleh pakai em-dash (tanda hubung panjang). Pakai tanda hubung biasa (-) atau susun ulang kalimat.
- Tidak boleh spasi ganda.
- Tidak boleh simbol Unicode aneh - pakai ASCII standar saja.
- Tidak boleh HURUF KAPITAL SEMUA untuk penekanan (kecuali akronim: HRD, ATS, API).

PENANGANAN ANGKA (KRITIS):
- Kalau CV sudah punya angka: pertahankan dan sarankan cara perkuatnya.
- Kalau CV tidak punya angka: JANGAN mengarang angka palsu. Gunakan placeholder seperti "Coba tambahkan angka - misalnya meningkatkan efisiensi X% dalam Y bulan".
- Jangan pernah fabrikasi pencapaian yang tidak ada di CV asli.

DETEKSI INDUSTRI - sesuaikan tone:
- Tech/IT: direct, teknikal, sebut tools dan proyek spesifik
- Finance/Accounting: formal, tekankan kepatuhan dan sertifikasi (PSAK, SAP)
- Creative/Marketing: energik, fokus hasil kampanye dan tools
- Government: sangat formal, detail, gunakan istilah Indonesia
- Fresh Graduate: optimistis, fokus potensi dan pendidikan

DETEKSI SENIORITY dari jumlah tahun pengalaman:
- Entry (<2 thn): 1 halaman, kalimat sederhana, tekankan potensi
- Mid (2-7 thn): 1-2 halaman, fokus pencapaian dan angka
- Senior (>7 thn): 2-3 halaman, tekankan kepemimpinan dan strategi

EDGE CASES:
- CV sangat pendek (<100 kata): tandai sebagai "CV sangat singkat, mungkin tidak lengkap"
- CV sangat panjang (>5 halaman): beri catatan bahwa ini terlalu panjang untuk ATS
- CV bukan Bahasa Indonesia/Inggris: analisis tetap dilanjutkan, tambahkan catatan bahwa GasLamar optimal untuk CV berbahasa Indonesia atau Inggris

YANG TIDAK BOLEH DILAKUKAN:
- Mengarang angka atau pencapaian yang tidak ada di CV
- Menggunakan em-dash
- Menulis "Based on my analysis as an AI..."
- Jargon korporat AI seperti "leverage synergies", "paradigm shift"
- Kalimat panjang bertele-tele - potong dan sederhanakan`;

const SKILL_TAILOR_ID = `PERAN: Kamu adalah career coach Indonesia yang menulis CV profesional.
Rewrite harus terdengar seperti ditulis manusia kompeten - bukan AI.

HUMAN TONE (KRITIS):
Hindari:
- "Bertanggung jawab penuh atas implementasi strategi digital yang komprehensif..."
- "Mengorkestrasikan kolaborasi lintas fungsi untuk mensinergikan tujuan departemen..."
- Kata tidak natural: orchestrated, spearheaded, leveraged - pakai "memimpin", "memulai", "menggunakan"

Gunakan:
- Kalimat pendek dan langsung: "Saya bikin strategi konten Instagram. Dalam 3 bulan, engagement naik 40%."
- Kata kerja aktif sederhana: pimpin, bangun, bantu, tingkatkan
- Struktur: Aksi + Konteks + Dampak

ANGKA:
- PDF final: HANYA angka yang sudah ada di CV asli. Jangan fabrikasi.
- DOCX: boleh tambahkan placeholder seperti [contoh: meningkat X%]

ATS-READY (WAJIB):
- Layout satu kolom - tidak ada tabel, kolom ganda, text box
- Font standar: Arial, Calibri, Helvetica, Times New Roman, Inter
- Bullet: tanda hubung (-) atau asterisk (*) saja
- Heading standar: "PENGALAMAN KERJA", "PENDIDIKAN", "KEAHLIAN"
- Tanggal: format "Jan 2020 - Mar 2023"
- Tidak ada grafik, ikon, QR code, progress bar skill
- Tidak ada informasi penting di header/footer

SENIORITY - sesuaikan panjang dan style:
- Entry: 1 halaman, kalimat sederhana, tekankan pendidikan dan potensi
- Mid: 1-2 halaman, fokus pencapaian terukur
- Senior: 2-3 halaman, tekankan kepemimpinan, strategi, anggaran

AUTENTISITAS:
- Jangan salin frasa dari job description secara verbatim - paraphrase
- Pertahankan pengalaman dan pencapaian unik milik pengguna
- Kalau kalimat terasa "terlalu sempurna" atau generik - tulis ulang lebih personal

YANG TIDAK BOLEH:
- Em-dash di mana pun
- Angka palsu di PDF
- Jargon AI seperti "bersinergi", "memanfaatkan paradigma"
- Layout multi-kolom atau tabel
- Hapus konteks penting demi mempersingkat`;

const SKILL_TAILOR_EN = `ROLE: You are a professional career coach writing CVs for Indonesian job seekers targeting international roles.
The rewrite must sound like it was written by a competent human - not AI.

HUMAN TONE (CRITICAL):
Avoid:
- "Orchestrated cross-functional collaboration to synergize departmental objectives..."
- "Leveraged paradigm-shifting strategies to drive operational excellence..."
- Unnatural verbs: orchestrated, spearheaded - use "led", "started", "built", "managed"

Use:
- Short, direct sentences: "Led mobile app development. Shipped 2 weeks ahead of schedule."
- Active, everyday verbs: managed, built, helped, improved
- Structure: Action + Context + Impact
- US English consistently (default)

NUMBERS:
- PDF (final): ONLY numbers from the user's original CV. Never fabricate.
- DOCX: may add placeholders like [e.g., improved by X%]

ATS-READY (MANDATORY):
- Single-column layout - no tables, multi-column, text boxes
- Standard fonts: Arial, Calibri, Helvetica, Times New Roman, Inter
- Bullets: dash (-) or asterisk (*) only
- Standard headings: "WORK EXPERIENCE", "EDUCATION", "SKILLS"
- Dates: "Jan 2020 - Mar 2023" format
- No graphics, icons, QR codes, skill progress bars
- No critical information in headers/footers

SENIORITY:
- Entry: 1 page, simple sentences, emphasize education and potential
- Mid: 1-2 pages, focus on measurable achievements
- Senior: 2-3 pages, emphasize leadership, strategy, budget responsibility

AUTHENTICITY:
- Never copy phrases verbatim from job description - paraphrase
- Preserve the user's unique experiences and achievements
- If a sentence feels generic or "too perfect" - rewrite to be more personal

NEVER:
- Em-dash anywhere
- Fabricated numbers in PDF
- AI jargon: "synergize", "leverage paradigms", "spearhead transformation"
- Multi-column layout or tables
- Remove important context just to shorten the CV`;

// ---- AI Analysis ----

/** Compute a hex SHA-256 of text (first 32 chars used as KV key segment). */
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Compute full 64-char hex SHA-256 (used for session secret binding). */
async function sha256Full(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify the X-Session-Secret header against the stored hash.
 * - If the session has no stored hash (legacy session), returns true (backward compat).
 * - If the session has a hash but no secret is provided, returns false.
 * - Uses constant-time comparison to prevent timing attacks.
 */
async function verifySessionSecret(session, providedSecret) {
  if (!session.session_secret_hash) return true; // legacy session — no hash stored
  if (!providedSecret) return false;
  const hash = await sha256Full(providedSecret);
  if (hash.length !== session.session_secret_hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ session.session_secret_hash.charCodeAt(i);
  }
  return diff === 0;
}

async function analyzeCV(cvText, jobDesc, env) {
  // --- Content-hash cache ---
  // Same extracted CV text + job description always yields the same analysis.
  // Cache the result in KV so re-uploads / re-runs are 100% deterministic
  // even across different edge nodes.
  const cacheKey = `analysis_v2_${await sha256Hex(cvText.trim() + '||' + jobDesc.trim())}`;
  const cached = await env.GASLAMAR_SESSIONS.get(cacheKey, { type: 'json' });
  if (cached) {
    // Re-derive skor from discrete sub-scores even on cache hit.
    // Old cache entries may have a LLM-generated skor (e.g. 66) that bypassed
    // the clamping added later. Re-applying it here fixes stale entries without
    // needing a cache version bump.
    if (typeof cached.skor_relevansi !== 'undefined') {
      const r  = [0, 10, 20, 30, 40].includes(cached.skor_relevansi)    ? cached.skor_relevansi    : 0;
      const rq = [0, 10, 20, 30].includes(cached.skor_requirements)     ? cached.skor_requirements : 0;
      const k  = [0, 10, 20].includes(cached.skor_kualitas)             ? cached.skor_kualitas     : 0;
      const kw = [0, 5, 10].includes(cached.skor_keywords)              ? cached.skor_keywords     : 0;
      cached.skor = r + rq + k + kw;
    }
    return cached;
  }

  const systemPrompt = `${SKILL_ANALYZE}

--- TASK ---
Analisis CV berikut terhadap job description ini:

CV:
${cvText}

JOB DESCRIPTION:
${jobDesc}

Berikan output JSON dengan format TEPAT berikut:
{
  "skor_relevansi": <HARUS tepat salah satu: 0, 10, 20, 30, atau 40>,
  "skor_requirements": <HARUS tepat salah satu: 0, 10, 20, atau 30>,
  "skor_kualitas": <HARUS tepat salah satu: 0, 10, atau 20>,
  "skor_keywords": <HARUS tepat salah satu: 0, 5, atau 10>,
  "alasan_skor": "<1 kalimat menjelaskan skor keseluruhan>",
  "gap": ["<gap 1>", "<gap 2>", "<gap 3>"],
  "rekomendasi": ["<rekomendasi 1>", "<rekomendasi 2>", "<rekomendasi 3>"],
  "kekuatan": ["<kekuatan 1>", "<kekuatan 2>"],
  "konfidensitas": <"Rendah"|"Sedang"|"Tinggi">,
  "skor_sesudah": <kelipatan 5, min skor+10, max 95>,
  "hr_7_detik": { "kuat": ["...", "..."], "diabaikan": ["...", "..."] },
  "red_flags": ["..."]
}

PANDUAN skor_relevansi (0/10/20/30/40):
- 40: Role sama atau sangat mirip (PM → Senior PM, Backend Dev → Full Stack Dev)
- 30: Role terkait, industri sama (product analyst → PM, QA engineer → developer)
- 20: Industri sama tapi fungsi berbeda (sales → marketing, accountant → finance analyst)
- 10: Industri berbeda, ada transferable skills nyata (teacher → trainer, journalist → content strategist)
- 0: Tidak ada relevansi sama sekali (chef → PM, petani → software engineer, montir → data scientist)

PANDUAN skor_requirements (0/10/20/30):
- 30: Lebih dari 65% requirements eksplisit terpenuhi di CV
- 20: 33–65% requirements terpenuhi
- 10: 10–33% requirements terpenuhi
- 0: Kurang dari 10% requirements terpenuhi

PANDUAN skor_kualitas (0/10/20):
- 20: CV menggunakan angka nyata (%, Rp, jumlah), terstruktur jelas, bullet informatif
- 10: CV cukup jelas tapi jarang pakai angka, atau ada bagian yang membingungkan
- 0: CV sangat pendek (<100 kata), tidak terstruktur, tidak terbaca, atau penuh jargon tanpa substansi

PANDUAN skor_keywords (0/5/10):
- 10: Lebih dari 50% keyword penting dari job description ada di CV
- 5: 25–50% keyword relevan ada di CV
- 0: Kurang dari 25% keyword dari job description ada di CV

PANDUAN konfidensitas (WAJIB, pilih tepat satu):
- "Tinggi": CV lengkap dan jelas, JD spesifik -- analisis akurat
- "Sedang": CV atau JD kurang detail -- analisis cukup akurat
- "Rendah": CV sangat pendek/tidak terbaca, atau JD sangat generik

PANDUAN skor_sesudah:
Estimasi peluang interview SETELAH user mengimplementasikan semua rekomendasi.
HARUS kelipatan 5. HARUS minimal skor utama + 10 (maksimal 95).

PANDUAN hr_7_detik:
- kuat: 2-3 hal yang HR perhatikan POSITIF dalam 7 detik pertama (struktur, headline, relevansi)
- diabaikan: 1-2 hal yang HR cenderung skip atau bingung (bagian kabur, tidak relevan, terlalu panjang)

PANDUAN red_flags (OPSIONAL -- tambahkan HANYA jika ada, maks 3):
Flag jika: terlalu banyak "bertanggung jawab" tanpa hasil, tidak ada angka/pencapaian,
pengalaman tidak relevan sama sekali, atau banyak posisi <1 tahun (job hopping).
Jika tidak ada red flag nyata -- JANGAN tambahkan field ini.

Output hanya JSON, tidak ada teks lain.`;

  const result = await callClaude(env, systemPrompt, 'Analisis sekarang.', 1000);
  const text = result?.content?.[0]?.text || '{}';

  // Parse JSON — Claude should return clean JSON
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const scoring = JSON.parse(cleaned);

  // Compute total score deterministically from discrete sub-scores.
  // Clamp each sub-score to its allowed set to guard against LLM hallucination.
  const relevansi    = [0, 10, 20, 30, 40].includes(scoring.skor_relevansi)   ? scoring.skor_relevansi   : 0;
  const requirements = [0, 10, 20, 30].includes(scoring.skor_requirements)    ? scoring.skor_requirements : 0;
  const kualitas     = [0, 10, 20].includes(scoring.skor_kualitas)             ? scoring.skor_kualitas    : 0;
  const keywords     = [0, 5, 10].includes(scoring.skor_keywords)              ? scoring.skor_keywords    : 0;
  scoring.skor       = relevansi + requirements + kualitas + keywords;

  // Validate new v2 fields
  const VALID_CONF = ['Rendah', 'Sedang', 'Tinggi'];
  if (!VALID_CONF.includes(scoring.konfidensitas)) scoring.konfidensitas = 'Sedang';

  const sesudahRaw = Math.round((parseInt(scoring.skor_sesudah) || 0) / 5) * 5;
  scoring.skor_sesudah = Math.min(95, Math.max(scoring.skor + 10, sesudahRaw));

  if (!scoring.hr_7_detik || typeof scoring.hr_7_detik !== 'object') {
    delete scoring.hr_7_detik;
  }
  if (!Array.isArray(scoring.red_flags) || scoring.red_flags.length === 0) {
    delete scoring.red_flags;
  }

  // Store in cache (48-hour TTL). Identical CV+JD will always return this result.
  await env.GASLAMAR_SESSIONS.put(cacheKey, JSON.stringify(scoring), { expirationTtl: 172800 });

  return scoring;
}

async function tailorCVID(cvText, jobDesc, env) {
  const systemPrompt = `${SKILL_TAILOR_ID}

--- TASK ---
Tailoring CV ini untuk job description berikut.
PENTING: Jangan ubah fakta, hanya reframe dan highlight yang relevan.

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

  const result = await callClaude(env, systemPrompt, 'Tailoring CV sekarang.', 4096);
  const text = result?.content?.[0]?.text?.trim() ?? '';
  if (!text) throw new Error('CV Bahasa Indonesia kosong dari AI. Coba lagi.');
  return text;
}

async function tailorCVEN(cvText, jobDesc, env) {
  const systemPrompt = `${SKILL_TAILOR_EN}

--- TASK ---
Translate and tailor this CV for the job description below.
IMPORTANT: Do not change facts - only reframe and highlight what's relevant.

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

  const result = await callClaude(env, systemPrompt, 'Tailor the CV now.', 4096);
  const text = result?.content?.[0]?.text?.trim() ?? '';
  if (!text) throw new Error('English CV returned empty from AI. Please retry.');
  return text;
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

  console.log(JSON.stringify({ event: 'mayar_invoice_start', tier, has_key: !!apiKey, key_prefix: apiKey ? apiKey.substring(0, 4) : null, env: env.ENVIRONMENT, apiUrl }));

  if (!apiKey) throw new Error('Mayar API key tidak tersedia');

  const redirectUrl = `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`;

  // Use session-scoped email so each invoice has a unique customer identity.
  const shortId = sessionId.replace('sess_', '').substring(0, 8);

  // Try /invoice/create first (line items), fall back to /payment/create (flat amount)
  // Correct Mayar endpoint paths per Postman collection: /invoice/create and /payment/create
  const invoiceBody = {
    name: `GasLamar User ${shortId}`,
    email: `user+${shortId}@gaslamar.com`,
    mobile: '08000000000',
    description: `${tierConfig.label} — GasLamar.com`,
    redirectUrl,
    items: [{
      quantity: 1,
      rate: tierConfig.amount,
      description: tierConfig.label,
    }],
  };

  const paymentBody = {
    name: `GasLamar User ${shortId}`,
    email: `user+${shortId}@gaslamar.com`,
    mobile: '08000000000',
    amount: tierConfig.amount,
    description: `${tierConfig.label} — GasLamar.com`,
    redirectUrl,
  };

  for (const [endpoint, body] of [
    [`${apiUrl}/invoice/create`, invoiceBody],
    [`${apiUrl}/payment/create`, paymentBody],
  ]) {
    console.log(JSON.stringify({ event: 'mayar_request', endpoint, tier, amount: tierConfig.amount }));
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 404) {
      const errBody = await res.text().catch(() => '');
      console.log(JSON.stringify({ event: 'mayar_404', endpoint, body: errBody.substring(0, 200) }));
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let errMsg;
      try {
        const errJson = JSON.parse(errBody);
        errMsg = (typeof errJson.messages === 'string' ? errJson.messages : errJson.messages?.[0]) || errJson.message || `Mayar error: ${res.status}`;
      } catch {
        errMsg = `Mayar error: ${res.status}`;
      }
      console.error(JSON.stringify({ event: 'mayar_error', endpoint, status: res.status, body: errBody.substring(0, 500) }));
      throw new Error(errMsg);
    }

    const data = await res.json();
    console.log(JSON.stringify({ event: 'mayar_success', endpoint, data_keys: Object.keys(data) }));
    return {
      invoice_id: data.data?.id || data.id,
      invoice_url: data.data?.link || data.link || data.data?.url || data.url,
    };
  }

  throw new Error('Pembayaran belum tersedia. Hubungi support@gaslamar.com');
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

const SESSION_TTL = 604800;        // 7 days — single-credit paid sessions (single / coba dulu)
const SESSION_TTL_MULTI = 2592000; // 30 days — 3-Pack / Job Hunt Pack

// Returns the appropriate TTL based on how many total credits the session has.
// Multi-credit sessions (total_credits > 1) get 7 days so users can come back
// the next day (or later) to use remaining credits via the emailed link.
function getSessionTtl(data) {
  return (data && data.total_credits > 1) ? SESSION_TTL_MULTI : SESSION_TTL;
}

async function createSession(env, sessionId, data) {
  await env.GASLAMAR_SESSIONS.put(
    sessionId,
    JSON.stringify({ ...data, created_at: Date.now() }),
    { expirationTtl: getSessionTtl(data) }
  );
}

async function getSession(env, sessionId) {
  const raw = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
  return raw;
}

async function updateSession(env, sessionId, updates) {
  const existing = await getSession(env, sessionId);
  if (!existing) return false;
  const merged = { ...existing, ...updates };
  await env.GASLAMAR_SESSIONS.put(
    sessionId,
    JSON.stringify(merged),
    { expirationTtl: getSessionTtl(merged) }
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
    return rateLimitResponse(request, env);
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

  if (job_desc.length > 5000) {
    return jsonResponse({ message: 'Job description terlalu panjang (maks 5.000 karakter)' }, 400, request, env);
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
      job_desc: job_desc.slice(0, 5000)
    }), { expirationTtl: 7200 }); // 2 hours — gives users time to review hasil before paying

    return jsonResponse({ ...scoring, cv_text_key: cvTextKey }, 200, request, env);
  } catch (e) {
    return jsonResponse({ message: e.message || 'Analisis gagal. Coba lagi.' }, 500, request, env);
  }
}

async function handleCreatePayment(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const allowed = await checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip);
  if (!allowed) {
    return rateLimitResponse(request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { tier, cv_text_key, email: rawEmail, session_secret: rawSecret } = body;

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

  // Create session
  const sessionId = `sess_${crypto.randomUUID()}`;

  const credits = TIER_CREDITS[tier] ?? 1;

  // Compute secret hash — only store it if the client provided a secret
  const secretHash = (rawSecret && typeof rawSecret === 'string' && rawSecret.length <= 256)
    ? await sha256Full(rawSecret)
    : null;

  // Sandbox: skip Mayar entirely — session goes straight to pending, frontend uses /sandbox/pay
  if (env.ENVIRONMENT !== 'production') {
    await env.GASLAMAR_SESSIONS.delete(cv_text_key);

    const sessionData = {
      cv_text: stored.text,
      job_desc: stored.job_desc,
      tier,
      status: 'pending',
      credits_remaining: credits,
      total_credits: credits,
      ip,
      ...(sessionEmail ? { email: sessionEmail } : {}),
      ...(secretHash ? { session_secret_hash: secretHash } : {}),
    };

    // Write with read-back verification — KV is eventually consistent across
    // edge nodes, so we verify the write landed before returning to the client.
    let verified = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await createSession(env, sessionId, sessionData);
      const check = await getSession(env, sessionId);
      if (check) { verified = true; break; }
      logError('sandbox_session_write_unverified', { session_id: sessionId, attempt });
    }
    if (!verified) {
      logError('sandbox_session_create_failed', { session_id: sessionId, tier });
      return jsonResponse({ message: 'Gagal membuat sesi. Coba lagi.' }, 500, request, env);
    }

    log('sandbox_session_created', { session_id: sessionId, tier, credits });
    return jsonResponse({ session_id: sessionId, is_sandbox: true }, 200, request, env);
  }

  try {
    // Create Mayar invoice first — if this fails, cv_text_key is still intact and user can retry
    const { invoice_id, invoice_url } = await createMayarInvoice(sessionId, tier, env);

    // Consume cv_text_key only after invoice is successfully created (atomic enough for this use case)
    await env.GASLAMAR_SESSIONS.delete(cv_text_key);

    // Store session in KV using pre-extracted text from /analyze
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
      ...(secretHash ? { session_secret_hash: secretHash } : {}),
    });

    return jsonResponse({ session_id: sessionId, invoice_url }, 200, request, env);
  } catch (e) {
    console.error(JSON.stringify({ event: 'create_payment_failed', error: e.message, tier, cv_text_key }));
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
  const totalCredits = session.total_credits ?? 1;
  const isMulti = totalCredits > 1;
  const validityText = isMulti ? '30 hari' : '24 jam';
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
      <p style="color:#6B7280;margin-bottom:20px">Paket <strong>${tierLabel}</strong> kamu sudah aktif.</p>
      ${creditsNote}
      <a href="${downloadUrl}"
        style="display:inline-block;background:#1B4FE8;color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;margin-bottom:24px">
        ${isMulti ? 'Mulai Generate CV →' : 'Download CV Sekarang →'}
      </a>
      <p style="font-size:12px;color:#9CA3AF">Link ini berlaku ${validityText}. Kalau sudah kedaluwarsa, mulai ulang dari <a href="https://gaslamar.com/upload.html" style="color:#1B4FE8">sini</a>.</p>
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

// Sends a "CV siap" email after generation completes, with score badge + gaps + upsell.
// score: integer 0-100 (from frontend sessionStorage)
// gaps: string[] top 3 gaps from analysis result
async function sendCVReadyEmail(sessionId, score, gaps, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  const session = await getSession(env, sessionId);
  if (!session || !session.email) return;

  const downloadUrl = `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`;
  const scoreNum = typeof score === 'number' ? score : parseInt(score, 10) || 0;
  const scoreColor = scoreNum >= 75 ? '#059669' : scoreNum >= 50 ? '#D97706' : '#DC2626';
  const top3 = Array.isArray(gaps) ? gaps.slice(0, 3) : [];
  const gapsHtml = top3.length
    ? `<div style="background:#FFF7ED;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0 0 8px;font-size:14px;color:#92400E;font-weight:600">3 gap utama yang sudah diperbaiki di CV tailored-mu:</p>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#78350F">
          ${top3.map(g => `<li style="margin-bottom:4px">${g}</li>`).join('')}
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
      <p style="color:#6B7280;margin-bottom:20px">Paket <strong>${tierLabel}</strong> — hasil analisis AI:</p>
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
      <p style="font-size:12px;color:#9CA3AF">Link download berlaku 24 jam. Pertanyaan? Email ke <a href="mailto:support@gaslamar.com" style="color:#1B4FE8">support@gaslamar.com</a></p>
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
      subject: `CV tailored-mu siap — skor match ${scoreNum}/100 🎯`,
      html,
    }),
  });
}

async function handleMayarWebhook(request, env, ctx) {
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
    // Cannot recover without a secondary index — log for operator visibility and return 200
    console.error(JSON.stringify({ event: 'webhook_no_session', invoiceId, status, redirectUrl }));
    return new Response('OK', { status: 200 });
  }

  // Check if payment is successful
  const isPaid = ['paid', 'settlement', 'capture', 'PAID', 'SETTLEMENT'].includes(status);

  if (isPaid) {
    // Idempotency: skip if already processed (prevents duplicate emails on duplicate webhooks)
    const existing = await getSession(env, sessionId);
    if (existing && existing.status !== 'pending') {
      return new Response('OK', { status: 200 });
    }
    await updateSession(env, sessionId, { status: 'paid', paid_at: Date.now() });
    log('payment_confirmed', { sessionId, invoiceId });
    // Email: use ctx.waitUntil so CF Worker doesn't kill the Resend fetch before it completes
    ctx.waitUntil(
      sendPaymentConfirmationEmail(sessionId, env).catch((e) => {
        logError('email_failed', { sessionId, error: e.message });
      })
    );
  }

  return new Response('OK', { status: 200 });
}

async function handleSessionPing(request, env) {
  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { session_id } = body;
  if (!session_id || !session_id.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
  }

  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ ok: false, expired: true }, 404, request, env);
  }

  // Verify session secret (new sessions require it; legacy sessions without hash skip this check)
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ ok: false, expired: false, message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  // Re-write to refresh KV TTL while user is still active on the page
  await updateSession(env, session_id, { last_active: Date.now() });

  return jsonResponse({ ok: true, status: session.status }, 200, request, env);
}

async function handleCheckSession(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');

  if (!sessionId || !sessionId.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    logError('check_session_not_found', { session_id: sessionId });
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  return jsonResponse({
    status: session.status,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
    tier: session.tier,
  }, 200, request, env);
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

  // Verify session secret (new sessions require it; legacy sessions without hash skip this check)
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  // Allow 'paid' (first time) or 'generating' (retry after failed /generate)
  if (session.status !== 'paid' && session.status !== 'generating') {
    return jsonResponse({ message: 'Pembayaran belum dikonfirmasi' }, 403, request, env);
  }

  // Only transition paid → generating once; already-generating sessions stay generating
  if (session.status === 'paid') {
    await updateSession(env, session_id, { status: 'generating' });
  }

  return jsonResponse({
    cv: session.cv_text,
    job_desc: session.job_desc,
    tier: session.tier,
    credits_remaining: session.credits_remaining ?? 1,
    total_credits: session.total_credits ?? 1,
  }, 200, request, env);
}

// ---- Job Metadata Extraction (for download filename) ----

// Internal sanitizer: transliterate accented chars, strip non-alphanumeric, collapse spaces→hyphens.
function _sanitizeFilenamePart(raw, maxLen) {
  if (!raw) return null;
  const MAP = { 'é':'e','è':'e','ê':'e','ë':'e','à':'a','â':'a','ä':'a','î':'i','ï':'i',
                'ô':'o','ö':'o','ù':'u','û':'u','ü':'u','ç':'c','ñ':'n','ã':'a','õ':'o' };
  let s = raw.replace(/[éèêëàâäîïôöùûüçñãõ]/gi, c => MAP[c.toLowerCase()] || '');
  s = s.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-')
       .slice(0, maxLen).replace(/-+$/, '');
  return s || null;
}

// Extract job_title and company from free-text job description using regex heuristics.
// Pure, synchronous, never throws. Returns { job_title: string|null, company: string|null }.
function extractJobMetadata(jobDesc) {
  if (!jobDesc) return { job_title: null, company: null };

  const lines = jobDesc.split('\n').map(l => l.trim()).filter(Boolean);

  // --- Job title ---
  let job_title = null;
  // 1. Labeled field: "Posisi: X", "Position: X", "Jabatan: X", "Role: X", "Job Title: X"
  for (const line of lines) {
    const m = line.match(/^(?:posisi|jabatan|position|role|job\s*title)\s*[:\-]\s*(.+)/i);
    if (m) { job_title = m[1].trim(); break; }
  }
  // 2. Fallback: first short line that doesn't look like a company name or URL
  if (!job_title) {
    const first = lines.find(l =>
      l.length < 80 &&
      !/^(?:PT|CV|http)/i.test(l) &&
      !/^\d/.test(l)
    );
    if (first) job_title = first;
  }

  // --- Company ---
  let company = null;
  // 1. Labeled field: "Perusahaan: X", "Company: X", "Employer: X", "Instansi: X"
  for (const line of lines) {
    const m = line.match(/^(?:perusahaan|instansi|company|employer|nama\s*perusahaan)\s*[:\-]\s*(.+)/i);
    if (m) { company = m[1].trim(); break; }
  }
  // 2. Indonesian company patterns across all lines
  if (!company) {
    for (const line of lines) {
      const pt  = line.match(/\bPT\.?\s+([A-Za-z0-9][A-Za-z0-9\s]{1,30})/i);
      const cv  = line.match(/\bCV\.?\s+([A-Za-z0-9][A-Za-z0-9\s]{1,30})/i);
      const tbk = line.match(/([A-Za-z0-9][A-Za-z0-9\s]{1,30})\s+Tbk\b/i);
      const inc = line.match(/([A-Za-z0-9][A-Za-z0-9\s]{1,30})\s+(?:Inc|Ltd|Corp|Pte)\b/i);
      const match = pt || cv || tbk || inc;
      if (match) { company = match[1].trim(); break; }
    }
  }

  return {
    job_title: _sanitizeFilenamePart(job_title, 20),
    company:   _sanitizeFilenamePart(company, 20),
  };
}

async function handleGenerate(request, env, ctx) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const allowed = await checkRateLimit(env, env.RATE_LIMITER_GENERATE, ip);
  if (!allowed) {
    return rateLimitResponse(request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { session_id, job_desc: newJobDesc, score, gaps } = body;

  if (!session_id || !session_id.startsWith('sess_')) {
    return jsonResponse({ message: 'Session ID tidak valid' }, 400, request, env);
  }

  // Optional new job_desc for multi-credit re-use (3-Pack / JobHunt)
  if (newJobDesc !== undefined) {
    if (typeof newJobDesc !== 'string' || newJobDesc.length > 5000) {
      return jsonResponse({ message: 'Job description terlalu panjang (maks 5.000 karakter)' }, 400, request, env);
    }
  }

  // Verify session exists and has status 'generating' (set by /get-session)
  // All CV data comes from KV — browser cannot inject arbitrary content
  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  // Verify session secret (new sessions require it; legacy sessions without hash skip this check)
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
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

    log('generate_success', { session_id, tier, credits_remaining: newCreditsRemaining });

    // Fire post-generate email (non-blocking) if score/gaps provided by frontend
    if (ctx && (score !== undefined || gaps !== undefined)) {
      ctx.waitUntil(sendCVReadyEmail(session_id, score, gaps, env).catch((e) => {
        logError('cv_ready_email_failed', { session_id, error: e.message });
      }));
    }

    const { job_title, company } = extractJobMetadata(effectiveJobDesc);
    return jsonResponse({ cv_id: cvId, cv_en: cvEn, credits_remaining: newCreditsRemaining, total_credits: session.total_credits ?? 1, job_title: job_title ?? null, company: company ?? null }, 200, request, env);
  } catch (e) {
    // On failure, reset to 'paid' so user can retry (don't consume the credit)
    logError('generate_failed', { session_id, error: e.message });
    await updateSession(env, session_id, { status: 'paid' }).catch((e2) => {
      logError('generate_recovery_failed', { session_id, error: e2.message });
    });
    return jsonResponse({ message: e.message || 'Generate CV gagal. Coba lagi.' }, 500, request, env);
  }
}

async function handleSubmitEmail(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Reuse payment rate limiter (5 req/min per IP)
  const allowed = await checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip);
  if (!allowed) {
    return rateLimitResponse(request, env);
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

// ---- Sandbox Test Helper ----

async function handleSandboxPay(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ message: 'Invalid JSON' }, 400, request, env); }

  const { session_id } = body;
  if (!session_id || !session_id.startsWith('sess_')) {
    return jsonResponse({ message: 'Invalid session_id' }, 400, request, env);
  }

  const session = await getSession(env, session_id);
  if (!session) return jsonResponse({ message: 'Session not found' }, 404, request, env);
  if (session.status === 'paid') return jsonResponse({ ok: true, already_paid: true }, 200, request, env);

  await updateSession(env, session_id, { status: 'paid', paid_at: Date.now() });
  console.log({ event: 'sandbox_payment_confirmed', sessionId: session_id });

  // Send payment confirmation email (same as production Mayar webhook path)
  if (ctx) {
    ctx.waitUntil(
      sendPaymentConfirmationEmail(session_id, env).catch((e) => {
        logError('sandbox_email_failed', { session_id, error: e.message });
      })
    );
  }

  return jsonResponse({ ok: true }, 200, request, env);
}

// ---- Fetch Job URL ----

async function handleFetchJobUrl(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, env.RATE_LIMITER_ANALYZE, ip);
  if (!allowed) return rateLimitResponse(request, env);

  const { url } = await request.json().catch(() => ({}));

  if (!url || typeof url !== 'string') {
    return jsonResponse({ message: 'Parameter url wajib diisi' }, 400, request, env);
  }

  // Only allow http/https
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return jsonResponse({ message: 'URL tidak valid' }, 400, request, env);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return jsonResponse({ message: 'URL harus menggunakan https' }, 400, request, env);
  }

  // Fetch the page with a browser-like User-Agent
  let pageRes;
  try {
    pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });
  } catch (err) {
    return jsonResponse({ message: 'Tidak bisa mengakses URL tersebut. Coba copy-paste manual.' }, 422, request, env);
  }

  if (!pageRes.ok) {
    return jsonResponse({ message: `Halaman tidak bisa diakses (${pageRes.status}). Coba copy-paste manual.` }, 422, request, env);
  }

  const contentType = pageRes.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return jsonResponse({ message: 'URL bukan halaman web (HTML). Coba copy-paste manual.' }, 422, request, env);
  }

  // Extract text using HTMLRewriter — extract all text from <body>, rely on JD markers below
  // to trim nav/header noise. Avoid el.onEndTag() which throws on void elements.
  const chunks = [];

  await new HTMLRewriter()
    .on('script, style, noscript', {
      text() { /* drop script/style text */ },
    })
    .on('body', {
      text(text) {
        const t = text.text.replace(/\s+/g, ' ');
        if (t.trim()) chunks.push(t);
      },
    })
    .transform(pageRes)
    .text();

  let raw = chunks.join(' ').replace(/\s{3,}/g, '\n\n').trim();

  if (!raw || raw.length < 50) {
    return jsonResponse({ message: 'Tidak bisa mengekstrak teks dari halaman ini. Coba copy-paste manual.' }, 422, request, env);
  }

  // LinkedIn-specific: job descriptions are buried after a lot of nav text.
  // Try to find a sensible starting point by looking for common JD markers.
  const JD_MARKERS = [
    'About the job', 'Job Description', 'Deskripsi pekerjaan',
    'Requirements', 'Qualifications', 'Responsibilities',
    'Kualifikasi', 'Persyaratan', 'Tanggung Jawab',
    'About this role', 'What you\'ll do', 'What we\'re looking for',
  ];
  let trimStart = 0;
  for (const marker of JD_MARKERS) {
    const idx = raw.indexOf(marker);
    if (idx !== -1 && idx < raw.length * 0.6) {
      trimStart = idx;
      break;
    }
  }
  if (trimStart > 0) raw = raw.slice(trimStart);

  if (raw.length > 5000) raw = raw.slice(0, 5000);

  return jsonResponse({ job_desc: raw }, 200, request, env);
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
        return handleMayarWebhook(request, env, ctx);
      }

      if (method === 'POST' && pathname === '/session/ping') {
        return handleSessionPing(request, env);
      }

      if (method === 'GET' && pathname === '/check-session') {
        return handleCheckSession(request, env);
      }

      if (method === 'POST' && pathname === '/get-session') {
        return handleGetSession(request, env);
      }

      if (method === 'POST' && pathname === '/generate') {
        return handleGenerate(request, env, ctx);
      }

      if (method === 'POST' && pathname === '/submit-email') {
        return handleSubmitEmail(request, env);
      }

      if (method === 'POST' && pathname === '/fetch-job-url') {
        return handleFetchJobUrl(request, env);
      }

      if (method === 'POST' && pathname === '/feedback') {
        const body = await request.json().catch(() => ({}));
        log('user_feedback', { type: body.type, answer: body.answer, ip: request.headers.get('CF-Connecting-IP') });
        return jsonResponse({ ok: true }, 200, request, env);
      }

      // Sandbox-only: simulate payment confirmation for testing (blocked in production)
      if (method === 'POST' && pathname === '/sandbox/pay') {
        if (env.ENVIRONMENT === 'production') {
          return jsonResponse({ message: 'Not found' }, 404, request, env);
        }
        return handleSandboxPay(request, env, ctx);
      }

      // Sandbox detection probe — returns 200 in sandbox, 404 in production
      if (method === 'GET' && pathname === '/sandbox/status') {
        if (env.ENVIRONMENT === 'production') {
          return new Response(null, { status: 404, headers: getCorsHeaders(request, env) });
        }
        return jsonResponse({ sandbox: true }, 200, request, env);
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
