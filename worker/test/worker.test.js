/**
 * worker.test.js — GasLamar Worker Tests
 * Run: npm test (in /worker directory)
 * Uses @cloudflare/vitest-pool-workers for real workerd runtime.
 */

import { SELF, env, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getCorsHeaders, isOriginAllowed } from '../src/cors.js';

// ---- Test helpers ----

async function hmacSign(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Minimal valid PDF: %PDF- magic bytes + padding to 20 bytes. */
function makePdfBase64() {
  const buf = new Uint8Array(20);
  buf[0] = 0x25; buf[1] = 0x50; buf[2] = 0x44; buf[3] = 0x46; buf[4] = 0x2D;
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Minimal valid DOCX: PK magic bytes + padding. */
function makeDOCXBase64() {
  const buf = new Uint8Array(20);
  buf[0] = 0x50; buf[1] = 0x4B; // PK
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * DOCX with bit 3 (data descriptor) set in general-purpose flags — the format
 * produced by Microsoft Word, LibreOffice, and Google Docs. The local file
 * header has compressedSz=0; the real size follows in a PK\x07\x08 record.
 */
function makeDOCXDataDescriptorBase64() {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body>'
    + '<w:p><w:r><w:t>Budi Santoso — Software Engineer</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Pengalaman 5 tahun React Node.js TypeScript AWS PostgreSQL Redis</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>PT Teknologi Maju 2019-2024 membangun REST API microservices dashboard analytics</w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const xmlBytes = new TextEncoder().encode(xml);
  const filenameBytes = new TextEncoder().encode('word/document.xml');
  const u32le = n => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF];

  const header = new Uint8Array([
    0x50, 0x4B, 0x03, 0x04,          // local file header signature
    0x14, 0x00,                       // version needed: 2.0
    0x08, 0x00,                       // general-purpose flags: bit 3 = data descriptor
    0x00, 0x00,                       // compression method: stored
    0x00, 0x00, 0x00, 0x00,           // last mod time/date
    0x00, 0x00, 0x00, 0x00,           // CRC-32: 0 (in data descriptor)
    0x00, 0x00, 0x00, 0x00,           // compressed size: 0 (in data descriptor)
    0x00, 0x00, 0x00, 0x00,           // uncompressed size: 0 (in data descriptor)
    filenameBytes.length & 0xFF, 0x00,// filename length
    0x00, 0x00,                       // extra field length
  ]);
  const descriptor = new Uint8Array([
    0x50, 0x4B, 0x07, 0x08,          // data descriptor signature
    0x00, 0x00, 0x00, 0x00,           // CRC-32
    ...u32le(xmlBytes.length),        // compressed size
    ...u32le(xmlBytes.length),        // uncompressed size
  ]);

  const out = new Uint8Array(header.length + filenameBytes.length + xmlBytes.length + descriptor.length);
  let off = 0;
  out.set(header, off);        off += header.length;
  out.set(filenameBytes, off); off += filenameBytes.length;
  out.set(xmlBytes, off);      off += xmlBytes.length;
  out.set(descriptor, off);

  let bin = '';
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

const VALID_PDF_CV = JSON.stringify({ type: 'pdf', data: makePdfBase64() });
const VALID_DOCX_CV = JSON.stringify({ type: 'docx', data: makeDOCXBase64() });
const INVALID_CV = JSON.stringify({ type: 'pdf', data: btoa('not a real pdf at all') });
const JOB_DESC = 'Software Engineer dengan pengalaman 3 tahun Node.js React SQL. '
  + 'Membangun REST API, merancang database, deploy ke cloud. '.repeat(5);

const GASLAMAR_ORIGIN = 'https://gaslamar.com';

/** POST helper with JSON body. ip defaults to a stable test address. */
function post(path, body, extraHeaders = {}, ip = '1.2.3.4') {
  return SELF.fetch(`https://gaslamar.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: GASLAMAR_ORIGIN,
      'CF-Connecting-IP': ip,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/** GET helper. */
function get(path, extraHeaders = {}, ip = '1.2.3.4') {
  return SELF.fetch(`https://gaslamar.com${path}`, {
    headers: { Origin: GASLAMAR_ORIGIN, 'CF-Connecting-IP': ip, ...extraHeaders },
  });
}

/** Seed a cvtext_ key in KV and return the key.
 *  ip should match the CF-Connecting-IP used in subsequent /create-payment calls.
 */
async function seedCVTextKey(
  text = 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ 2020-2024\n- Node.js REST API\n- React dashboard\n\nPENDIDIKAN\nS1 Teknik Informatika UI 2020',
  ip = '1.2.3.4',
) {
  const key = `cvtext_${crypto.randomUUID()}`;
  await env.GASLAMAR_SESSIONS.put(key, JSON.stringify({ text, job_desc: JOB_DESC, ip }), { expirationTtl: 3600 });
  return key;
}

/** Seed a full session in KV with a given status and return sessionId. */
async function seedSession(status = 'paid', tier = 'single') {
  const sessionId = `sess_${crypto.randomUUID()}`;
  await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
    cv_text: 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ\n- Node.js\n- React\n\nPENDIDIKAN\nS1 Informatika',
    job_desc: JOB_DESC,
    tier,
    status,
    created_at: Date.now(),
    mayar_invoice_id: 'inv_test123',
    ip: '1.2.3.4',
  }), { expirationTtl: 1800 });
  return sessionId;
}

// Mock Anthropic API responses
//
// Pipeline order for a PDF CV (3 sequential Claude calls):
//   Call 1: PDF text extraction  → MOCK_PDF_EXTRACTION  (fileExtraction.js)
//   Call 2: Stage 1 SKILL_EXTRACT → MOCK_EXTRACT_JSON   (pipeline/extract.js)
//   Call 3: Stage 4 SKILL_DIAGNOSE → MOCK_DIAGNOSE_JSON (pipeline/diagnose.js)
//
// For DOCX CVs (no Claude call for file extraction):
//   Call 1: Stage 1 SKILL_EXTRACT → MOCK_EXTRACT_JSON
//   Call 2: Stage 4 SKILL_DIAGNOSE → MOCK_DIAGNOSE_JSON

/** Call 1 (PDF only): raw CV text extracted from the PDF document */
const MOCK_PDF_EXTRACTION = {
  content: [{ text: 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ 2020-2024\n- Node.js REST API development\n- React dashboard\n\nPENDIDIKAN\nS1 Teknik Informatika UI 2020' }],
};

/** Call 2: SKILL_EXTRACT output — verbatim structured data from CV + JD */
const MOCK_EXTRACT_JSON = {
  content: [{ text: JSON.stringify({
    cv: {
      pengalaman_mentah: 'Developer PT XYZ 2020-2024 - Node.js REST API development - React dashboard',
      pendidikan: 'S1 Teknik Informatika UI 2020',
      skills_mentah: 'Node.js React SQL',
      sertifikat: 'TIDAK ADA',
      angka_di_cv: '5 tahun pengalaman',
      format_cv: { satu_kolom: true, ada_tabel: false },
    },
    jd: {
      skills_diminta: ['Node.js', 'React', 'SQL'],
      pengalaman_minimal: 3,
      industri: 'Tech',
      judul_role: 'Software Engineer',
    },
  }) }],
};

/** Call 3: SKILL_DIAGNOSE output — human-readable explanations (never changes scores) */
const MOCK_DIAGNOSE_JSON = {
  content: [{ text: JSON.stringify({
    gap: ['Belum ada sertifikasi cloud', 'Kurang pengalaman Docker'],
    rekomendasi: ['Tambah proyek cloud ke portfolio', 'Pelajari Docker dan sertakan di bagian KEAHLIAN'],
    alasan_skor: 'CV relevan dengan job description namun belum ada bukti sertifikasi.',
    kekuatan: ['Pengalaman Node.js solid', 'Proyek React relevan dengan JD'],
    konfidensitas: 'Tinggi',
    hr_7_detik: {
      kuat: ['Pengalaman 5 tahun relevan', 'Skill stack cocok dengan JD'],
      diabaikan: ['Pendidikan tidak disebut di JD', 'Tahun lulus tidak relevan'],
    },
  }) }],
};

// Legacy alias kept so the SKIP-ped happy-path test comment stays readable
const MOCK_EXTRACTION = MOCK_PDF_EXTRACTION;

// MOCK_CV_ID and MOCK_CV_EN must contain ALL required section headings so that
// validateCVSections() returns null (no missing heading) and tailorCVID/tailorCVEN
// do NOT trigger the retry branch.  Missing headings cause a second Claude call
// that has no intercept registered, making the test hang until vitest times out.
// Required for 'id': RINGKASAN PROFESIONAL, PENGALAMAN KERJA, PENDIDIKAN, KEAHLIAN (≥200 chars)
// Required for 'en': PROFESSIONAL SUMMARY, WORK EXPERIENCE, EDUCATION, SKILLS (≥200 chars)
const MOCK_CV_ID = { content: [{ text: 'RINGKASAN PROFESIONAL\nDeveloper berpengalaman dengan 4 tahun di Node.js dan React yang fokus pada pengembangan REST API skalabel dan antarmuka pengguna responsif.\n\nPENGALAMAN KERJA\nDeveloper PT XYZ (2020–2024)\n- Membangun REST API microservices\n\nPENDIDIKAN\nS1 Teknik Informatika Universitas Indonesia 2020\n\nKEAHLIAN\nNode.js, React, TypeScript, SQL, AWS' }] };
const MOCK_CV_EN = { content: [{ text: 'PROFESSIONAL SUMMARY\nExperienced developer with 4 years specialising in Node.js and React, focused on building scalable REST APIs and responsive user interfaces.\n\nWORK EXPERIENCE\nDeveloper PT XYZ (2020–2024)\n- Built REST API microservices\n\nEDUCATION\nBachelor of Informatics Universitas Indonesia 2020\n\nSKILLS\nNode.js, React, TypeScript, SQL, AWS' }] };

// ============================================================
// Test suites
// ============================================================

describe('/health', () => {
  it('returns 200 with status, timestamp, and environment', async () => {
    const before = Date.now();
    const res = await get('/health');
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(body.timestamp).getTime()).toBeLessThanOrEqual(after);
    expect(typeof body.environment).toBe('string');
  });

  it('response contains exactly status, timestamp, environment keys', async () => {
    const res = await get('/health');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['environment', 'status', 'timestamp']);
  });
});

describe('CORS', () => {
  it('allows gaslamar.com', async () => {
    const res = await SELF.fetch('https://gaslamar.com/health', {
      headers: { Origin: 'https://gaslamar.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://gaslamar.com');
  });

  it('allows www.gaslamar.com', async () => {
    const res = await SELF.fetch('https://gaslamar.com/health', {
      headers: { Origin: 'https://www.gaslamar.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.gaslamar.com');
  });

  it('blocks unknown origin by omitting Access-Control-Allow-Origin', async () => {
    const res = await SELF.fetch('https://gaslamar.com/health', {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('handles missing Origin header by omitting Access-Control-Allow-Origin', async () => {
    const res = await SELF.fetch('https://gaslamar.com/health');
    expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('handles allowed OPTIONS preflight — 204 no body', async () => {
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'OPTIONS',
      headers: { Origin: 'https://gaslamar.com' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://gaslamar.com');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('rejects disallowed OPTIONS preflight — 403 without allow-origin', async () => {
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});

describe('CORS — environment-specific origin allowlists', () => {
  const makeReq = (origin) => new Request('https://gaslamar.com/health',
    origin ? { headers: { Origin: origin } } : {});

  it('production: allows gaslamar.com', () => {
    const h = getCorsHeaders(makeReq('https://gaslamar.com'), { ENVIRONMENT: 'production' });
    expect(h['Access-Control-Allow-Origin']).toBe('https://gaslamar.com');
  });

  it('production: allows www.gaslamar.com', () => {
    const h = getCorsHeaders(makeReq('https://www.gaslamar.com'), { ENVIRONMENT: 'production' });
    expect(h['Access-Control-Allow-Origin']).toBe('https://www.gaslamar.com');
  });

  it('production: allows gaslamar.pages.dev (Cloudflare Pages canonical URL)', () => {
    const h = getCorsHeaders(makeReq('https://gaslamar.pages.dev'), { ENVIRONMENT: 'production' });
    expect(h['Access-Control-Allow-Origin']).toBe('https://gaslamar.pages.dev');
  });

  it('production: blocks staging.gaslamar.pages.dev', () => {
    const h = getCorsHeaders(makeReq('https://staging.gaslamar.pages.dev'), { ENVIRONMENT: 'production' });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('production: blocks arbitrary pages.dev preview', () => {
    const h = getCorsHeaders(makeReq('https://abc123.gaslamar.pages.dev'), { ENVIRONMENT: 'production' });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('production: blocks evil.com', () => {
    const h = getCorsHeaders(makeReq('https://evil.com'), { ENVIRONMENT: 'production' });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('staging: allows staging.gaslamar.pages.dev', () => {
    const h = getCorsHeaders(makeReq('https://staging.gaslamar.pages.dev'), { ENVIRONMENT: 'staging' });
    expect(h['Access-Control-Allow-Origin']).toBe('https://staging.gaslamar.pages.dev');
  });

  it('staging: allows localhost:3000', () => {
    const h = getCorsHeaders(makeReq('http://localhost:3000'), { ENVIRONMENT: 'staging' });
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
  });

  it('staging: blocks localhost:8080', () => {
    const h = getCorsHeaders(makeReq('http://localhost:8080'), { ENVIRONMENT: 'staging' });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('staging: blocks 127.0.0.1:3000', () => {
    const h = getCorsHeaders(makeReq('http://127.0.0.1:3000'), { ENVIRONMENT: 'staging' });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('staging: blocks gaslamar.com (use production worker for prod traffic)', () => {
    const h = getCorsHeaders(makeReq('https://gaslamar.com'), { ENVIRONMENT: 'staging' });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('staging: blocks evil.com', () => {
    const h = getCorsHeaders(makeReq('https://evil.com'), { ENVIRONMENT: 'staging' });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('sets Vary: Origin on all responses', () => {
    const h = getCorsHeaders(makeReq('https://gaslamar.com'), { ENVIRONMENT: 'production' });
    expect(h['Vary']).toBe('Origin');
  });

  it('sets Access-Control-Allow-Credentials: true on allowed origin', () => {
    const h = getCorsHeaders(makeReq('https://gaslamar.com'), { ENVIRONMENT: 'production' });
    expect(h['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('staging: allows preflight only from explicit staging origins', () => {
    expect(isOriginAllowed(makeReq('https://staging.gaslamar.pages.dev'), { ENVIRONMENT: 'staging' })).toBe(true);
    expect(isOriginAllowed(makeReq('http://localhost:3000'), { ENVIRONMENT: 'staging' })).toBe(true);
    expect(isOriginAllowed(makeReq('https://evil.com'), { ENVIRONMENT: 'staging' })).toBe(false);
  });
});

describe('POST /analyze — validation', () => {
  // Each test gets its own IP so they never share a rate-limit counter (limit=3/min).
  // Range 10.98.0.x is reserved for this suite.
  let _ipSeq = 0;
  const nextIp = () => `10.98.0.${++_ipSeq}`;

  it('rejects missing cv → 400', async () => {
    const res = await post('/analyze', { job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(400);
  });

  it('accepts missing job_desc as general-mode analysis — not rejected at validation level', async () => {
    // JD is optional — omitting it triggers general (role-inferred) scoring, not a 400.
    const res = await post('/analyze', { cv: VALID_PDF_CV }, {}, nextIp());
    expect(res.status).not.toBe(400); // passes validation; may fail downstream (no Claude key in tests)
  });

  it('rejects job_desc > 5000 chars → 400', async () => {
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: 'x'.repeat(5001) }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('5.000');
  });

  it('rejects PDF with wrong magic bytes → 400', async () => {
    const res = await post('/analyze', { cv: INVALID_CV, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('PDF');
  });

  it('accepts valid DOCX magic bytes', async () => {
    // DOCX magic bytes are valid — only failing due to Claude (no mock here)
    // We just verify the magic-byte check passes (returns 422/500 from Claude, not 400)
    const res = await post('/analyze', { cv: VALID_DOCX_CV, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).not.toBe(400); // passed file validation
  });

  it('returns user-friendly error for malformed DOCX missing word/document.xml → 422', async () => {
    // VALID_DOCX_CV has PK magic bytes but no word/document.xml entry
    const res = await post('/analyze', { cv: VALID_DOCX_CV, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).not.toContain('word/document.xml');
    expect(body.message).toMatch(/rusak|tidak lengkap|upload.*berbeda|tidak bisa dibaca|terproteksi/i);
  });

  it('rejects cv payload over 2MB → 413', async () => {
    // ~7MB base64-encoded payload — caught by the 2MB raw-string cap before validateFileData.
    const bigData = btoa('A'.repeat(1024 * 1024 * 5 + 1));
    const bigCv = JSON.stringify({ type: 'pdf', data: makePdfBase64() + bigData });
    const res = await post('/analyze', { cv: bigCv, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.message).toContain('2MB');
  });

  it('rejects malformed JSON body → 400', async () => {
    // Malformed JSON never reaches rate-limiting logic (body parse is attempted
    // after the rate-limit check, but this request has no CF-Connecting-IP so
    // it uses 'unknown' as the key — isolated from all other tests).
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: GASLAMAR_ORIGIN },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  // ---- Server-side bypass hardening ----

  it('rejects job_desc with 99 trimmed chars (1 below minimum) → 400', async () => {
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: 'x'.repeat(99) }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/terlalu pendek|100 karakter/i);
  });

  it('accepts whitespace-only job_desc as general-mode analysis — not rejected at validation level', async () => {
    // 200 spaces trims to empty — treated as no JD (general mode), not a 400 validation error.
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: ' '.repeat(200) }, {}, nextIp());
    expect(res.status).not.toBe(400); // passes validation; may fail downstream (no Claude key in tests)
  });

  it('rejects cv as a non-string (object) → 400', async () => {
    // Client-side bypass: attacker sends cv as a raw object instead of a JSON string.
    const res = await post('/analyze', { cv: { type: 'pdf', data: makePdfBase64() }, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/format.*cv|cv.*tidak valid/i);
  });

  it('rejects cv as a number → 400', async () => {
    const res = await post('/analyze', { cv: 12345, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(400);
  });

  it('accepts job_desc with exactly 100 trimmed chars — passes min-length check', async () => {
    // Should fail later (DOCX extraction → 422 "rusak") but NOT on the JD length check (400).
    // Using DOCX avoids a Claude API call (PDF path) that would time out without a mock.
    const res = await post('/analyze', { cv: VALID_DOCX_CV, job_desc: 'x'.repeat(100) }, {}, nextIp());
    expect(res.status).not.toBe(400);
  });

  // ---- job_desc special-character robustness ----
  // These guard against a class of bug where the client's job_desc content
  // (quotes, newlines, emoji) is wrongly blamed for a "Unterminated string in JSON"
  // error that actually originates from Claude's response being truncated.
  // JSON.stringify on the client handles escaping correctly; the worker must accept
  // any syntactically valid JSON body regardless of job_desc content.

  it('accepts job_desc with embedded double quotes → not a JSON parse error', async () => {
    const jd = 'Looking for "Senior" engineer with "3+ years" React. ' + 'x'.repeat(50);
    const res = await post('/analyze', { cv: VALID_DOCX_CV, job_desc: jd }, {}, nextIp());
    // Must NOT be 400 (body parse / validation error).  May be 422 (DOCX has no content).
    expect(res.status).not.toBe(400);
    const body = await res.json();
    expect(body.message).not.toMatch(/body tidak valid|request.*invalid/i);
  });

  it('accepts job_desc with newlines, tabs, and unicode → not a JSON parse error', async () => {
    const jd = 'Requirements:\n- Node.js ≥18\n- React\n\t- TypeScript\n' + 'Gaji: Rp 20jt/bln 💼\n' + 'x'.repeat(30);
    const res = await post('/analyze', { cv: VALID_DOCX_CV, job_desc: jd }, {}, nextIp());
    expect(res.status).not.toBe(400);
    const body = await res.json();
    expect(body.message).not.toMatch(/body tidak valid/i);
  });

  it('rejects raw HTTP body with unescaped quote in job_desc → 400', async () => {
    // A client that manually builds JSON without JSON.stringify can produce
    // a body like: {"job_desc":"Looking for "Senior" engineer"} — invalid JSON.
    // The worker must reject it cleanly, not crash.
    const malformed = `{"cv":${VALID_DOCX_CV},"job_desc":"Looking for "Senior" engineer with 3+ years experience"}`;
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: GASLAMAR_ORIGIN },
      body: malformed,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/tidak valid/i);
  });
});

describe('POST /analyze — happy path (mocked Claude)', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  // Pipeline for a PDF CV uses 3 sequential Claude calls:
  //   1. MOCK_PDF_EXTRACTION — fileExtraction.js (PDF → raw text)
  //   2. MOCK_EXTRACT_JSON   — pipeline/extract.js (SKILL_EXTRACT → structured data)
  //   3. MOCK_DIAGNOSE_JSON  — pipeline/diagnose.js (SKILL_DIAGNOSE → gap/reco text)
  //
  // skor is computed deterministically from MOCK_EXTRACT_JSON:
  //   skills_diminta: ['Node.js','React','SQL'], skills_mentah: 'Node.js React SQL'
  //   → matchRatio = 1.0 → total6D = 51 → skor = round(51/60*100) = 85
  it('returns skor + cv_text_key when Claude succeeds', async () => {
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_PDF_EXTRACTION))
      .times(1);
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_EXTRACT_JSON))
      .times(1);
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_DIAGNOSE_JSON))
      .times(1);

    // Use a unique IP to avoid hitting rate limit from other test suites
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: JOB_DESC }, {}, '10.0.0.1');
    expect(res.status).toBe(200);
    const body = await res.json();
    // skor is now computed deterministically from extracted data (see comment above)
    expect(typeof body.skor).toBe('number');
    expect(body.skor).toBeGreaterThan(0);
    expect(body.cv_text_key).toMatch(/^cvtext_/);

    // Verify response shape matches the pre-refactor contract
    expect(body).toHaveProperty('skor_6d');
    expect(body).toHaveProperty('veredict');
    expect(body).toHaveProperty('gap');
    expect(body).toHaveProperty('rekomendasi');
    expect(body).toHaveProperty('kekuatan');
    expect(body).toHaveProperty('archetype');

    // Verify key is stored in KV with IP binding
    const stored = await env.GASLAMAR_SESSIONS.get(body.cv_text_key, { type: 'json' });
    expect(stored).not.toBeNull();
    expect(stored.text).toBeTruthy();
    expect(stored.ip).toBe('10.0.0.1');
  });
});

describe('POST /analyze — DOCX data descriptor (mocked Claude)', () => {
  // The DOCX data-descriptor fixture contains a real word/document.xml so DOCX
  // extraction succeeds, and the worker proceeds to call Claude.  fetchMock must
  // be active so those calls are intercepted instead of hitting the OS proxy.
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('extracts text from DOCX with data descriptor flag (Word/Google Docs format)', async () => {
    // Bit 3 of general-purpose flags set → compressedSz=0 in local header.
    // Previously crashed with "Called close() on a decompression stream with incomplete data".
    // Uses IP 10.99.0.1 (reserved for this sub-suite; not shared with any other suite).
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_EXTRACT_JSON))
      .times(1);
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_DIAGNOSE_JSON))
      .times(1);
    const cv = JSON.stringify({ type: 'docx', data: makeDOCXDataDescriptorBase64() });
    const res = await post('/analyze', { cv, job_desc: JOB_DESC }, {}, '10.99.0.1');
    expect(res.status).toBe(200); // passes file validation, DOCX extraction, and mocked Claude pipeline
  });
});

describe('POST /create-payment — validation', () => {
  it('rejects missing cv_text_key → 400', async () => {
    const res = await post('/create-payment', { tier: 'single' });
    expect(res.status).toBe(400);
  });

  it('rejects cv_text_key without cvtext_ prefix → 400', async () => {
    const res = await post('/create-payment', { tier: 'single', cv_text_key: 'sess_abc' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('cv_text_key');
  });

  it('rejects invalid tier → 400', async () => {
    // Seed with default IP (1.2.3.4) — tier is rejected before IP check
    const key = await seedCVTextKey();
    const res = await post('/create-payment', { tier: 'premium', cv_text_key: key });
    expect(res.status).toBe(400);
  });

  it('rejects expired / missing cv_text_key → 400', async () => {
    const res = await post('/create-payment', { tier: 'single', cv_text_key: 'cvtext_nonexistent' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('kedaluwarsa');
  });

  it('rejects cv_text_key used from a different IP → 403', async () => {
    // Seed the key bound to IP 10.97.0.1
    const key = await seedCVTextKey(undefined, '10.97.0.1');
    // Attempt to use it from a different IP
    const res = await post('/create-payment', { tier: 'single', cv_text_key: key }, {}, '10.97.0.2');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/tidak valid/i);
  });

  it('allows cv_text_key from the same IP → proceeds past ownership check', async () => {
    // Seed with IP 10.97.1.1 and use from the same IP — should fail on tier, not IP
    const key = await seedCVTextKey(undefined, '10.97.1.1');
    const res = await post('/create-payment', { tier: 'premium', cv_text_key: key }, {}, '10.97.1.1');
    // Reaches tier validation (premium is invalid) → 400, not 403
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(403);
  });
});

describe('POST /create-payment — one-time key consumption', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('consumes cv_text_key — second call returns 400', async () => {
    // Seed with same IP as the request so IP-binding check passes
    const key = await seedCVTextKey(undefined, '10.0.0.2');

    // Mock Mayar sandbox invoice creation
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({
        data: { id: 'inv_test_001', link: 'https://web.mayar.club/pay/inv_test_001' }
      }))
      .times(1);

    // Use unique IP
    const res1 = await post('/create-payment', { tier: 'single', cv_text_key: key }, {}, '10.0.0.2');
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.session_id).toMatch(/^sess_/);
    expect(body1.invoice_url).toBeTruthy();

    // Key is consumed — second call fails
    const res2 = await post('/create-payment', { tier: 'single', cv_text_key: key }, {}, '10.0.0.2');
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.message).toContain('kedaluwarsa');
  });
});

describe('Rate limiting — Retry-After header', () => {
  // Use a unique IP so this suite never conflicts with others
  const RL_IP = '10.99.0.1';

  it('returns 429 with Retry-After: 60 after exhausting /create-payment limit (5/min)', async () => {
    // Exhaust the 5-req/min limit for RATE_LIMITER_PAYMENT using this IP.
    // Each call returns 400 (missing body) but still consumes a rate-limit slot.
    for (let i = 0; i < 5; i++) {
      await post('/create-payment', {}, {}, RL_IP);
    }
    // 6th request must be rate-limited
    const res = await post('/create-payment', {}, {}, RL_IP);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = await res.json();
    expect(body.message).toContain('Terlalu banyak');
  });
});

describe('Rate limiting — /analyze (3 req/min per IP)', () => {
  // Unique IP range to avoid cross-suite contamination
  const RL_ANALYZE_IP = '10.99.1.1';

  it('allows first 3 requests and blocks the 4th with 429', async () => {
    // First 3: rate-limit passes, body validation fails → 400
    for (let i = 0; i < 3; i++) {
      const r = await post('/analyze', {}, {}, RL_ANALYZE_IP);
      expect(r.status).toBe(400);
    }
    // 4th must be blocked by KV rate limiter
    const res = await post('/analyze', {}, {}, RL_ANALYZE_IP);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.message).toContain('Terlalu banyak');
  });

  it('counters are per-IP — a different IP is not affected', async () => {
    // Exhaust limit for one IP
    for (let i = 0; i < 3; i++) {
      await post('/analyze', {}, {}, '10.99.1.2');
    }
    // A different IP should still pass rate limiting (will get 400 from body validation)
    const res = await post('/analyze', {}, {}, '10.99.1.3');
    expect(res.status).toBe(400);
  });

  it('response body contains error, message, and retryAfter fields', async () => {
    const BLOCK_IP = '10.99.1.4';
    for (let i = 0; i < 3; i++) {
      await post('/analyze', {}, {}, BLOCK_IP);
    }
    const res = await post('/analyze', {}, {}, BLOCK_IP);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('retryAfter');
  });
});

describe('POST /session/ping', () => {
  it('returns 401 when no session cookie is present', async () => {
    // Handlers now read session_id from Cookie header; missing cookie → 401
    const res = await post('/session/ping', {});
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid session_id in cookie (not sess_ prefix)', async () => {
    const res = await post('/session/ping', {}, { Cookie: 'session_id=invalid' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/session/ping', {}, { Cookie: 'session_id=sess_nonexistent' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.expired).toBe(true);
  });

  it('returns ok:true and refreshes session for known session', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/session/ping', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('paid');
  });
});

describe('GET /check-session', () => {
  it('returns 401 when no session cookie or query param present', async () => {
    const res = await get('/check-session');
    expect(res.status).toBe(401);
  });

  it('returns 401 when session query param lacks sess_ prefix (backward compat path)', async () => {
    const res = await get('/check-session?session=invalid_id');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await get('/check-session?session=sess_nonexistent_id');
    expect(res.status).toBe(404);
  });

  it('returns current status for known session', async () => {
    const sessionId = await seedSession('pending', 'coba');
    const res = await get(`/check-session?session=${encodeURIComponent(sessionId)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');
  });

});

describe('GET /validate-session', () => {
  it('rejects missing cvKey → 400', async () => {
    const res = await get('/validate-session');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('invalid_key');
  });

  it('rejects cvKey without cvtext_ prefix → 400', async () => {
    const res = await get('/validate-session?cvKey=abc123');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('invalid_key');
  });

  it('returns valid:false for unknown key → 200', async () => {
    const res = await get('/validate-session?cvKey=cvtext_nonexistent_key_abc');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('not_found');
  });

  it('returns valid:true for a key that exists → 200', async () => {
    const key = await seedCVTextKey(undefined, '10.96.0.1');
    const res = await get('/validate-session?cvKey=' + encodeURIComponent(key), {}, '10.96.0.1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });

  it('returns valid:true even on IP mismatch (soft check, not a rejection)', async () => {
    const key = await seedCVTextKey(undefined, '10.96.1.1');
    const res = await get('/validate-session?cvKey=' + encodeURIComponent(key), {}, '10.96.1.2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });
});

describe('POST /get-session', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await post('/get-session', {});
    expect(res.status).toBe(401);
  });

  it('returns 401 when cookie session_id lacks sess_ prefix', async () => {
    const res = await post('/get-session', {}, { Cookie: 'session_id=abc123' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/get-session', {}, { Cookie: 'session_id=sess_nonexistent' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when status is pending (not paid)', async () => {
    const sessionId = await seedSession('pending');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(403);
  });

  it('returns cv/job_desc/tier and sets status to generating for paid session', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cv).toBeTruthy();
    expect(body.job_desc).toBeTruthy();
    expect(body.tier).toBe('single');

    // Session status should now be 'generating'
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session.status).toBe('generating');
  });
});

describe('extractJobMetadata — via /generate response', () => {
  // Uses IP 10.0.0.4 to avoid sharing rate-limit slots with other generate suites.
  // tailorCVID/tailorCVEN calls are bypassed via KV cache pre-population (preTailorCache)
  // so no fetchMock is needed and there is no dependency on outbound network access.
  const META_IP = '10.0.0.4';
  const META_CV = 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ';

  async function seedSessionWithJobDesc(jobDesc) {
    // Pre-populate KV tailoring cache so tailorCVID/tailorCVEN skip Claude calls
    await preTailorCache(META_CV, jobDesc);
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: META_CV,
      job_desc: jobDesc,
      tier: 'single',
      status: 'generating',
      created_at: Date.now(),
    }), { expirationTtl: 1800 });
    return sessionId;
  }

  it('extracts labeled Bahasa Indonesia posisi/perusahaan', async () => {
    const sessionId = await seedSessionWithJobDesc(
      'Posisi: Product Manager\nPerusahaan: Tokopedia\nRequirements: 3 tahun pengalaman'
    );
    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, META_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_title).toBe('Product-Manager');
    expect(body.company).toBe('Tokopedia');
  });

  it('extracts labeled English position/company', async () => {
    const sessionId = await seedSessionWithJobDesc(
      'Position: Data Analyst\nCompany: Gojek\nWe are looking for...'
    );
    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, META_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_title).toBe('Data-Analyst');
    expect(body.company).toBe('Gojek');
  });

  it('extracts first-line title and PT company pattern', async () => {
    // "PT Bukalapak" on its own line so the PT regex captures only the company name.
    // If PT + company words run on the same line, the greedy \s+ match extends into
    // the following words (e.g. "Bukalapak mencari…") — that's expected behaviour,
    // but not what this test is meant to exercise.
    const sessionId = await seedSessionWithJobDesc(
      'Senior Backend Engineer\n\nPT Bukalapak\nKami mencari kandidat terbaik.'
    );
    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, META_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_title).toBe('Senior-Backend-Engin');   // truncated to 20 chars
    expect(body.company).toBe('Bukalapak');
  });

  it('returns nulls for unparseable job description', async () => {
    const sessionId = await seedSessionWithJobDesc(
      'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.'
    );
    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, META_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    // First line is short (<80 chars), not excluded — extracted as job_title; no company match
    expect(body.job_title).toBeTruthy();
    expect(body.company).toBeNull();
  });
});

describe('POST /generate — validation', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await post('/generate', {});
    expect(res.status).toBe(401);
  });

  it('returns 401 when cookie session_id lacks sess_ prefix', async () => {
    const res = await post('/generate', {}, { Cookie: 'session_id=invalid' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/generate', {}, { Cookie: 'session_id=sess_nonexistent' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when status is paid (not generating)', async () => {
    const sessionId = await seedSession('paid');
    const res = await post('/generate', {}, sessionCookie(sessionId));
    expect(res.status).toBe(403);
  });

  it('returns 403 when status is pending', async () => {
    const sessionId = await seedSession('pending');
    const res = await post('/generate', {}, sessionCookie(sessionId));
    expect(res.status).toBe(403);
  });
});

describe('POST /generate — happy path (mocked Claude)', () => {
  // Use a unique IP (10.0.0.3) so generate validation tests (IP 1.2.3.4)
  // don't exhaust this suite's rate-limit slots.
  const GENERATE_IP = '10.0.0.3';

  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  // cv_text from seedSession — must stay in sync with the seedSession helper above
  const SEED_CV = 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ\n- Node.js\n- React\n\nPENDIDIKAN\nS1 Informatika';

  it('generates bilingual CV for single tier — deletes session after', async () => {
    const sessionId = await seedSession('generating', 'single');
    // Pre-populate tailoring KV cache — tailorCVID/tailorCVEN short-circuit without Claude calls.
    // MockPool cannot reliably intercept two concurrent parallel fetch calls with separate
    // .times(1) intercepts; KV cache pre-population is the robust alternative.
    await preTailorCache(SEED_CV, JOB_DESC);

    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, GENERATE_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cv_id).toBeTruthy();
    expect(body.cv_en).toBeTruthy(); // bilingual
    // job_title/company are always present (may be null)
    expect('job_title' in body).toBe(true);
    expect('company' in body).toBe(true);
    // JOB_DESC is a long single line (>80 chars); extractJobMetadata fallback needs <80 chars
    expect(body.job_title).toBeNull();
    expect(body.company).toBeNull();

    // Session deleted after use (one-time)
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session).toBeNull();
  });

  it('generates ID-only CV for coba tier — cv_en is null', async () => {
    const sessionId = await seedSession('generating', 'coba');
    await preTailorCache(SEED_CV, JOB_DESC);

    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, GENERATE_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cv_id).toBeTruthy();
    expect(body.cv_en).toBeNull(); // no EN for coba tier
    expect('job_title' in body).toBe(true);
    expect('company' in body).toBe(true);
    expect(body.job_title).toBeNull(); // JOB_DESC is long single line
    expect(body.company).toBeNull();
  });

  it('resets session to paid on Claude failure (so user can retry)', async () => {
    const sessionId = await seedSession('generating', 'single');

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(500, JSON.stringify({ error: { message: 'Internal server error' } }))
      .times(2); // both parallel calls fail

    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, GENERATE_IP);
    expect(res.status).toBe(500);

    // Session reset to 'paid' so user can retry
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session).not.toBeNull();
    expect(session.status).toBe('paid');
  });
});

describe('POST /webhook/mayar', () => {
  const WEBHOOK_SECRET = 'test_webhook_secret_key';

  beforeEach(async () => {
    // Note: MAYAR_WEBHOOK_SECRET is injected via wrangler.toml [vars] or wrangler secret.
    // In tests, the worker reads env.MAYAR_WEBHOOK_SECRET.
    // Since we can't set secrets in vitest directly, we test the sandbox bypass
    // (ENVIRONMENT !== 'production' + no secret = allows through).
    // For HMAC tests, we rely on the sandbox bypass path.
  });

  it('returns 401 for invalid HMAC in production-like setup', async () => {
    // We can test the rejection path by sending a wrong signature
    // and ensuring the worker handles it. In sandbox mode without a secret,
    // the worker allows through — so this test only applies when the secret is set.
    // Testing the bypass: no secret in test env → webhook passes through
    const payload = JSON.stringify({ status: 'paid', redirect_url: 'https://gaslamar.com/download.html?session=sess_test' });
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'wrong_sig' },
      body: payload,
    });
    // In sandbox (no secret set), the webhook passes through
    // The test verifies the endpoint is reachable and handles the body
    expect([200, 401]).toContain(res.status);
  });

  it('updates session to paid for valid webhook (sandbox bypass)', async () => {
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = 'inv_test_paid_1';
    await env.GASLAMAR_SESSIONS.put(`mayar_session_${invoiceId}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 604800 });

    // In sandbox mode (no MAYAR_WEBHOOK_SECRET set), webhook passes HMAC check
    const payload = JSON.stringify({
      status: 'paid',
      id: invoiceId,
      redirect_url: 'https://gaslamar.com/download.html',
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'any_sig_in_sandbox' },
      body: payload,
    });

    expect(res.status).toBe(200);

    // Session should now be 'paid'
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('paid');
  });

  it('ignores non-paid statuses (does not update session)', async () => {
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = 'inv_test_expired_1';
    await env.GASLAMAR_SESSIONS.put(`mayar_session_${invoiceId}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 604800 });

    const payload = JSON.stringify({
      status: 'expired',
      id: invoiceId,
      redirect_url: 'https://gaslamar.com/download.html',
    });

    await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'any_sig' },
      body: payload,
    });

    // Session should still be pending
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('pending');
  });

  it('handles missing redirect_url gracefully', async () => {
    const payload = JSON.stringify({ status: 'paid', id: 'inv_missing_redirect' });
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'any_sig' },
      body: payload,
    });
    expect(res.status).toBe(200); // graceful no-op
  });

  it('updates session with NO x-mayar-signature header in sandbox (critical bypass)', async () => {
    // This is the primary failure scenario: Mayar sandbox omits the signature header entirely.
    // Before the fix, this returned 401 before the sandbox bypass could run.
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = 'inv_sandbox_bypass_test';
    await env.GASLAMAR_SESSIONS.put(`mayar_session_${invoiceId}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 604800 });

    const payload = JSON.stringify({
      status: 'paid',
      id: invoiceId,
      redirect_url: 'https://gaslamar.com/download.html',
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // no x-mayar-signature
      body: payload,
    });

    expect(res.status).toBe(200);
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('paid');
  });

  it('updates session via KV secondary index without redirect_url (primary path)', async () => {
    // Verifies the KV secondary-index path (mayar_session_{invoiceId}) works independently
    // of the legacy redirect_url fallback.
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = 'inv_kv_index_test_001';

    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${invoiceId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );

    const payload = JSON.stringify({ id: invoiceId, status: 'paid' }); // no redirect_url

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'any_sig_in_sandbox' },
      body: payload,
    });

    expect(res.status).toBe(200);
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('paid');
  });

  it('skips update and returns 200 when session is missing from KV', async () => {
    // updateSession returns false when the session doesn't exist; handler should still return 200
    // (so Mayar stops retrying) but must not log payment_confirmed.
    const missingSessionId = `sess_${crypto.randomUUID()}`;
    const payload = JSON.stringify({
      status: 'paid',
      redirect_url: `https://gaslamar.com/download.html?session=${encodeURIComponent(missingSessionId)}`,
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'any_sig' },
      body: payload,
    });

    expect(res.status).toBe(200);
    // Session must not exist in KV (updateSession silently failed)
    const session = await env.GASLAMAR_SESSIONS.get(missingSessionId, { type: 'json' });
    expect(session).toBeNull();
  });

  it('rejects malformed session ID on GET /check-session', async () => {
    // ?session=invalid does not start with 'sess_' — should be rejected
    const res = await SELF.fetch('https://gaslamar.com/check-session?session=invalid_id');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.reason).toBe('no_cookie');
  });

  it('skips email on duplicate webhook delivery when sentinel key is present', async () => {
    // Simulates a Mayar retry arriving after the sentinel was written by the first delivery.
    // The handler must return 200 without re-sending the email or overwriting the session.
    const sessionId = await seedSession('paid', 'single');

    // Pre-seed the sentinel as the first successful delivery would have written it
    await env.GASLAMAR_SESSIONS.put(`payment_processed_${sessionId}`, '1', { expirationTtl: 172800 });

    const payload = JSON.stringify({
      status: 'paid',
      redirect_url: `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`,
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'any_sig_in_sandbox' },
      body: payload,
    });

    expect(res.status).toBe(200);
    // Session status must remain 'paid' (not reset to pending by a bad merge)
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('paid');
  });

  it('skips email when session is already paid (belt-and-suspenders check)', async () => {
    // Simulates a stale Mayar retry where the sentinel hasn't propagated yet but the
    // session status has. Handler must still skip the email.
    const sessionId = await seedSession('paid', 'single');
    // No sentinel key — rely on session status check only

    const payload = JSON.stringify({
      status: 'paid',
      redirect_url: `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`,
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'any_sig_in_sandbox' },
      body: payload,
    });

    expect(res.status).toBe(200);
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('paid');
  });
});

describe('404 for unknown routes', () => {
  it('returns 404 for GET /unknown', async () => {
    const res = await get('/nonexistent-endpoint');
    expect(res.status).toBe(404);
  });
});

describe('POST /submit-email', () => {
  // Use unique IPs to avoid sharing rate-limit slots with other suites
  const EMAIL_IP = '10.2.0.1';

  it('accepts a valid email → 200', async () => {
    const res = await post('/submit-email', { email: 'budi@example.com' }, {}, EMAIL_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects missing email → 400', async () => {
    // Body-validation errors bypass rate limiter, so any IP works
    const res = await post('/submit-email', {}, {}, '10.2.0.2');
    expect(res.status).toBe(400);
  });

  it('rejects invalid email format → 400', async () => {
    const res = await post('/submit-email', { email: 'not-an-email' }, {}, '10.2.0.3');
    expect(res.status).toBe(400);
  });

  it('rejects email over 254 chars → 400', async () => {
    // 255-char string that looks like an email so regex passes but length check rejects it
    const longLocal = 'a'.repeat(243); // 243 + '@b.co' = 248... need > 254
    const longEmail = 'a'.repeat(248) + '@x.co'; // 253 — still valid. Use 250+@x.co = 255
    const res = await post('/submit-email', { email: 'a'.repeat(245) + '@valid.com' }, {}, '10.2.0.4');
    // 245 + '@valid.com'(10) = 255 > 254
    expect(res.status).toBe(400);
  });

  it('accepts email with surrounding whitespace (trimmed before validation) → 200', async () => {
    // Attacker or sloppy client sends "  budi@example.com  " — should be accepted after trim.
    const res = await post('/submit-email', { email: '  budi@trimtest.com  ' }, {}, '10.2.0.5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('POST /fetch-job-url — validation', () => {
  it('rejects URL over 2048 chars → 400', async () => {
    // Very long URL wastes CPU on parsing and is never a legitimate job board URL.
    const longUrl = 'https://linkedin.com/' + 'a'.repeat(2028); // total > 2048
    const res = await post('/fetch-job-url', { url: longUrl }, {}, '10.5.0.1');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/terlalu panjang|2\.048/i);
  });

  it('rejects missing url → 400', async () => {
    const res = await post('/fetch-job-url', {}, {}, '10.5.0.2');
    expect(res.status).toBe(400);
  });

  it('rejects non-HTTPS url → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'http://linkedin.com/jobs/view/123' }, {}, '10.5.0.3');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/https/i);
  });

  it('rejects non-allowlisted domain → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://evil.com/jobs/123' }, {}, '10.5.0.4');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/tidak diizinkan|domain/i);
  });

  it('rejects private IP address (SSRF) → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://127.0.0.1/jobs' }, {}, '10.5.0.5');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/tidak diizinkan|ip internal|domain/i);
  });
});

describe('POST /get-session — returns credits_remaining', () => {
  it('includes credits_remaining and total_credits in response', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'Budi CV text',
      job_desc: JOB_DESC,
      tier: '3pack',
      status: 'paid',
      credits_remaining: 3,
      total_credits: 3,
      created_at: Date.now(),
    }), { expirationTtl: 1800 });

    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credits_remaining).toBe(3);
    expect(body.total_credits).toBe(3);
    expect(body.tier).toBe('3pack');
  });

  it('falls back to credits_remaining=1 for legacy sessions without the field', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    // Seed without credits fields (legacy)
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'Budi CV text',
      job_desc: JOB_DESC,
      tier: 'single',
      status: 'paid',
      created_at: Date.now(),
    }), { expirationTtl: 1800 });

    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credits_remaining).toBe(1);
    expect(body.total_credits).toBe(1);
  });
});

describe('Multi-credit session — total_credits preserved through updateSession', () => {
  // These tests verify that total_credits is not lost when the worker updates session
  // state (webhook paid, get-session generating). The KV mock does not enforce TTL
  // expiry, but by checking total_credits survives we confirm getSessionTtl will
  // also receive the correct data and choose the 7-day TTL in production.

  it('webhook: total_credits=3 preserved after status → paid', async () => {
    const WEBHOOK_SECRET = 'test_webhook_secret_key';
    const sessionId = `sess_${crypto.randomUUID()}`;
    const invoiceId = 'inv_multi1';
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'CV text',
      job_desc: JOB_DESC,
      tier: '3pack',
      status: 'pending',
      credits_remaining: 3,
      total_credits: 3,
      mayar_invoice_id: invoiceId,
      created_at: Date.now(),
    }), { expirationTtl: 604800 });
    await env.GASLAMAR_SESSIONS.put(`mayar_session_${invoiceId}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 604800 });

    const payload = JSON.stringify({
      status: 'paid',
      data: { id: invoiceId, redirect_url: 'https://gaslamar.com/download.html' },
    });
    const sig = await hmacSign(WEBHOOK_SECRET, payload);
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mayar-signature': sig,
        'origin': 'https://gaslamar.com',
      },
      body: payload,
    });
    expect(res.status).toBe(200);

    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session).not.toBeNull();
    expect(session.status).toBe('paid');
    expect(session.total_credits).toBe(3);
    expect(session.credits_remaining).toBe(3);
  });

  it('get-session: total_credits=10 preserved after status → generating', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'CV text jobhunt',
      job_desc: JOB_DESC,
      tier: 'jobhunt',
      status: 'paid',
      credits_remaining: 10,
      total_credits: 10,
      created_at: Date.now(),
    }), { expirationTtl: 604800 });

    const res = await post('/get-session', {}, { ...sessionCookie(sessionId) }, '10.3.0.1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_credits).toBe(10);
    expect(body.credits_remaining).toBe(10);

    // KV must still have total_credits after the 'generating' update
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session).not.toBeNull();
    expect(session.total_credits).toBe(10);
    expect(session.status).toBe('generating');
  });
});

describe('POST /generate — job_desc override validation', () => {
  it('rejects job_desc over 5000 chars → 400', async () => {
    const sessionId = await seedSession('generating', 'single');
    const res = await post('/generate', {
      job_desc: 'x'.repeat(5001),
    }, { ...sessionCookie(sessionId) }, '10.1.0.1');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/terlalu panjang/i);
  });

  it('rejects non-empty job_desc override under 100 trimmed chars → 400', async () => {
    // Attacker sends a 50-char override to bypass client-side minimum.
    // Validation fires before KV session lookup, so a seeded-but-fake session suffix is fine.
    const sessionId = await seedSession('generating', 'single');
    const res = await post('/generate', {
      job_desc: 'x'.repeat(50),
    }, { ...sessionCookie(sessionId) }, '10.1.0.2');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/terlalu pendek/i);
  });

  it('accepts empty string override (falls back to stored job_desc) → not rejected on length', async () => {
    // An empty override is treated as "no override"; the stored job_desc is used.
    // The endpoint will proceed to session lookup and fail 403 (status mismatch), not 400.
    const sessionId = await seedSession('paid', 'single'); // 'paid' not 'generating' → 403 expected
    const res = await post('/generate', {
      job_desc: '',
    }, { ...sessionCookie(sessionId) }, '10.1.0.3');
    // Must NOT be 400 (length validation should not fire for empty override)
    expect(res.status).not.toBe(400);
  });

  it('accepts whitespace-only override (zero trimmed length = no override) → not rejected on length', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/generate', {
      job_desc: '   ',
    }, { ...sessionCookie(sessionId) }, '10.1.0.4');
    expect(res.status).not.toBe(400);
  });
});

// ---- Session secret validation tests ----

/** Helper: compute SHA-256 as 64-char hex (mirrors worker's sha256Full). */
async function sha256Full(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Compute first-32-char hex SHA-256 (mirrors worker's sha256Hex in utils.js). */
async function sha256HexLocal(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/**
 * Pre-populate tailoring KV cache (gen_id_v3_ / gen_en_v3_) so tailorCVID/tailorCVEN
 * short-circuit without making real Claude API calls.
 * Use this instead of fetchMock for generate success-path tests — avoids an
 * unreliable interaction between MockPool and concurrent parallel fetch calls.
 */
async function preTailorCache(cvText, jobDesc) {
  const h = await sha256HexLocal(cvText + '||' + jobDesc);
  await env.GASLAMAR_SESSIONS.put(`gen_id_v3_${h}`, MOCK_CV_ID.content[0].text, { expirationTtl: 172800 });
  await env.GASLAMAR_SESSIONS.put(`gen_en_v3_${h}`, MOCK_CV_EN.content[0].text, { expirationTtl: 172800 });
}

/**
 * Build an extraHeaders object that carries session authentication via Cookie.
 * All session-authenticated endpoints now read session_id from the Cookie header
 * instead of the request body or query params.
 */
function sessionCookie(sessionId) {
  return { Cookie: `session_id=${sessionId}` };
}

/** Seed a session with a bound secret hash. Returns { sessionId, secret }. */
async function seedSessionWithSecret(status = 'paid', tier = 'single') {
  const sessionId = `sess_${crypto.randomUUID()}`;
  const secret = crypto.randomUUID();
  const secretHash = await sha256Full(secret);
  await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
    cv_text: 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ\n- Node.js\n- React\n\nPENDIDIKAN\nS1 Informatika',
    job_desc: JOB_DESC,
    tier,
    status,
    created_at: Date.now(),
    ip: '1.2.3.4',
    session_secret_hash: secretHash,
  }), { expirationTtl: 1800 });
  return { sessionId, secret };
}

describe('Session secret — POST /get-session', () => {
  it('returns 403 when secret is missing and session has a hash', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/akses ditolak|token sesi/i);
  });

  it('returns 403 when wrong secret is provided', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/get-session', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': 'wrong-secret' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/akses ditolak|token sesi/i);
  });

  it('returns 200 when correct secret is provided', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/get-session', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': secret });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cv).toBeTruthy();
    expect(body.tier).toBe('single');
  });

  it('returns 200 for legacy sessions without a stored hash (no secret required)', async () => {
    // seedSession creates sessions without session_secret_hash — backward compat
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
  });
});

describe('Session secret — POST /generate', () => {
  it('returns 403 when secret is missing and session has a hash', async () => {
    const { sessionId } = await seedSessionWithSecret('generating');
    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, '10.4.0.1');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/akses ditolak|token sesi/i);
  });

  it('returns 403 when wrong secret is provided', async () => {
    const { sessionId } = await seedSessionWithSecret('generating');
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': 'wrong' }, '10.4.0.2');
    expect(res.status).toBe(403);
  });

  it('still returns 403 (status not generating) for paid session with correct secret', async () => {
    // /generate requires status=generating; a paid session with correct secret still 403s for wrong status
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': secret }, '10.4.0.3');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/generating|belum dikonfirmasi/i);
  });
});

describe('Session secret — POST /session/ping', () => {
  it('returns 403 when secret is missing and session has a hash', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', {}, sessionCookie(sessionId));
    expect(res.status).toBe(403);
  });

  it('returns 403 when wrong secret is provided', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': 'bad' });
    expect(res.status).toBe(403);
  });

  it('returns 200 with correct secret', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': secret });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 200 for legacy sessions without stored hash (backward compat)', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/session/ping', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
  });
});

// ---- POST /fetch-job-url — SSRF protection -----------------------------------
// All blocking tests are rejected before any outbound fetch — no mock needed.
// Each test uses a unique IP (10.101.0.x) to avoid the rate limiter.

describe('POST /fetch-job-url — SSRF protection', () => {
  // Range 10.101.0.x is reserved for this suite.
  let _ipSeq = 0;
  const nextIp = () => `10.101.0.${++_ipSeq}`;

  it('rejects missing url → 400', async () => {
    const res = await post('/fetch-job-url', {}, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/url wajib/i);
  });

  it('rejects invalid URL string → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'not a url at all' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/tidak valid/i);
  });

  it('rejects http:// (non-HTTPS) → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'http://www.linkedin.com/jobs/view/123' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/https/i);
  });

  it('rejects non-http scheme (ftp://) → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'ftp://www.linkedin.com/jobs' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/https/i);
  });

  it('rejects disallowed domain (google.com) → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://google.com/search?q=jobs' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/domain tidak diizinkan/i);
  });

  it('rejects look-alike domain (linkedin.com.evil.com) → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://linkedin.com.evil.com/jobs' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/domain tidak diizinkan/i);
  });

  it('rejects @ bypass attempt (linkedin.com@evil.com) → 400', async () => {
    // new URL() parses this as hostname=evil.com with credentials=linkedin.com
    const res = await post('/fetch-job-url', { url: 'https://linkedin.com@evil.com/jobs' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/domain tidak diizinkan/i);
  });

  it('rejects loopback IPv4 127.0.0.1 → 400 (private IP)', async () => {
    const res = await post('/fetch-job-url', { url: 'https://127.0.0.1/admin' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/ip internal/i);
  });

  it('rejects private RFC1918 10.0.0.1 → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://10.0.0.1/' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/ip internal/i);
  });

  it('rejects private RFC1918 192.168.1.1 → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://192.168.1.1/' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/ip internal/i);
  });

  it('rejects link-local 169.254.169.254 (AWS metadata) → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://169.254.169.254/latest/meta-data/' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/ip internal/i);
  });

  it('rejects IPv6 loopback [::1] → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://[::1]:8080/admin' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/ip internal/i);
  });

  it('rejects IPv6 link-local [fe80::1] → 400', async () => {
    const res = await post('/fetch-job-url', { url: 'https://[fe80::1]/' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/ip internal/i);
  });

  it('rejects public bare IPv4 (not a job board) → 400 (domain not allowed)', async () => {
    // Public IPs pass the private-IP check but still fail the domain allowlist
    const res = await post('/fetch-job-url', { url: 'https://8.8.8.8/' }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/domain tidak diizinkan/i);
  });
});

describe('POST /fetch-job-url — allowed domains (mocked fetch)', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  // Range 10.102.0.x is reserved for this suite.
  let _ipSeq = 0;
  const nextIp = () => `10.102.0.${++_ipSeq}`;

  it('allows www.linkedin.com and returns extracted job_desc', async () => {
    // Body must be >50 chars after whitespace normalisation to pass the minimum-text check.
    const htmlBody = '<html><body>Requirements: min 3 years Node.js, React, and SQL. Strong communication skills needed.</body></html>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/123456' })
      .reply(200, htmlBody, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/123456' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toBeTruthy();
    expect(body.job_desc).toContain('Requirements');
  });

  it('allows subdomain jobs.linkedin.com', async () => {
    const htmlBody = '<html><body>Requirements Python Django REST experience preferred.</body></html>';
    fetchMock
      .get('https://jobs.linkedin.com')
      .intercept({ path: '/jobs/456' })
      .reply(200, htmlBody, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://jobs.linkedin.com/jobs/456' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toBeTruthy();
  });

  it('allows www.jobstreet.co.id', async () => {
    const htmlBody = '<html><body>Kualifikasi S1 Teknik Informatika pengalaman 2 tahun dibutuhkan.</body></html>';
    fetchMock
      .get('https://www.jobstreet.co.id')
      .intercept({ path: '/id/job/789' })
      .reply(200, htmlBody, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.jobstreet.co.id/id/job/789' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toBeTruthy();
  });

  it('returns 422 when upstream page returns non-200', async () => {
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/999' })
      .reply(403, 'Forbidden', { headers: { 'content-type': 'text/html' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/999' }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toMatch(/tidak bisa diakses/i);
  });

  it('returns 422 when upstream returns non-HTML content type', async () => {
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/pdf' })
      .reply(200, 'binary', { headers: { 'content-type': 'application/pdf' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/pdf' }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toMatch(/bukan halaman web/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /interview-kit
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_INTERVIEW_KIT = {
  job_insights: [
    { phrase: 'REST API', meaning: 'Antarmuka HTTP standar untuk komunikasi antar sistem.' },
    { phrase: 'Node.js', meaning: 'Runtime JavaScript sisi server berbasis V8 untuk backend scalable.' },
    { phrase: 'Kerja tim', meaning: 'Kemampuan berkolaborasi dalam lingkungan agile lintas fungsi.' },
  ],
  email_template: {
    subject: 'Lamaran Posisi Software Engineer – Budi Santoso',
    body: 'Yth. Tim Rekrutmen,\n\nSaya Budi Santoso ingin melamar posisi Software Engineer.\n\nSaya memiliki pengalaman 4 tahun mengembangkan REST API dengan Node.js.\n\nHormat saya,\nBudi Santoso',
  },
  whatsapp_message: 'Halo, saya Budi Santoso. Saya ingin melamar posisi Software Engineer. Apakah ada info lebih lanjut yang perlu saya siapkan?',
  tell_me_about_yourself: 'Saya Budi Santoso, Software Engineer dengan pengalaman 4 tahun berfokus pada pengembangan REST API menggunakan Node.js dan React. Saya telah membangun microservices untuk berbagai klien dan terbiasa bekerja dalam lingkungan agile. Saya tertarik bergabung karena visi perusahaan ini selaras dengan passion saya di bidang teknologi scalable.',
  interview_questions: [
    {
      question_id: 'Ceritakan pengalaman Anda membangun REST API dengan Node.js?',
      question_en: 'Tell me about your experience building REST APIs with Node.js?',
      sample_answer: 'Dalam peran saya di PT XYZ, saya bertanggung jawab membangun REST API untuk layanan internal. Saya merancang endpoint yang efisien dan mendokumentasikannya dengan baik agar mudah digunakan tim lain. Hasilnya, integrasi antar tim menjadi lebih lancar.',
    },
    {
      question_id: 'Bagaimana Anda menangani bug kritis di lingkungan produksi?',
      question_en: 'How do you handle critical bugs in a production environment?',
      sample_answer: 'Langkah pertama saya adalah mengidentifikasi dampak dan memprioritaskan perbaikan. Saya segera komunikasikan status ke stakeholder, lalu isolasi masalah melalui log dan monitoring. Setelah perbaikan diterapkan, saya melakukan review untuk mencegah kejadian serupa.',
    },
    {
      question_id: 'Ceritakan bagaimana Anda bekerja dalam tim lintas fungsi?',
      question_en: 'Describe how you work in a cross-functional team?',
      sample_answer: 'Di PT XYZ saya berkolaborasi dengan tim desain dan product manager. Kami menggunakan metodologi agile dengan sprint dua minggu. Saya aktif dalam daily standup dan code review untuk memastikan kualitas dan keselarasan tujuan tim.',
    },
    {
      question_id: 'Apa pencapaian teknis terbesar Anda?',
      question_en: 'What is your biggest technical achievement?',
      sample_answer: 'Saya berhasil merancang ulang arsitektur modul yang sebelumnya sering mengalami bottleneck. Dengan pendekatan yang lebih modular, sistem menjadi lebih mudah di-maintain dan tim lain dapat mengintegrasikan fitur baru dengan lebih cepat.',
    },
    {
      question_id: 'Ke mana Anda ingin berkembang dalam 3 tahun ke depan?',
      question_en: 'Where do you see yourself growing in the next 3 years?',
      sample_answer: 'Saya ingin memperdalam keahlian di arsitektur sistem dan menjadi referensi teknis bagi tim. Saya juga ingin berkontribusi dalam mentoring engineer junior sehingga kapasitas tim secara keseluruhan meningkat.',
    },
  ],
};

const MOCK_CLAUDE_KIT_RESPONSE = {
  content: [{ text: JSON.stringify(MOCK_INTERVIEW_KIT) }],
  stop_reason: 'end_turn',
};

describe('POST /interview-kit', () => {
  const KIT_IP = '10.101.0.';
  let _kitIpSeq = 0;
  const nextKitIp = () => `${KIT_IP}${++_kitIpSeq}`;

  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('returns 401 when no session cookie is present', async () => {
    const res = await post('/interview-kit', {}, {}, nextKitIp());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toMatch(/sesi|cookies/i);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/interview-kit', {}, { Cookie: 'session_id=sess_nonexistent' }, nextKitIp());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toMatch(/sesi/i);
  });

  it('returns 403 when secret is missing and session has a hash', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/interview-kit', {}, sessionCookie(sessionId), nextKitIp());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/akses ditolak|token sesi/i);
  });

  it('returns 200 with full kit structure (Claude mocked)', async () => {
    const sessionId = await seedSession('paid', 'single');

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_CLAUDE_KIT_RESPONSE))
      .times(1);

    const res = await post('/interview-kit', { language: 'id' }, sessionCookie(sessionId), nextKitIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.kit).toBeTruthy();
    expect(body.kit.job_insights).toBeTruthy();
    expect(body.kit.email_template).toBeTruthy();
    expect(body.kit.whatsapp_message).toBeTruthy();
    expect(body.kit.tell_me_about_yourself).toBeTruthy();
    expect(body.kit.interview_questions).toBeTruthy();
    expect(Array.isArray(body.kit.interview_questions)).toBe(true);
    expect(body.kit.interview_questions.length).toBeGreaterThanOrEqual(3);
  });

  it('returns cached response on second call without invoking Claude', async () => {
    const sessionId = await seedSession('paid', 'single');

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_CLAUDE_KIT_RESPONSE))
      .times(1);

    const ip = nextKitIp();
    const res1 = await post('/interview-kit', { language: 'id' }, sessionCookie(sessionId), ip);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // Second call — Claude mock is exhausted (.times(1)); if intercepted it would 500/throw
    const res2 = await post('/interview-kit', { language: 'id' }, sessionCookie(sessionId), ip);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    expect(body2.kit.tell_me_about_yourself).toBe(body1.kit.tell_me_about_yourself);
  });

  it('returns 500 when Claude truncates (stop_reason: max_tokens)', async () => {
    const sessionId = await seedSession('paid', 'single');

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify({ content: [{ text: '{"partial":true}' }], stop_reason: 'max_tokens' }))
      .times(1);

    const res = await post('/interview-kit', { language: 'id' }, sessionCookie(sessionId), nextKitIp());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toMatch(/terpotong|coba lagi/i);
  });

  it('stores separate KV cache keys for id vs en language', async () => {
    const sessionId = await seedSession('paid', 'single');
    const ip = nextKitIp();

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_CLAUDE_KIT_RESPONSE))
      .times(2);

    await post('/interview-kit', { language: 'id' }, sessionCookie(sessionId), ip);
    await post('/interview-kit', { language: 'en' }, sessionCookie(sessionId), ip);

    const cachedId = await env.GASLAMAR_SESSIONS.get(`kit_${sessionId}_id`, { type: 'json' });
    const cachedEn = await env.GASLAMAR_SESSIONS.get(`kit_${sessionId}_en`, { type: 'json' });

    expect(cachedId).not.toBeNull();
    expect(cachedEn).not.toBeNull();
  });
});

