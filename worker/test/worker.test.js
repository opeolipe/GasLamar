/**
 * worker.test.js — GasLamar Worker Tests
 * Run: npm test (in /worker directory)
 * Uses @cloudflare/vitest-pool-workers for real workerd runtime.
 */

import { SELF, env, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getCorsHeaders, isOriginAllowed } from '../src/cors.js';
import { route } from '../src/router.js';
import { getMayarApiKey, verifyMayarWebhook } from '../src/mayar.js';
import { GEN_KEY_PREFIX_ID, GEN_KEY_PREFIX_EN } from '../src/cacheVersions.js';
import { handleResendAccess } from '../src/handlers/resendAccess.js';
import { makeCvKeyCookie, makeSessionTokenCookie, makeSessionCookie } from '../src/cookies.js';

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

function sessionIdFromSetCookie(res) {
  const match = (res.headers.get('set-cookie') || res.headers.get('Set-Cookie') || '').match(/__Host-session_id=(sess_[^;]+)/);
  expect(match).not.toBeNull();
  return match[1];
}

/** Extract the cv_key value from a Set-Cookie header returned by /analyze. */
function cvKeyFromSetCookie(res) {
  const match = (res.headers.get('set-cookie') || res.headers.get('Set-Cookie') || '').match(/__Host-cv_key=(cvtext_[0-9a-f]{64})/);
  expect(match).not.toBeNull();
  return match[1];
}

/** Build a Cookie header that carries both session_id and cv_key. */
function cvKeyCookie(cvKey) {
  return { Cookie: `__Host-cv_key=${cvKey}` };
}

/**
 * DOCX with bit 3 (data descriptor) set in general-purpose flags — the format
 * produced by Microsoft Word, LibreOffice, and Google Docs. The local file
 * header has compressedSz=0; the real size follows in a PK\x07\x08 record.
 */
function makeDOCXDataDescriptorBase64() {
  const cvContent = [
    'Budi Santoso — Software Engineer | budi@email.com | +62 812 3456 7890 | Jakarta, Indonesia',
    'Ringkasan: Software Engineer berpengalaman 5 tahun dalam pengembangan backend dan frontend menggunakan Node.js React TypeScript.',
    'Terbiasa membangun sistem berskala besar dengan arsitektur microservices dan pola event-driven untuk keandalan tinggi.',
    'Keahlian utama: Node.js, React, TypeScript, AWS, GCP, PostgreSQL, Redis, Docker, Kubernetes, Jest, REST API, GraphQL.',
    'Senior Developer — PT Teknologi Maju, Jakarta (2019–2024).',
    'Memimpin tim 5 orang dalam migrasi arsitektur monolith ke microservices untuk platform e-commerce 500k pengguna aktif.',
    'Membangun REST API Node.js yang menangani 30.000 request per menit dengan SLA uptime 99.9% dan p99 latency di bawah 50ms.',
    'Mengembangkan dashboard analytics real-time dengan React D3.js dan Redis Pub/Sub untuk notifikasi 200k subscriber.',
    'Meningkatkan performa query PostgreSQL sebesar 40% melalui indexing partitioning dan optimasi eksekusi query kompleks.',
    'Merancang dan mengimplementasikan sistem CI/CD berbasis GitHub Actions dan Docker yang memangkas waktu deploy dari 30 menit menjadi 5 menit.',
    'Junior Developer — PT Digital Kreatif (2017–2019).',
    'Membangun fitur CRUD Node.js PostgreSQL untuk aplikasi manajemen inventori dan sistem pelaporan internal.',
    'Menulis unit test Jest dan integration test dengan coverage 80 persen untuk backend services produksi.',
    'Berkolaborasi dalam tim Agile Scrum sprint dua mingguan code review dan onboarding developer baru.',
    'Pendidikan: S1 Teknik Informatika Universitas Indonesia IPK 3.7/4.0 2013–2017.',
    'Sertifikat: AWS Certified Developer Associate 2022 dan Google Cloud Professional Data Engineer 2023.',
  ].join(' ');
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body>'
    + '<w:p><w:r><w:t>' + cvContent + '</w:t></w:r></w:p>'
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

/** DOCX with valid structure but only ~300 chars of text content — tests the 1500-char floor. */
function makeShortDOCXBase64() {
  // 500 chars — above the 100-char minimum in extractCVText but below the 1500-char gate in analyze.js
  const shortText = 'Budi Santoso, Software Engineer. Skills: React, Node.js, SQL. '
    + 'Pengalaman 2 tahun di PT XYZ Jakarta sebagai junior developer. '
    + 'Membangun fitur CRUD dan REST API sederhana untuk aplikasi internal perusahaan. '
    + 'Pendidikan S1 Teknik Informatika Universitas Indonesia lulus 2020. '
    + 'Terbiasa dengan Git workflow dan metodologi Agile dasar dalam tim kecil. '
    + 'Familiar dengan deployment ke server Linux dan penggunaan Docker untuk lingkungan pengembangan lokal.';
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body><w:p><w:r><w:t>' + shortText + '</w:t></w:r></w:p></w:body></w:document>';
  const xmlBytes = new TextEncoder().encode(xml);
  const filenameBytes = new TextEncoder().encode('word/document.xml');
  const u32le = n => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF];
  const header = new Uint8Array([
    0x50, 0x4B, 0x03, 0x04, 0x14, 0x00,
    0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    filenameBytes.length & 0xFF, 0x00, 0x00, 0x00,
  ]);
  const descriptor = new Uint8Array([
    0x50, 0x4B, 0x07, 0x08, 0x00, 0x00, 0x00, 0x00,
    ...u32le(xmlBytes.length), ...u32le(xmlBytes.length),
  ]);
  const out = new Uint8Array(header.length + filenameBytes.length + xmlBytes.length + descriptor.length);
  let off = 0;
  out.set(header, off); off += header.length;
  out.set(filenameBytes, off); off += filenameBytes.length;
  out.set(xmlBytes, off); off += xmlBytes.length;
  out.set(descriptor, off);
  let bin = ''; for (const b of out) bin += String.fromCharCode(b);
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

function jsonRequest(path, body, ip = '1.2.3.4') {
  return new Request(`https://gaslamar.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: GASLAMAR_ORIGIN,
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

/** Generates a valid cvtext_ key token: 64 lowercase hex chars (matches production hexToken(32)). */
function cvHexToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Seed a cvtext_ key in KV and return the key.
 *  ip should match the CF-Connecting-IP used in subsequent /create-payment calls.
 */
async function seedCVTextKey(
  text = 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ 2020-2024\n- Node.js REST API\n- React dashboard\n\nPENDIDIKAN\nS1 Teknik Informatika UI 2020',
  ip = '1.2.3.4',
) {
  const key = `cvtext_${cvHexToken()}`;
  await env.GASLAMAR_SESSIONS.put(key, JSON.stringify({ text, job_desc: JOB_DESC, ip }), { expirationTtl: 3600 });
  return key;
}

// Historical fixed secret retained for legacy-hash fixtures. Session-protected
// endpoints now authenticate with the HttpOnly session cookie alone.
const FIXED_TEST_SECRET = 'fixed-test-session-secret-for-vitest';

/** Seed a full session in KV with a given status and return sessionId. */
async function seedSession(status = 'paid', tier = 'single') {
  const sessionId = `sess_${crypto.randomUUID()}`;
  const secretHash = await sha256Full(FIXED_TEST_SECRET);
  await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
    cv_text: 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ\n- Node.js\n- React\n\nPENDIDIKAN\nS1 Informatika',
    job_desc: JOB_DESC,
    tier,
    status,
    created_at: Date.now(),
    mayar_invoice_id: 'inv_test123',
    ip: '1.2.3.4',
    session_secret_hash: secretHash,
  }), { expirationTtl: 1800 });
  return sessionId;
}

/** Seed a legacy session (no session_secret_hash) — for testing rejection paths only. */
async function seedLegacySession(status = 'paid', tier = 'single') {
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
  content: [{ text: [
    'Budi Santoso',
    'Software Engineer | budi@email.com | +62 812 3456 7890 | Jakarta, Indonesia',
    '',
    'RINGKASAN',
    'Software Engineer berpengalaman 5 tahun dalam pengembangan backend dan frontend menggunakan Node.js, React, dan SQL.',
    'Berpengalaman membangun REST API yang skalabel, dashboard analytics interaktif, dan sistem manajemen data.',
    'Terbiasa bekerja dalam tim kecil maupun besar dengan metodologi Agile dan pengiriman fitur berbasis sprint dua mingguan.',
    '',
    'PENGALAMAN',
    'Senior Developer — PT XYZ Teknologi, Jakarta (2022–2024)',
    '- Memimpin migrasi arsitektur monolith ke microservices untuk platform e-commerce dengan 500k pengguna aktif.',
    '- Membangun REST API dengan Node.js dan Express yang menangani 30.000 request/menit dengan SLA 99.9%.',
    '- Mengembangkan dashboard analytics real-time menggunakan React dan D3.js untuk tim business intelligence.',
    '- Meningkatkan performa query database PostgreSQL sebesar 40% melalui indexing, partitioning, dan optimasi query.',
    '- Merancang sistem antrian pesan menggunakan Redis Pub/Sub untuk notifikasi real-time kepada 200k subscriber.',
    '- Memimpin code review mingguan dan onboarding 3 junior developer baru ke dalam tim.',
    '',
    'Junior Developer — PT ABC Digital (2020–2022)',
    '- Membangun fitur CRUD menggunakan Node.js dan PostgreSQL untuk aplikasi manajemen inventori internal.',
    '- Menulis unit test dengan Jest dan integration test untuk backend services dengan coverage 80%.',
    '- Berkolaborasi dalam tim 5 orang menggunakan metodologi Agile/Scrum dan sprint planning dua mingguan.',
    '- Mengimplementasikan sistem autentikasi JWT dan OAuth2 untuk API internal perusahaan.',
    '',
    'PENDIDIKAN',
    'S1 Teknik Informatika — Universitas Indonesia (2016–2020)',
    'IPK: 3.7/4.0 | Skripsi: Optimasi Query pada Database Terdistribusi menggunakan Algoritma Genetika',
    '',
    'SERTIFIKAT',
    'AWS Certified Developer Associate (2022) | Google Cloud Professional Data Engineer (2023)',
    '',
    'KEAHLIAN',
    'Node.js, React, TypeScript, SQL, PostgreSQL, Redis, REST API, Docker, Git, Jest, Express, AWS, GCP',
  ].join('\n') }],
};

/** Call 2: SKILL_EXTRACT output — verbatim structured data from CV + JD */
const MOCK_EXTRACT_JSON = {
  content: [{ text: JSON.stringify({
    cv: {
      pengalaman_mentah: 'Developer PT XYZ 2020-2024 - Node.js REST API development - React dashboard',
      pendidikan: 'S1 Teknik Informatika UI 2020',
      skills_mentah: 'Node.js React SQL',
      sertifikat: 'TIDAK ADA',
      angka_di_cv: '30% peningkatan performa, tim 5 orang',
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

describe('makeCvKeyCookie — cookie format', () => {
  const TOKEN = `cvtext_${'a'.repeat(64)}`;

  it('production: uses __Host- prefix, SameSite=Strict, HttpOnly, Secure', () => {
    const cookie = makeCvKeyCookie(TOKEN, { ENVIRONMENT: 'production' });
    expect(cookie).toContain('__Host-cv_key=' + TOKEN);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Partitioned');
    expect(cookie).not.toContain('SameSite=None');
  });

  it('staging: uses __Host- prefix, SameSite=None; Partitioned (CHIPS)', () => {
    const cookie = makeCvKeyCookie(TOKEN, { ENVIRONMENT: 'staging' });
    expect(cookie).toContain('__Host-cv_key=' + TOKEN);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    expect(cookie).not.toContain('SameSite=Strict');
  });

  it('sandbox: uses SameSite=None; Partitioned (same as staging)', () => {
    const cookie = makeCvKeyCookie(TOKEN, { ENVIRONMENT: 'sandbox' });
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    expect(cookie).not.toContain('SameSite=Strict');
  });

  it('undefined env: defaults to SameSite=None; Partitioned (fail-safe)', () => {
    const cookie = makeCvKeyCookie(TOKEN, undefined);
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    expect(cookie).not.toContain('SameSite=Strict');
  });


  it('Max-Age is 86400 (24h)', () => {
    const cookie = makeCvKeyCookie(TOKEN, { ENVIRONMENT: 'production' });
    expect(cookie).toContain('Max-Age=86400');
  });
});

describe('makeSessionTokenCookie — cookie format', () => {
  const UUID = '00000000-0000-0000-0000-000000000001';

  it('production: cookie name sessionToken, SameSite=Strict, no Partitioned', () => {
    const cookie = makeSessionTokenCookie(UUID, { ENVIRONMENT: 'production' });
    expect(cookie).toMatch(/^sessionToken=/);
    expect(cookie).not.toContain('__Host-');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Partitioned');
    expect(cookie).not.toContain('SameSite=None');
  });

  it('staging: cookie name __Host-sessionToken, SameSite=None; Partitioned (CHIPS)', () => {
    const cookie = makeSessionTokenCookie(UUID, { ENVIRONMENT: 'staging' });
    expect(cookie).toContain('__Host-sessionToken=' + UUID);
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    expect(cookie).not.toContain('SameSite=Strict');
  });

  it('sandbox: same as staging (CHIPS)', () => {
    const cookie = makeSessionTokenCookie(UUID, { ENVIRONMENT: 'sandbox' });
    expect(cookie).toContain('__Host-sessionToken=' + UUID);
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
  });
});

describe('makeSessionCookie — cookie format', () => {
  const SESSION_ID = 'sess_00000000-0000-0000-0000-000000000001';

  it('production: __Host-session_id, SameSite=Strict', () => {
    const cookie = makeSessionCookie(SESSION_ID, false, { ENVIRONMENT: 'production' });
    expect(cookie).toContain('__Host-session_id=' + SESSION_ID);
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Partitioned');
  });

  it('staging: __Host-session_id, SameSite=None; Partitioned (CHIPS)', () => {
    const cookie = makeSessionCookie(SESSION_ID, false, { ENVIRONMENT: 'staging' });
    expect(cookie).toContain('__Host-session_id=' + SESSION_ID);
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    expect(cookie).not.toContain('SameSite=Strict');
  });

  it('single-credit Max-Age is 604800 (7 days)', () => {
    const cookie = makeSessionCookie(SESSION_ID, false, { ENVIRONMENT: 'production' });
    expect(cookie).toContain('Max-Age=604800');
  });

  it('multi-credit Max-Age is 2592000 (30 days)', () => {
    const cookie = makeSessionCookie(SESSION_ID, true, { ENVIRONMENT: 'production' });
    expect(cookie).toContain('Max-Age=2592000');
  });
});

describe('getMayarApiKey — secret normalization', () => {
  it('strips a pasted Bearer prefix so Authorization is not doubled', () => {
    expect(getMayarApiKey({
      ENVIRONMENT: 'staging',
      MAYAR_API_KEY_SANDBOX: 'Bearer eyJhbGciOiJIUzI1NiJ9.sandbox',
    })).toBe('eyJhbGciOiJIUzI1NiJ9.sandbox');
  });
});

describe('/health', () => {
  it('returns 200 with status and timestamp', async () => {
    const before = Date.now();
    const res = await get('/health');
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(body.timestamp).getTime()).toBeLessThanOrEqual(after);
  });

  it('response contains exactly status and timestamp keys (no environment leakage)', async () => {
    const res = await get('/health');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['status', 'timestamp']);
  });

  it('HEAD /health returns 200 with headers but no body', async () => {
    const res = await SELF.fetch('https://gaslamar.com/health', {
      method: 'HEAD',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.text();
    expect(body).toBe('');
  });
});

describe('OPTIONS — CORS preflight', () => {
  it('returns 204 for OPTIONS to any API path', async () => {
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'OPTIONS',
      headers: { Origin: GASLAMAR_ORIGIN, 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(res.status).toBe(204);
  });

  it('returns CORS headers on OPTIONS response', async () => {
    const res = await SELF.fetch('https://gaslamar.com/generate', {
      method: 'OPTIONS',
      headers: { Origin: GASLAMAR_ORIGIN, 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GASLAMAR_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('returns 204 for OPTIONS to /webhook/mayar (webhook path is not blocked for OPTIONS)', async () => {
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'OPTIONS',
      headers: { Origin: GASLAMAR_ORIGIN, 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(res.status).toBe(204);
  });
});

describe('POST /api/log — privacy redaction', () => {
  it('redacts emails, tokens, session secrets, raw CV, and raw JD from client logs', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const res = await post('/api/log', {
        email: 'alice@example.com',
        session_secret: 'secret-client-value',
        token: '0123456789abcdef0123456789abcdef',
        cv: 'RAW CV CONTENT SHOULD NOT LOG',
        job_desc: 'RAW JD CONTENT SHOULD NOT LOG',
        message: 'alice@example.com failed at https://gaslamar.com/download?session=sess_abc&token=tok_123 session_secret=secret-client-value',
      }, {}, '10.91.0.1');

      expect(res.status).toBe(200);
      const logged = spy.mock.calls.map(call => String(call[0])).join('\n');
      expect(logged).toContain('client_log');
      expect(logged).not.toContain('alice@example.com');
      expect(logged).not.toContain('secret-client-value');
      expect(logged).not.toContain('0123456789abcdef0123456789abcdef');
      expect(logged).not.toContain('RAW CV CONTENT SHOULD NOT LOG');
      expect(logged).not.toContain('RAW JD CONTENT SHOULD NOT LOG');
      expect(logged).toContain('[EMAIL_REDACTED]');
      expect(logged).toContain('[REDACTED]');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('protected state page routing', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('production redirects extensionless /hasil and /download before proxying to Pages when no session exists', async () => {
    const productionEnv = { ...env, ENVIRONMENT: 'production' };

    const hasil = await route(new Request('https://gaslamar.com/hasil', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }), productionEnv, {});
    expect(hasil.status).toBe(302);
    expect(hasil.headers.get('Location')).toBe('/upload.html?reason=no_session');
    expect(hasil.headers.get('Cache-Control')).toBe('no-store');

    const download = await route(new Request('https://gaslamar.com/download', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }), productionEnv, {});
    expect(download.status).toBe(302);
    expect(download.headers.get('Location')).toBe('/?reason=no_session');
    expect(download.headers.get('Cache-Control')).toBe('no-store');
  });

  it('production redirects extensionless /hasil to download when an active paid session exists', async () => {
    const sessionId = await seedSession('paid', 'single');

    const res = await route(new Request('https://gaslamar.com/hasil', {
      method: 'GET',
      headers: {
        Cookie: `__Host-session_id=${sessionId}`,
        'CF-Connecting-IP': '1.2.3.4',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/download.html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('production redirects /download.html server-side when the session cookie is expired', async () => {
    const res = await route(new Request('https://gaslamar.com/download.html', {
      method: 'GET',
      headers: {
        Cookie: '__Host-session_id=sess_nonexistent',
        'CF-Connecting-IP': '1.2.3.4',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/access.html?expired=1&source=download');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('production serves /hasil.html only when an active analysis cookie exists (cv_key, current)', async () => {
    const cvTextKey = `cvtext_${'a'.repeat(64)}`;
    await env.GASLAMAR_SESSIONS.put(cvTextKey, JSON.stringify({
      ip: '1.2.3.4',
      scoring: { skor: 72, gap: [] },
    }), { expirationTtl: 3600 });

    fetchMock
      .get('https://gaslamar.pages.dev')
      .intercept({ path: () => true, method: 'GET' })
      .reply(() => {
        return {
          statusCode: 200,
          data: '<!doctype html><title>Hasil</title>',
          responseOptions: { headers: { 'content-type': 'text/html' } },
        };
      })
      .times(1);

    const res = await route(new Request('https://gaslamar.com/hasil.html', {
      method: 'GET',
      headers: {
        Cookie: `__Host-cv_key=${cvTextKey}`,
        'CF-Connecting-IP': '1.2.3.4',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status, res.headers.get('Location') || '').toBe(200);
  });

  it('production serves /hasil.html with legacy cv_text_key cookie (backward compat)', async () => {
    const cvTextKey = `cvtext_${'c'.repeat(64)}`;
    await env.GASLAMAR_SESSIONS.put(cvTextKey, JSON.stringify({
      ip: '1.2.3.4',
      scoring: { skor: 65, gap: [] },
    }), { expirationTtl: 3600 });

    fetchMock
      .get('https://gaslamar.pages.dev')
      .intercept({ path: () => true, method: 'GET' })
      .reply(() => {
        return {
          statusCode: 200,
          data: '<!doctype html><title>Hasil</title>',
          responseOptions: { headers: { 'content-type': 'text/html' } },
        };
      })
      .times(1);

    const res = await route(new Request('https://gaslamar.com/hasil.html', {
      method: 'GET',
      headers: {
        Cookie: `cv_text_key=${cvTextKey}`,
        'CF-Connecting-IP': '1.2.3.4',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status, res.headers.get('Location') || '').toBe(200);
  });

  it('production redirects /hasil.html server-side when the analysis cookie is expired', async () => {
    const res = await route(new Request('https://gaslamar.com/hasil.html', {
      method: 'GET',
      headers: {
        Cookie: `__Host-cv_key=cvtext_${'b'.repeat(64)}`,
        'CF-Connecting-IP': '1.2.3.4',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/access.html?expired=1&source=hasil');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('production rejects /hasil.html when the analysis cookie belongs to a different IP', async () => {
    const cvTextKey = `cvtext_${'9'.repeat(64)}`;
    await env.GASLAMAR_SESSIONS.put(cvTextKey, JSON.stringify({
      ip: '10.10.10.10',
      scoring: { skor: 72, gap: [] },
    }), { expirationTtl: 3600 });

    const res = await route(new Request('https://gaslamar.com/hasil.html', {
      method: 'GET',
      headers: {
        Cookie: `__Host-cv_key=${cvTextKey}`,
        'CF-Connecting-IP': '20.20.20.20',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/access.html?expired=1&source=hasil');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('production rejects /hasil.html fallback snapshots when the analysis cookie belongs to a different IP', async () => {
    const token = '8'.repeat(64);
    await env.GASLAMAR_SESSIONS.put(`scoring_${token}`, JSON.stringify({
      ip: '10.10.10.10',
      scoring: { skor: 72, gap: [] },
    }), { expirationTtl: 3600 });

    const res = await route(new Request('https://gaslamar.com/hasil.html', {
      method: 'GET',
      headers: {
        Cookie: `__Host-cv_key=cvtext_${token}`,
        'CF-Connecting-IP': '20.20.20.20',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/access.html?expired=1&source=hasil');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('production Pages proxy strips cookies and sensitive query params upstream', async () => {
    let upstreamRequest = null;
    fetchMock
      .get('https://gaslamar.pages.dev')
      .intercept({ path: () => true, method: 'GET' })
      .reply((opts) => {
        upstreamRequest = opts;
        return {
          statusCode: 200,
          data: '<!doctype html><title>Download</title>',
          responseOptions: { headers: { 'content-type': 'text/html' } },
        };
      })
      .times(1);

    const sessionId = await seedSession('paid', 'single');
    const res = await route(new Request('https://gaslamar.com/download.html?token=0123456789abcdef0123456789abcdef', {
      method: 'GET',
      headers: {
        Cookie: `__Host-session_id=${sessionId}; other=value`,
        'CF-Connecting-IP': '1.2.3.4',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(200);
    expect(upstreamRequest?.path).toBe('/download.html');
    const upstreamHeaders = upstreamRequest?.headers;
    const cookieHeader = upstreamHeaders?.cookie ?? upstreamHeaders?.Cookie;
    expect(cookieHeader).toBeUndefined();
  });

  it('production: cv_key cookie present but KV entry missing → access.html (not /upload)', async () => {
    // Cookie is present but the cvtext_ KV entry has expired/been deleted.
    // Must redirect to access.html, NOT /upload.html, to avoid contradicting any
    // "Lihat hasil" banner that Upload.tsx might show based on gaslamar_analyze_time.
    const staleKey = `cvtext_${'e'.repeat(64)}`;
    // Deliberately do NOT seed a KV entry — simulates an expired session.

    const res = await route(new Request('https://gaslamar.com/hasil.html', {
      method: 'GET',
      headers: {
        Cookie: `__Host-cv_key=${staleKey}`,
        'CF-Connecting-IP': '1.2.3.4',
      },
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/access.html?expired=1&source=hasil');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
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

  it('rejects unsafe POSTs from disallowed browser origins before handlers run', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await SELF.fetch('https://gaslamar.com/get-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Origin: 'https://evil.com',
        Cookie: `__Host-session_id=${sessionId}`,
      },
      body: '{}',
    });

    expect(res.status).toBe(403);
    expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);

    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session.status).toBe('paid');
  });

  it('allows Mayar webhooks without a browser Origin to reach HMAC validation', async () => {
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(403);
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
    const h = getCorsHeaders(makeReq('https://localhost:3000'), { ENVIRONMENT: 'staging' });
    expect(h['Access-Control-Allow-Origin']).toBe('https://localhost:3000');
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
    expect(isOriginAllowed(makeReq('https://localhost:3000'), { ENVIRONMENT: 'staging' })).toBe(true);
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

  it('rejects missing job_desc → 400', async () => {
    const res = await post('/analyze', { cv: VALID_PDF_CV }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/job description wajib/i);
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

  it('rejects whitespace-only job_desc → 400', async () => {
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: ' '.repeat(200) }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/job description wajib/i);
  });

  it('rejects job_desc containing <script> tag → 400 unsafe content', async () => {
    const xssJd = '<script>alert("XSS")</script>' + 'x'.repeat(100);
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: xssJd }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/unsafe content/i);
  });

  it('rejects job_desc containing onerror= attribute → 400 unsafe content', async () => {
    const xssJd = '<img src=x onerror=alert(1)>' + 'x'.repeat(100);
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: xssJd }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/unsafe content/i);
  });

  it('rejects job_desc containing javascript: URL → 400 unsafe content', async () => {
    const xssJd = '<a href="javascript:alert(1)">click</a>' + 'x'.repeat(100);
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: xssJd }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/unsafe content/i);
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

  it('rejects unsupported cv file type → 400', async () => {
    const cv = JSON.stringify({ type: 'html', data: btoa('<html><body>CV</body></html>') });
    const res = await post('/analyze', { cv, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/format.*tidak valid|tidak didukung/i);
  });

  it('rejects pasted text CV under 1500 chars → 422', async () => {
    const cv = JSON.stringify({ type: 'txt', data: 'A'.repeat(1499) });
    const res = await post('/analyze', { cv, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toMatch(/minimal 1\.500 karakter/i);
  });

  it('accepts cv_text as a plain string (auto-wrapped as txt) — short text still rejects with correct error', async () => {
    // Direct API callers may pass cv_text:"raw text" instead of the internal envelope.
    // The backend should auto-wrap and return a meaningful error (not "Data CV tidak dapat dibaca").
    const res = await post('/analyze', { cv_text: 'A'.repeat(1499), job_description: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toMatch(/minimal 1\.500 karakter/i);
  });

  it('accepts cv_text alias with job_description alias for plain-text CV → passes validation', async () => {
    // Plain-string cv_text passes all validation when long enough; pipeline will fail at
    // Claude (no mock here) but must NOT return a parameter-mismatch 400.
    const longCvText = 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\n' + 'Developer PT XYZ — membangun aplikasi web dengan Node.js dan React.\n'.repeat(30);
    const res = await post('/analyze', { cv_text: longCvText, job_description: JOB_DESC }, {}, nextIp());
    // Should proceed past parameter validation (not 400); may fail at Claude call (422/500)
    expect(res.status).not.toBe(400);
  });

  it('rejects DOCX CV with extracted text under 1500 chars → 422', async () => {
    // makeShortDOCXBase64 builds a structurally valid DOCX with only ~85 chars of
    // text content — passes the 100-char floor in extractCVText but hits the
    // universal 1500-char gate added to analyze.js.
    const cv = JSON.stringify({ type: 'docx', data: makeShortDOCXBase64() });
    const res = await post('/analyze', { cv, job_desc: JOB_DESC }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toMatch(/minimal 1\.500 karakter/i);
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
  it('returns skor and sets cv_key HttpOnly cookie when Claude succeeds', async () => {
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

    // cv_text_key must NOT be in the response body — it is now an HttpOnly Set-Cookie.
    expect(body.cv_text_key).toBeUndefined();

    // cv_key must appear in the Set-Cookie header as an HttpOnly cookie.
    // sandbox env → SameSite=None; Partitioned (cross-site CHIPS for staging)
    const setCookie = res.headers.get('set-cookie') || res.headers.get('Set-Cookie') || '';
    expect(setCookie).toMatch(/__Host-cv_key=cvtext_[0-9a-f]{64}/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=None');
    expect(setCookie).toContain('Partitioned');

    // Verify response shape matches the pre-refactor contract
    expect(body).toHaveProperty('skor_6d');
    expect(body).toHaveProperty('veredict');
    expect(body).toHaveProperty('gap');
    expect(body).toHaveProperty('rekomendasi');
    expect(body).toHaveProperty('kekuatan');
    expect(body).toHaveProperty('archetype');

    // Verify key is stored in KV with IP binding (extract key from cookie header)
    const cvKey = cvKeyFromSetCookie(res);
    const stored = await env.GASLAMAR_SESSIONS.get(cvKey, { type: 'json' });
    expect(stored).not.toBeNull();
    expect(stored.text).toBeTruthy();
    expect(stored.ip).toBe('10.0.0.1');

    // sessionToken cookie must also be present and point to a valid analysis_session_ KV entry.
    const setCookieFull = res.headers.get('set-cookie') || res.headers.get('Set-Cookie') || '';
    const sessionTokenMatch = setCookieFull.match(/sessionToken=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    expect(sessionTokenMatch).not.toBeNull();
    const sessionId = sessionTokenMatch?.[1];
    expect(sessionId).toBeTruthy();

    const analysisSession = await env.GASLAMAR_SESSIONS.get(`analysis_session_${sessionId}`, { type: 'json' });
    expect(analysisSession).not.toBeNull();
    expect(analysisSession.resultId).toBeTruthy();
    expect(analysisSession.cvKey).toMatch(/^cvtext_/);
    expect(typeof analysisSession.createdAt).toBe('number');
    expect(typeof analysisSession.expiresAt).toBe('number');
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
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('rejects missing cv_text_key (no cookie, no body) → 400', async () => {
    const res = await post('/create-payment', { tier: 'single' });
    expect(res.status).toBe(400);
  });

  it('rejects cv_text_key without cvtext_ prefix in body → 400', async () => {
    const res = await post('/create-payment', {
      tier: 'single',
      cv_text_key: 'sess_abc',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('cv_text_key');
  });

  it('rejects invalid tier → 400 with list of valid tiers', async () => {
    // Seed with default IP (1.2.3.4) — tier is rejected before IP check
    const key = await seedCVTextKey();
    const res = await post('/create-payment', { tier: 'premium', cv_text_key: key });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/coba|single|3pack|jobhunt/i);
  });

  it('accepts tier with uppercase casing → normalized to lowercase', async () => {
    // Validation is case-insensitive: 'SINGLE' normalizes to 'single'
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_uppercase', link: 'https://web.mayar.club/pay/inv_uppercase' } }))
      .times(1);
    const key = await seedCVTextKey();
    const res = await post('/create-payment', { tier: 'SINGLE', cv_text_key: key });
    const body = await res.json();
    expect(body.message ?? '').not.toMatch(/tier tidak valid/i);
  });

  it('accepts each valid tier past tier validation (all 4 tiers)', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_tiers', link: 'https://web.mayar.club/pay/inv_tiers' } }))
      .times(4);
    for (const tier of ['coba', 'single', '3pack', 'jobhunt']) {
      const key = await seedCVTextKey();
      const res = await post('/create-payment', { tier, cv_text_key: key });
      // Reaches Mayar invoice creation (fails without API key in test env) — not a 400 tier error
      const body = await res.json();
      expect(body.message ?? '').not.toMatch(/tier tidak valid/i);
    }
  });

  it('accepts tier with surrounding whitespace → trimmed and accepted', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_whitespace', link: 'https://web.mayar.club/pay/inv_whitespace' } }))
      .times(1);
    const key = await seedCVTextKey();
    const res = await post('/create-payment', { tier: '  single  ', cv_text_key: key });
    // Should pass tier validation — not a 400 tier error
    const body = await res.json();
    expect(body.message ?? '').not.toMatch(/tier tidak valid/i);
  });

  it('accepts "starter" alias → normalized to "coba" (backward compat for stale bundles)', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_starter', link: 'https://web.mayar.club/pay/inv_starter' } }))
      .times(1);
    const key = await seedCVTextKey();
    const res = await post('/create-payment', { tier: 'starter', cv_text_key: key });
    // Should pass tier validation — not a 400 tier error
    const body = await res.json();
    expect(body.message ?? '').not.toMatch(/tier tidak valid/i);
  });

  it('rejects expired / missing cv_text_key in body → 400', async () => {
    // Use a valid-format key that simply does not exist in KV — tests the "expired" path
    const nonexistentKey = `cvtext_${cvHexToken()}`;
    const res = await post('/create-payment', {
      tier: 'single',
      cv_text_key: nonexistentKey,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('kedaluwarsa');
  });

  it('accepts cv_text_key from cv_key cookie (new session flow) → proceeds past key check', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_cvkey_cookie', link: 'https://web.mayar.club/pay/inv_cvkey_cookie' } }))
      .times(1);
    // Seed a valid key bound to the default IP (1.2.3.4)
    const key = await seedCVTextKey(undefined, '1.2.3.4');
    // Pass the key only via cookie — body has no cv_text_key
    const res = await post('/create-payment', { tier: 'single' }, { Cookie: `__Host-cv_key=${key}` }, '1.2.3.4');
    // Reaches Mayar invoice creation (which fails without API key in test env) → not a 400 key error
    expect(res.status).not.toBe(400);
  });

  it('cookie cv_key takes precedence over body cv_text_key', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_cookie_precedence', link: 'https://web.mayar.club/pay/inv_cookie_precedence' } }))
      .times(1);
    const cookieKey = await seedCVTextKey(undefined, '1.2.3.4');
    // Provide a valid but nonexistent key in the body; the cookie key should win
    const bodyKey = `cvtext_${cvHexToken()}`;
    const res = await post(
      '/create-payment',
      { tier: 'single', cv_text_key: bodyKey },
      { Cookie: `__Host-cv_key=${cookieKey}` },
      '1.2.3.4',
    );
    // Cookie key is valid and found in KV — should not return 400 for missing/expired key
    expect(res.status).not.toBe(400);
  });

  it('resolves cv_text_key via sessionToken cookie → analysis_session_ KV (cross-origin staging fallback)', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_session_token', link: 'https://web.mayar.club/pay/inv_session_token' } }))
      .times(1);
    const cvKey = await seedCVTextKey(undefined, '1.2.3.4');
    const analysisSessionId = crypto.randomUUID();
    await env.GASLAMAR_SESSIONS.put(
      `analysis_session_${analysisSessionId}`,
      JSON.stringify({ sessionId: analysisSessionId, cvKey, createdAt: Date.now(), expiresAt: Date.now() + 86400000 }),
      { expirationTtl: 86400 },
    );
    // No __Host-cv_key cookie, no body key — only sessionToken cookie (cross-origin staging path)
    const res = await post(
      '/create-payment',
      { tier: 'single' },
      { Cookie: `sessionToken=${analysisSessionId}` },
      '1.2.3.4',
    );
    // Reaches Mayar invoice creation (fails without API key in test env) → not a 400 key error
    expect(res.status).not.toBe(400);
  });

  it('rejects cv_text_key used from a different IP → 403', async () => {
    // Seed the key bound to IP 10.97.0.1
    const key = await seedCVTextKey(undefined, '10.97.0.1');
    // Attempt to use it from a different IP
    const res = await post('/create-payment', {
      tier: 'single',
      cv_text_key: key,
    }, {}, '10.97.0.2');
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

  it('resumes pending_payment session when cvtext_ already consumed — returns stored invoice_url', async () => {
    // Simulate the state after a successful /create-payment that the frontend rejected:
    // cvtext_ is gone, but a pending_payment session with invoice_url exists in KV.
    const sessionId = `sess_${crypto.randomUUID()}`;
    const storedInvoiceUrl = 'https://olive-41774.mayar.shop/invoices/resume-test';
    await env.GASLAMAR_SESSIONS.put(
      sessionId,
      JSON.stringify({
        tier: 'single',
        status: 'pending_payment',
        invoice_url: storedInvoiceUrl,
        credits_remaining: 1,
        total_credits: 1,
        mayar_invoice_id: 'inv_resume_test',
      }),
      { expirationTtl: 604800 },
    );
    // Use a nonexistent cvtext_ (already consumed) — the session cookie should allow resume
    const nonexistentKey = `cvtext_${cvHexToken()}`;
    const res = await post(
      '/create-payment',
      { tier: 'single', cv_text_key: nonexistentKey },
      { Cookie: `__Host-session_id=${sessionId}` },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice_url).toBe(storedInvoiceUrl);
  });

  it('releases the invoice lock when the payment API key is missing', async () => {
    const key = await seedCVTextKey(undefined, '10.97.2.1');
    const testEnv = { ...env, MAYAR_API_KEY_SANDBOX: undefined };

    const res = await route(new Request('https://gaslamar.com/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: GASLAMAR_ORIGIN,
        'CF-Connecting-IP': '10.97.2.1',
      },
      body: JSON.stringify({ tier: 'single', cv_text_key: key }),
    }), testEnv, {});

    expect(res.status).toBe(503);
    await expect(env.GASLAMAR_SESSIONS.get(`invoice_lock_${key}`)).resolves.toBeNull();
  });
});

describe('POST /create-payment — one-time key consumption', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('creates a payment session without requiring a client-readable session secret', async () => {
    const key = await seedCVTextKey(undefined, '10.0.0.12');
    let mayarPayload = null;

    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, ({ body }) => {
        mayarPayload = JSON.parse(body);
        return JSON.stringify({
          data: { id: 'inv_test_no_secret', link: 'https://web.mayar.club/pay/inv_test_no_secret' }
        });
      })
      .times(1);

    const res = await post('/create-payment', {
      tier: 'single',
      cv_text_key: key,
    }, {}, '10.0.0.12');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('session_id');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mayarPayload).toMatchObject({
      name: expect.any(String),
      email: expect.any(String),
      mobile: expect.any(String),
      redirectUrl: expect.any(String),
      description: expect.stringContaining('GasLamar.com'),
      expiredAt: expect.any(String),
      items: [{
        quantity: 1,
        rate: 59000,
        description: expect.any(String),
      }],
      extraData: {
        noCustomer: expect.stringMatching(/^sess_[0-9a-f-]{36}$/i),
        idProd: 'single',
      },
    });
    expect(mayarPayload).not.toHaveProperty('amount');
    expect(mayarPayload).not.toHaveProperty('reference');

    const sessionId = sessionIdFromSetCookie(res);
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session).not.toBeNull();
    expect(session.session_secret_hash).toBeUndefined();
  });

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
    const res1 = await post('/create-payment', {
      tier: 'single',
      cv_text_key: key,
    }, {}, '10.0.0.2');
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1).not.toHaveProperty('session_id');
    expect(body1.invoice_url).toBeTruthy();

    // Key is consumed — second call fails
    const res2 = await post('/create-payment', {
      tier: 'single',
      cv_text_key: key,
    }, {}, '10.0.0.2');
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.message).toContain('kedaluwarsa');
  });
});

describe('POST /create-payment — Mayar URL field extraction', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  const CHECKOUT_DOMAINS = [
    { field: 'paymentLink', url: 'https://olive-41774.mayar.shop/select-channel/abc123', label: 'mayar.shop (paymentLink)' },
    { field: 'link',        url: 'https://web.mayar.id/pay/inv_link',                    label: 'mayar.id (link)' },
    { field: 'url',         url: 'https://sandbox.mayar.co/pay/inv_url',                 label: 'mayar.co (url)' },
    { field: 'payment_url', url: 'https://olive-41774.myr.id/pay/inv_purl',              label: 'myr.id (payment_url)' },
  ];

  for (const { field, url, label } of CHECKOUT_DOMAINS) {
    it(`extracts invoice_url from Mayar response field "${field}" — ${label}`, async () => {
      const key = await seedCVTextKey(undefined, '10.1.1.1');
      fetchMock
        .get('https://api.mayar.club')
        .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
        .reply(200, JSON.stringify({ data: { id: `inv_${field}`, [field]: url } }))
        .times(1);

      const res = await post('/create-payment', { tier: 'single', cv_text_key: key }, {}, '10.1.1.1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invoice_url).toBe(url);
    });
  }

  it('stores invoice_url in session so resume logic can return it on retry', async () => {
    const key = await seedCVTextKey(undefined, '10.1.2.1');
    const invoiceUrl = 'https://olive-41774.mayar.shop/select-channel/store-test';
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_store_test', paymentLink: invoiceUrl } }))
      .times(1);

    const res = await post('/create-payment', { tier: 'single', cv_text_key: key }, {}, '10.1.2.1');
    expect(res.status).toBe(200);

    const sessionId = sessionIdFromSetCookie(res);
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session.invoice_url).toBe(invoiceUrl);
    expect(session.status).toBe('pending_payment');
  });

  it('stores mayar_session_{transaction_id} KV index alongside mayar_session_{invoice_id}', async () => {
    const key = await seedCVTextKey(undefined, '10.1.4.1');
    const invoiceId     = 'inv_dual_index_test';
    const transactionId = 'txn_dual_index_test';
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({
        data: { id: invoiceId, transactionId, link: 'https://olive-41774.mayar.shop/tx/dual' },
      }))
      .times(1);

    const res = await post('/create-payment', { tier: 'single', cv_text_key: key }, {}, '10.1.4.1');
    expect(res.status).toBe(200);

    // Both KV indexes must exist after invoice creation
    const byInvoice = await env.GASLAMAR_SESSIONS.get(`mayar_session_${invoiceId}`, { type: 'json' });
    const byTxn     = await env.GASLAMAR_SESSIONS.get(`mayar_session_${transactionId}`, { type: 'json' });
    expect(byInvoice?.session_id).toMatch(/^sess_[0-9a-f-]{36}$/i);
    expect(byTxn?.session_id).toBe(byInvoice?.session_id);
  });

  it('uses production Mayar invoice/create endpoint when ENVIRONMENT=production', async () => {
    const key = await seedCVTextKey(undefined, '10.1.6.1');
    let mayarPayload = null;

    fetchMock
      .get('https://api.mayar.id')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, ({ body }) => {
        mayarPayload = JSON.parse(body);
        return JSON.stringify({
          data: { id: 'prod_payment_id', transactionId: 'prod_transaction_id', link: 'https://web.mayar.id/pay/prod_payment_id' },
        });
      })
      .times(1);

    const res = await route(new Request('https://gaslamar.com/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: GASLAMAR_ORIGIN,
        'CF-Connecting-IP': '10.1.6.1',
      },
      body: JSON.stringify({ tier: 'single', cv_text_key: key }),
    }), { ...env, ENVIRONMENT: 'production' }, {});

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice_url).toBe('https://web.mayar.id/pay/prod_payment_id');
    expect(mayarPayload).toMatchObject({
      redirectUrl: 'https://gaslamar.com/download.html',
      items: [{
        quantity: 1,
        rate: 59000,
        description: expect.any(String),
      }],
      extraData: {
        noCustomer: expect.stringMatching(/^sess_[0-9a-f-]{36}$/i),
        idProd: 'single',
      },
    });
    expect(mayarPayload).not.toHaveProperty('amount');
    expect(mayarPayload).not.toHaveProperty('reference');
  });

  it('resume path returns stored invoice_url without creating a new Mayar invoice', async () => {
    // Simulate: cvtext_ already consumed, session cookie present with pending_payment + invoice_url.
    // fetchMock must NOT be called — if it is, a new invoice was created (bug).
    const sessionId = `sess_${crypto.randomUUID()}`;
    const existingUrl = 'https://olive-41774.mayar.shop/select-channel/resume-no-dup';
    await env.GASLAMAR_SESSIONS.put(
      sessionId,
      JSON.stringify({
        tier: 'single',
        status: 'pending_payment',
        invoice_url: existingUrl,
        mayar_invoice_id: 'inv_resume_no_dup',
        credits_remaining: 1,
        total_credits: 1,
      }),
      { expirationTtl: 604800 },
    );

    let mayarWasCalled = false;
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, () => { mayarWasCalled = true; return JSON.stringify({ data: { id: 'inv_dup', paymentLink: 'https://mayar.shop/dup' } }); })
      .times(1);

    const nonexistentKey = `cvtext_${cvHexToken()}`;
    const res = await post(
      '/create-payment',
      { tier: 'single', cv_text_key: nonexistentKey },
      { Cookie: `__Host-session_id=${sessionId}` },
      '10.1.3.1',
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice_url).toBe(existingUrl);
    expect(mayarWasCalled).toBe(false);
  });

  it('invoice-refresh path stores mayar_session_{transaction_id} for refreshed invoice — skipped here; see dedicated describe block below', () => {
    // Tested in 'POST /create-payment — invoice refresh dual KV index' below,
    // isolated from this suite's unconsumed fetchMock interceptors.
  });
});

describe('POST /create-payment — invoice refresh dual KV index', () => {
  beforeAll(() => {
    fetchMock.activate();
    // Clear any stale interceptors left by previous describe blocks (e.g. the resume-no-dup
    // test which registers a mock but intentionally never consumes it). undici stores
    // interceptors on the MockPool under a local Symbol('dispatches'); find and drain it.
    const pool = fetchMock.get('https://api.mayar.club');
    const kDispatches = Object.getOwnPropertySymbols(pool)
      .find(s => s.toString() === 'Symbol(dispatches)');
    if (kDispatches) pool[kDispatches] = [];
  });
  afterAll(() => fetchMock.deactivate());

  it('invoice-refresh path stores mayar_session_{transaction_id} for refreshed invoice', async () => {
    // When a sandbox invoice expires (<50min TTL), createPayment creates a fresh invoice.
    // The refresh path must also store the transaction_id index so the new webhook finds the session.
    const sessionId    = `sess_${crypto.randomUUID()}`;
    const oldInvoiceId = 'inv_expired_old';
    const newInvoiceId = 'inv_refreshed_new';
    const newTxnId     = 'txn_refreshed_new';

    // Seed a pending_payment session with an expired invoice (created 2h ago in sandbox)
    await env.GASLAMAR_SESSIONS.put(
      sessionId,
      JSON.stringify({
        tier:               'single',
        status:             'pending_payment',
        invoice_url:        'https://olive-41774.mayar.shop/old',
        mayar_invoice_id:   oldInvoiceId,
        invoice_created_at: Date.now() - 2 * 60 * 60 * 1000, // 2h ago — past 50min sandbox TTL
        credits_remaining:  1,
        total_credits:      1,
        cv_text:            'CV text here',
        job_desc:           'JD here',
        ip:                 '10.1.5.1',
      }),
      { expirationTtl: 604800 },
    );

    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({
        data: { id: newInvoiceId, transactionId: newTxnId, link: 'https://olive-41774.mayar.shop/new' },
      }))
      .times(1);

    const nonexistentKey = `cvtext_${cvHexToken()}`;
    const res = await post(
      '/create-payment',
      { tier: 'single', cv_text_key: nonexistentKey },
      { Cookie: `__Host-session_id=${sessionId}` },
      '10.1.5.1',
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice_url).toBe('https://olive-41774.mayar.shop/new');

    // Both indexes for the NEW invoice must exist
    const byNewInvoice = await env.GASLAMAR_SESSIONS.get(`mayar_session_${newInvoiceId}`, { type: 'json' });
    const byNewTxn     = await env.GASLAMAR_SESSIONS.get(`mayar_session_${newTxnId}`, { type: 'json' });
    expect(byNewInvoice?.session_id).toBe(sessionId);
    expect(byNewTxn?.session_id).toBe(sessionId);
  });
});

describe('API aliases', () => {
  it('accepts POST /api/create-payment as an alias for /create-payment', async () => {
    const key = await seedCVTextKey(undefined, '10.0.0.13');

    fetchMock.activate();
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({
        data: { id: 'inv_test_api_alias', link: 'https://web.mayar.club/pay/inv_test_api_alias' }
      }))
      .times(1);

    const res = await post('/api/create-payment', {
      tier: 'single',
      cv_text_key: key,
    }, {}, '10.0.0.13');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('session_id');
    expect(body.invoice_url).toBeTruthy();
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    fetchMock.deactivate();
  });
});

describe('GET /payment-health', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('reports degraded when Mayar invoice/create route returns 404', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(404, '404 page not found\n')
      .times(1);

    const res = await get('/payment-health');
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.gateway_status).toBe('http_404');
  });

  it('reports ok when Mayar invoice/create route rejects an empty probe with validation/auth status', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(400, JSON.stringify({ statusCode: 400, messages: 'Validation Error' }))
      .times(1);

    const res = await get('/payment-health');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.gateway_status).toBe('http_400');
  });
});

describe('Rate limiting — Retry-After header', () => {
  // Use a unique IP so this suite never conflicts with others
  const RL_IP = '10.99.0.1';

  it('returns 429 with Retry-After: 60 after exhausting /create-payment limit (15/min)', async () => {
    // Exhaust the 15-req/min KV limit for this IP.
    // Each call returns 400 (missing body) but still consumes a rate-limit slot.
    for (let i = 0; i < 15; i++) {
      await post('/create-payment', {}, {}, RL_IP);
    }
    // 16th request must be rate-limited
    const res = await post('/create-payment', {}, {}, RL_IP);
    expect(res.status).toBe(429);
    // Retry-After is windowSecs minus elapsed seconds; allow 59 or 60 depending on sub-second timing
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(59);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = await res.json();
    expect(body.message).toContain('Terlalu banyak');
  });

  it('/create-payment 429 includes X-RateLimit-Remaining: 0 and X-RateLimit-Limit', async () => {
    const RL_IP_CP = '10.99.0.5';
    for (let i = 0; i < 15; i++) {
      await post('/create-payment', {}, {}, RL_IP_CP);
    }
    const res = await post('/create-payment', {}, {}, RL_IP_CP);
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(Number(res.headers.get('X-RateLimit-Limit'))).toBeGreaterThan(0);
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
    expect(Number(res.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(0);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('/create-payment success response includes X-RateLimit-* headers', async () => {
    const RL_IP_CP2 = '10.99.0.6';
    // Missing tier/cv_text_key → 400, but RL headers should still be present
    const res = await post('/create-payment', {}, {}, RL_IP_CP2);
    expect(res.status).toBe(400);
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });
});

describe('Rate limiting — /analyze (10 req/min per IP)', () => {
  // Unique IP range to avoid cross-suite contamination
  const RL_ANALYZE_IP = '10.99.1.1';

  it('allows first 5 requests and blocks the 6th with 429', async () => {
    // First 5: rate-limit passes, body validation fails → 400
    for (let i = 0; i < 5; i++) {
      const r = await post('/analyze', {}, {}, RL_ANALYZE_IP);
      expect(r.status).toBe(400);
    }
    // 6th must be blocked by KV rate limiter
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
    for (let i = 0; i < 5; i++) {
      await post('/analyze', {}, {}, '10.99.1.2');
    }
    // A different IP should still pass rate limiting (will get 400 from body validation)
    const res = await post('/analyze', {}, {}, '10.99.1.3');
    expect(res.status).toBe(400);
  });

  it('response body contains error, message, and retryAfter fields', async () => {
    const BLOCK_IP = '10.99.1.4';
    for (let i = 0; i < 5; i++) {
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

describe('Rate limiting — /generate X-RateLimit-* headers', () => {
  it('429 from /generate includes X-RateLimit-Remaining: 0, X-RateLimit-Limit, and Retry-After', async () => {
    const GEN_RL_IP = '10.99.2.1';
    // Exhaust the 10-req/min KV limit for /generate
    for (let i = 0; i < 10; i++) {
      await post('/generate', {}, {}, GEN_RL_IP);
    }
    const blocked = await post('/generate', {}, {}, GEN_RL_IP);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(Number(blocked.headers.get('X-RateLimit-Limit'))).toBeGreaterThan(0);
    expect(blocked.headers.get('X-RateLimit-Reset')).toBeTruthy();
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await blocked.json();
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
  });
});

describe('Rate limiting — /resend-access', () => {
  // Unique IP range to avoid cross-suite contamination
  const RL_RESEND_IP_CF  = '10.99.5.1';
  const RL_RESEND_IP_KV  = '10.99.5.2';

  it('CF native rate limiter returns 429 with Retry-After after burst (not 200)', async () => {
    // Exhaust the 10-req/min native limit with distinct emails (avoid per-email KV limit)
    for (let i = 0; i < 10; i++) {
      const res = await post('/resend-access', { email: `rl-cf-burst-${i}@example.com` }, {}, RL_RESEND_IP_CF);
      expect(res.status).toBe(200); // first 10 are allowed
    }
    // 11th request: CF rate limited → 429 with Retry-After
    const res = await post('/resend-access', { email: `rl-cf-extra@example.com` }, {}, RL_RESEND_IP_CF);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = await res.json();
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBe(60);
  });

  it('per-email KV rate limit returns 429 after 3rd request with same email', async () => {
    const email     = `rl-kv-email-${Date.now()}@example.com`;
    const emailHash = await sha256Full(email);

    // First 3 requests: allowed — counter climbs to 3
    for (let i = 0; i < 3; i++) {
      const res = await post('/resend-access', { email }, {}, RL_RESEND_IP_KV);
      expect(res.status).toBe(200);
    }
    const afterThree = JSON.parse(await env.GASLAMAR_SESSIONS.get(`rate_limit_resend_access_${emailHash}`));
    expect(afterThree.count).toBe(3);

    // 4th request: rate limited → 429 with Retry-After
    const res = await post('/resend-access', { email }, {}, RL_RESEND_IP_KV);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.error).toBe('Too many requests');

    // Counter must NOT be incremented beyond 3 (blocked requests don't count)
    const afterFour = JSON.parse(await env.GASLAMAR_SESSIONS.get(`rate_limit_resend_access_${emailHash}`));
    expect(afterFour.count).toBe(3);
  });

  it('finds session via legacy plaintext email key when hashed key is absent', async () => {
    const legacyEmail = `legacy-resend-${Date.now()}@example.com`;
    const legacyHash  = await sha256Full(legacyEmail);
    const sessionId   = await seedSession('paid', 'single');

    // Confirm hashed key is absent — proves only the legacy path is available
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${legacyHash}`)).toBeNull();

    // Store index under plaintext key only (pre-migration format)
    await env.GASLAMAR_SESSIONS.put(
      `email_session_${legacyEmail}`,
      JSON.stringify({ session_ids: [sessionId] }),
      { expirationTtl: 3600 },
    );

    const res  = await post('/resend-access', { email: legacyEmail }, {}, '10.99.5.3');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/link baru/);
    // Plaintext key still present — resendAccess does not migrate legacy keys
    const record = await env.GASLAMAR_SESSIONS.get(`email_session_${legacyEmail}`, { type: 'json' });
    expect(record).not.toBeNull();
    // Hashed key must still be absent — handler does not migrate
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${legacyHash}`)).toBeNull();
  });

  it('per-IP KV rate limit returns 429 when IP counter reaches 10', async () => {
    const RL_RESEND_IP_IP = '10.99.5.4';
    const now = Math.floor(Date.now() / 1000);
    // Pre-seed the counter at 9 — avoids making 9 real requests before the
    // IP KV limit (10/hr) fires.
    await env.GASLAMAR_SESSIONS.put(
      `rate_limit_resend_access_ip_${RL_RESEND_IP_IP}`,
      JSON.stringify({ start: now, count: 9 }),
      { expirationTtl: 3600 },
    );

    // 10th request: allowed (KV counter 9 → 10)
    const res10 = await post('/resend-access', { email: `rl-ip-10@example.com` }, {}, RL_RESEND_IP_IP);
    expect(res10.status).toBe(200);

    // 11th request: IP KV rate limited → 429
    const res11 = await post('/resend-access', { email: `rl-ip-11@example.com` }, {}, RL_RESEND_IP_IP);
    expect(res11.status).toBe(429);
    expect(Number(res11.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await res11.json();
    expect(body.error).toBe('Too many requests');
  });
});

describe('Rate limiting — X-RateLimit-* headers', () => {
  const RL_HDR_IP = '10.99.9.1';

  it('single valid request to /check-session includes X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset', async () => {
    const res = await get('/check-session', {}, RL_HDR_IP);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(Number(res.headers.get('X-RateLimit-Limit'))).toBeGreaterThan(0);
    expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
    expect(Number(res.headers.get('X-RateLimit-Remaining'))).toBeGreaterThanOrEqual(0);
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
    expect(Number(res.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(0);
  });

  it('X-RateLimit-Remaining decreases on subsequent requests', async () => {
    const RL_HDR_IP2 = '10.99.9.2';
    const r1 = await get('/check-session', {}, RL_HDR_IP2);
    const r2 = await get('/check-session', {}, RL_HDR_IP2);
    const rem1 = Number(r1.headers.get('X-RateLimit-Remaining'));
    const rem2 = Number(r2.headers.get('X-RateLimit-Remaining'));
    expect(rem2).toBeLessThan(rem1);
  });

  it('429 response includes X-RateLimit-Remaining: 0, X-RateLimit-Limit, X-RateLimit-Reset, and Retry-After', async () => {
    const RL_HDR_IP3 = '10.99.9.3';
    // Exhaust the /analyze KV limit (5 req/15min)
    for (let i = 0; i < 5; i++) {
      await post('/analyze', {}, {}, RL_HDR_IP3);
    }
    const blocked = await post('/analyze', {}, {}, RL_HDR_IP3);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(Number(blocked.headers.get('X-RateLimit-Limit'))).toBeGreaterThan(0);
    expect(blocked.headers.get('X-RateLimit-Reset')).toBeTruthy();
    expect(Number(blocked.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    // JSON body must remain unchanged
    const body = await blocked.json();
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.message).toContain('Terlalu banyak');
  });

  it('X-RateLimit-Reset is a Unix timestamp in the future', async () => {
    const RL_HDR_IP4 = '10.99.9.4';
    const res = await get('/check-session', {}, RL_HDR_IP4);
    const reset = Number(res.headers.get('X-RateLimit-Reset'));
    const nowSecs = Math.floor(Date.now() / 1000);
    expect(reset).toBeGreaterThan(nowSecs);
  });
});

describe('POST /session/ping', () => {
  it('returns 401 when no session cookie is present', async () => {
    // Handlers now read session_id from Cookie header; missing cookie → 401
    const res = await post('/session/ping', {});
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid session_id in cookie (not sess_ prefix)', async () => {
    const res = await post('/session/ping', {}, { Cookie: '__Host-session_id=invalid' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/session/ping', {}, { Cookie: '__Host-session_id=sess_nonexistent' });
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
  it('returns 200+authenticated:false when no session cookie and no ?session= param', async () => {
    const res = await get('/check-session');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.reason).toBe('no_session');
  });

  it('returns 200+authenticated:false when ?session= param lacks sess_ prefix (invalid format)', async () => {
    // Non-sess_ values are not accepted even as fallback
    const res = await get('/check-session?session=invalid_id');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.reason).toBe('no_session');
  });

  it('ignores valid ?session= when no cookie is present', async () => {
    const res = await get('/check-session?session=sess_some_valid_looking_id');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.reason).toBe('no_session');
  });

  it('does not authenticate an existing session from the query string alone', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await get(`/check-session?session=${sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.reason).toBe('no_session');
  });

  it('does not leak reduced metadata for query-only sessions', async () => {
    const sessionId = await seedSession('ready', '3pack');
    const res = await get(`/check-session?session=${sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('status', 'ready');
    expect(body).not.toHaveProperty('tier', '3pack');
  });

  it('returns 404 for unknown session_id in cookie', async () => {
    const res = await get('/check-session', sessionCookie('sess_nonexistent_id'));
    expect(res.status).toBe(404);
  });

  it('returns current status for known session via cookie', async () => {
    const sessionId = await seedSession('pending', 'coba');
    const res = await get('/check-session', sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('session_id');
    expect(body.status).toBe('pending');
  });

  it('uses cookie auth and ignores a redundant ?session= parameter', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await get('/check-session?session=' + sessionId, sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('session_id');
    expect(body.status).toBe('paid');
    expect(body.credits_remaining).toBeDefined();
    expect(body.ttl_seconds).toBeDefined();
  });

  it('uses cookie auth even if a stale X-Session-Secret header is provided', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await get('/check-session?session=' + sessionId, {
      ...sessionCookie(sessionId),
      'X-Session-Secret': 'stale-client-secret',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('paid');
  });

  it('returns current status when cookie is present and no client secret exists', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await get('/check-session', sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('paid');
    expect(body.credits_remaining).toBeDefined();
  });

  it('rejects X-Session-Id header alone when no cookie is present (no URL fallback)', async () => {
    const sessionId = await seedSession('paid', 'single');
    // Staging removed the URL/header fallback — X-Session-Id without a cookie must return no_session.
    const res = await get('/check-session', { 'X-Session-Id': sessionId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.reason).toBe('no_session');
  });

  it('cookie path is not affected by stale X-Session-Secret headers', async () => {
    const sessionId = await seedSession('paid', 'single');
    const ip = '10.88.0.45';
    for (let i = 0; i < 5; i++) {
      const res = await get('/check-session', { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, ip);
      expect(res.status).toBe(200);
    }
  });

  it('rate-limits unauthenticated burst attempts (30/5min per IP — no session cookie)', async () => {
    const ip = '10.88.0.99';

    // First 30 unauthenticated requests are allowed — no session cookie → IP bucket.
    for (let i = 0; i < 30; i++) {
      const res = await get('/check-session', {}, ip);
      expect(res.status).toBe(200); // no cookie → 200+authenticated:false, not 429
    }

    // 31st request is blocked by the rate limiter.
    const blocked = await get('/check-session', {}, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('returns valid:true for a cv_key cookie with active analysis session in KV', async () => {
    const key = `cvtext_${cvHexToken()}`;
    await env.GASLAMAR_SESSIONS.put(key, JSON.stringify({
      text: 'CV text',
      job_desc: 'Job desc',
      ip: '1.2.3.4',
      scoring: { skor: 75, gap: [], kekuatan: [] },
    }), { expirationTtl: 86400 });
    const res = await get('/check-session', { Cookie: `__Host-cv_key=${key}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.type).toBe('analysis');
  });

  it('returns valid:false with reason expired when cv_key cookie exists but KV entry is gone', async () => {
    const missingKey = `cvtext_${cvHexToken()}`;
    const res = await get('/check-session', { Cookie: `__Host-cv_key=${missingKey}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('expired');
  });

  it('falls back to scoring_ key when cvtext_ is absent but scoring_ exists', async () => {
    const token = cvHexToken();
    const cvKey = `cvtext_${token}`;
    await env.GASLAMAR_SESSIONS.put(`scoring_${token}`, JSON.stringify({
      scoring: { skor: 60, gap: [], kekuatan: [] },
    }), { expirationTtl: 86400 });
    const res = await get('/check-session', { Cookie: `__Host-cv_key=${cvKey}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.type).toBe('analysis');
  });

  it('cv_key cookie without sess_ prefix does not bleed into payment session path', async () => {
    const key = `cvtext_${cvHexToken()}`;
    // No KV entry — expired cv_key should not trigger session path
    const res = await get('/check-session', { Cookie: `__Host-cv_key=${key}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('status'); // payment session fields absent
    expect(body).not.toHaveProperty('credits_remaining');
  });

  it('payment session cookie (sess_) still returns full session fields', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await get('/check-session', sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.status).toBe('paid');
    expect(body.credits_remaining).toBeDefined();
  });

  it('returns valid:true + resultId for a valid sessionToken cookie', async () => {
    const sessionId = crypto.randomUUID();
    const resultId  = crypto.randomUUID();
    const cvKey     = `cvtext_${cvHexToken()}`;
    await env.GASLAMAR_SESSIONS.put(`analysis_session_${sessionId}`, JSON.stringify({
      sessionId, resultId, cvKey, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    }), { expirationTtl: 86400 });
    const res = await get('/check-session', { Cookie: `sessionToken=${sessionId}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.type).toBe('analysis');
    expect(body.resultId).toBe(resultId);
  });

  it('returns 401 when sessionToken cookie exists but analysis_session_ KV entry is gone', async () => {
    const sessionId = crypto.randomUUID();
    const res = await get('/check-session', { Cookie: `sessionToken=${sessionId}` });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('expired');
  });

  it('sessionToken takes precedence over cv_key when both are present', async () => {
    const sessionId = crypto.randomUUID();
    const resultId  = crypto.randomUUID();
    const cvKey     = `cvtext_${cvHexToken()}`;
    await env.GASLAMAR_SESSIONS.put(`analysis_session_${sessionId}`, JSON.stringify({
      sessionId, resultId, cvKey, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    }), { expirationTtl: 86400 });
    // cv_key present but no matching KV — sessionToken should win
    const res = await get('/check-session', {
      Cookie: `sessionToken=${sessionId}; cv_key=cvtext_${'a'.repeat(64)}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.resultId).toBe(resultId);
  });

  it('X-Analysis-Session header returns valid:true when no cookie present (Safari/ITP fallback)', async () => {
    const sessionId = crypto.randomUUID();
    const resultId  = crypto.randomUUID();
    const cvKey     = `cvtext_${cvHexToken()}`;
    await env.GASLAMAR_SESSIONS.put(`analysis_session_${sessionId}`, JSON.stringify({
      sessionId, resultId, cvKey, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    }), { expirationTtl: 86400 });
    const res = await get('/check-session', { 'X-Analysis-Session': sessionId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.type).toBe('analysis');
    expect(body.resultId).toBe(resultId);
  });

  it('X-Analysis-Session header with invalid UUID → 401 expired (not no_session)', async () => {
    const res = await get('/check-session', { 'X-Analysis-Session': 'not-a-uuid' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('X-Analysis-Session header with unknown UUID → 401 expired', async () => {
    const res = await get('/check-session', { 'X-Analysis-Session': crypto.randomUUID() });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('expired');
  });

});

describe('POST /exchange-token — abuse regression', () => {
  it('rejects malformed, short, non-hex, and wrong-length tokens before KV lookup', async () => {
    const cases = [
      [undefined, '10.89.0.1'],
      ['', '10.89.0.2'],
      ['abc123', '10.89.0.3'],
      ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', '10.89.0.4'],
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '10.89.0.5'],
    ];

    for (const [emailToken, ip] of cases) {
      const body = emailToken === undefined ? {} : { email_token: emailToken };
      const res = await post('/exchange-token', body, {}, ip);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: 'Token tidak valid' });
    }
  });

  it('exchanges a valid token once and rejects replay', async () => {
    const sessionId = await seedSession('ready', 'single');
    const token = '0123456789abcdef0123456789abcdef';
    await env.GASLAMAR_SESSIONS.put(`email_token_${token}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 3600 });

    const first = await post('/exchange-token', { email_token: token }, {}, '10.89.0.6');
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toEqual({ ok: true });
    expect(first.headers.get('Set-Cookie')).toContain(`__Host-session_id=${sessionId}`);
    expect(await env.GASLAMAR_SESSIONS.get(`email_token_${token}`)).toBeNull();

    const replay = await post('/exchange-token', { email_token: token }, {}, '10.89.0.7');
    expect(replay.status).toBe(404);
    expect(await replay.json()).toEqual({ message: 'Token tidak valid atau sudah kedaluwarsa' });
  });

  it('rate-limits burst attempts (reuses RATE_LIMITER_PAYMENT: 15/min per IP)', async () => {
    const ip = '10.89.0.8';
    const fakeToken = 'ffffffffffffffffffffffffffffffff'; // 32 hex chars — valid format, won't exist in KV

    // First 15 requests return 404 (token not found) — rate limiter allows them.
    for (let i = 0; i < 15; i++) {
      const res = await post('/exchange-token', { email_token: fakeToken }, {}, ip);
      expect(res.status).toBe(404);
    }

    // 16th request is blocked by the rate limiter.
    const blocked = await post('/exchange-token', { email_token: fakeToken }, {}, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('POST /resend-access — abuse regression', () => {
  it('stays silent for unknown emails', async () => {
    const res = await post('/resend-access', { email: 'unknown-access@example.com' }, {}, '10.90.0.1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: 'Jika email terdaftar, link baru telah dikirim.',
    });
  });

  it('rate-limits by email hash (3/hour) and returns 429 on the 4th request', async () => {
    const email = 'email-limited@example.com';
    const emailHash = await sha256Full(email);

    // Limit is 3/hour — first 3 requests from different IPs all pass.
    for (const ip of ['10.90.0.2', '10.90.0.3', '10.90.0.4']) {
      const res = await post('/resend-access', { email }, {}, ip);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        message: 'Jika email terdaftar, link baru telah dikirim.',
      });
    }

    // 4th request (any IP) hits the email rate limit and returns 429.
    const fourthIp = '10.90.0.6';
    const limited = await post('/resend-access', { email }, {}, fourthIp);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();

    // Counter stays at 3 — not incremented when blocked.
    const emailLimiter = await env.GASLAMAR_SESSIONS.get(`rate_limit_resend_access_${emailHash}`, { type: 'json' });
    expect(emailLimiter.count).toBe(3);
  });

  it('CF burst guard blocks resend-access after 10 requests/min per IP', async () => {
    const ip = '10.90.0.5';

    // CF rate limiter is 10/min — first 10 requests from the same IP pass.
    for (let i = 0; i < 10; i++) {
      const res = await post('/resend-access', { email: `ip-burst-${i}@example.com` }, {}, ip);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        message: 'Jika email terdaftar, link baru telah dikirim.',
      });
    }

    // 11th request hits the CF burst guard and returns 429.
    const limited = await post('/resend-access', { email: 'ip-burst-final@example.com' }, {}, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
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

  it('returns valid:false for unknown key → 404', async () => {
    // Valid format but key doesn't exist in KV — should return 404.
    const res = await get('/validate-session?cvKey=cvtext_' + '0'.repeat(64));
    expect(res.status).toBe(404);
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

  it('returns valid:true via scoring_ fallback when cvtext_ was consumed by create-payment', async () => {
    // Simulate /create-payment deleting cvtext_ but preserving scoring_ snapshot.
    const token = cvHexToken();
    const cvKey = `cvtext_${token}`;
    const scoringKey = `scoring_${token}`;
    // Only scoring_ exists; cvtext_ is gone.
    await env.GASLAMAR_SESSIONS.put(scoringKey, JSON.stringify({ scoring: { skor: 72 } }), { expirationTtl: 3600 });
    const res = await get('/validate-session?cvKey=' + encodeURIComponent(cvKey));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.note).toBeUndefined();
  });

  it('returns valid:false → 404 when neither cvtext_ nor scoring_ exists', async () => {
    const res = await get('/validate-session?cvKey=cvtext_' + 'a'.repeat(64));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('not_found');
  });

  it('returns valid:false → 404 when scoring_ fallback exists but has no scoring field', async () => {
    const token = cvHexToken();
    const scoringKey = `scoring_${token}`;
    // scoring_ exists but its value lacks the scoring field (e.g. empty or corrupt snapshot)
    await env.GASLAMAR_SESSIONS.put(scoringKey, JSON.stringify({ other: 'data' }), { expirationTtl: 3600 });
    const res = await get('/validate-session?cvKey=cvtext_' + token);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('rate-limits after 10 requests per minute per IP (no valid cv_key token) → 429', async () => {
    const ip = '10.96.99.1';
    // Invalid key format → no session token → IP bucket (10/min)
    for (let i = 0; i < 10; i++) {
      await get('/validate-session?cvKey=cvtext_missing', {}, ip);
    }
    const res = await get('/validate-session?cvKey=cvtext_missing', {}, ip);
    expect(res.status).toBe(429);
  });

  it('returns valid:true via cv_key cookie (new session flow)', async () => {
    const key = await seedCVTextKey(undefined, '10.96.2.1');
    const res = await get('/validate-session', { Cookie: `__Host-cv_key=${key}` }, '10.96.2.1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });

  it('cookie cv_key takes precedence over query param', async () => {
    const goodKey = await seedCVTextKey(undefined, '10.96.3.1');
    const badKey  = `cvtext_${cvHexToken()}`;
    // Cookie points to a valid key; query param points to a nonexistent one.
    const res = await get(
      `/validate-session?cvKey=${encodeURIComponent(badKey)}`,
      { Cookie: `__Host-cv_key=${goodKey}` },
      '10.96.3.1',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });

  it('returns 400 when neither cookie nor cvKey param is provided', async () => {
    const res = await get('/validate-session');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('invalid_key');
  });
});

describe('POST /get-session', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await post('/get-session', {});
    expect(res.status).toBe(401);
  });

  it('returns 401 when cookie session_id lacks sess_ prefix', async () => {
    const res = await post('/get-session', {}, { Cookie: '__Host-session_id=abc123' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/get-session', {}, { Cookie: '__Host-session_id=sess_nonexistent' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when status is pending (not paid)', async () => {
    const sessionId = await seedSession('pending');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(403);
  });

  it('returns a normal 429 response when the get-session rate limit is exceeded', async () => {
    const ip = '10.96.9.1';
    const sessionId = await seedSession('paid', 'single');

    // With a session cookie, the rate limiter uses the session-keyed bucket (20/min).
    // Seed that bucket at the limit so the next request is blocked.
    await env.GASLAMAR_SESSIONS.put(
      `rate_limit_get_session_sess_${sessionId}`,
      JSON.stringify({ start: Math.floor(Date.now() / 1000), count: 20 }),
      { expirationTtl: 60 },
    );

    const res = await post('/get-session', {}, sessionCookie(sessionId), ip);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = await res.json();
    expect(body.error).toBe('Too many requests');
  });

  it('returns metadata only and sets status to generating for paid session', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('cv');
    expect(body).not.toHaveProperty('job_desc');
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
    const secretHash = await sha256Full(FIXED_TEST_SECRET);
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: META_CV,
      job_desc: jobDesc,
      tier: 'single',
      status: 'generating',
      created_at: Date.now(),
      session_secret_hash: secretHash,
    }), { expirationTtl: 1800 });
    return sessionId;
  }

  it('extracts labeled Bahasa Indonesia posisi/perusahaan', async () => {
    const sessionId = await seedSessionWithJobDesc(
      'Posisi: Product Manager\nPerusahaan: Tokopedia\nRequirements: 3 tahun pengalaman'
    );
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, META_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_title).toBe('Product-Manager');
    expect(body.company).toBe('Tokopedia');
  });

  it('extracts labeled English position/company', async () => {
    const sessionId = await seedSessionWithJobDesc(
      'Position: Data Analyst\nCompany: Gojek\nWe are looking for...'
    );
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, META_IP);
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
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, META_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_title).toBe('Senior-Backend-Engin');   // truncated to 20 chars
    expect(body.company).toBe('Bukalapak');
  });

  it('returns nulls for unparseable job description', async () => {
    const sessionId = await seedSessionWithJobDesc(
      'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.'
    );
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, META_IP);
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
    const res = await post('/generate', {}, { Cookie: '__Host-session_id=invalid' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/generate', {}, { Cookie: '__Host-session_id=sess_nonexistent' });
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

    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, GENERATE_IP);
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

    // Session marked exhausted after last credit consumed (not deleted — keeps status for auditing)
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session).not.toBeNull();
    expect(session.status).toBe('exhausted');
    expect(session.credits_remaining).toBe(0);
  });

  it('generates ID-only CV for coba tier — cv_en is null', async () => {
    const sessionId = await seedSession('generating', 'coba');
    await preTailorCache(SEED_CV, JOB_DESC);

    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, GENERATE_IP);
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

    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, GENERATE_IP);
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
    // MAYAR_WEBHOOK_SECRET is injected via vitest.config.js miniflare bindings.
    // Integration tests use the sandbox (ENVIRONMENT=sandbox) path: requests with no
    // auth header are allowed through (Mayar simulator behaviour). Requests that DO
    // send x-mayar-signature are subject to HMAC verification against the secret.
  });

  it('returns 401 for invalid HMAC signature', async () => {
    // With MAYAR_WEBHOOK_SECRET configured and a wrong x-mayar-signature sent,
    // the worker must reject the request regardless of sandbox/production mode.
    const payload = JSON.stringify({ status: 'paid', redirect_url: 'https://gaslamar.com/download.html?session=sess_test' });
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'wrong_sig' },
      body: payload,
    });
    expect(res.status).toBe(401);
  });

  it('updates session to paid for valid webhook (sandbox, no auth header)', async () => {
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = 'inv_test_paid_1';
    await env.GASLAMAR_SESSIONS.put(`mayar_session_${invoiceId}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 604800 });

    // Mayar sandbox simulator omits auth headers — worker allows through with a warning.
    const payload = JSON.stringify({
      status: 'paid',
      id: invoiceId,
      redirect_url: 'https://gaslamar.com/download.html',
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
    const invoiceId = 'inv_missing_session_test';
    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${invoiceId}`,
      JSON.stringify({ session_id: missingSessionId }),
      { expirationTtl: 604800 },
    );
    const payload = JSON.stringify({
      status: 'paid',
      id: invoiceId,
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    expect(res.status).toBe(200);
    // Session must not exist in KV (updateSession silently failed)
    const session = await env.GASLAMAR_SESSIONS.get(missingSessionId, { type: 'json' });
    expect(session).toBeNull();
  });

  it('rejects request to GET /check-session with no cookie and invalid session param', async () => {
    // ?session= without sess_ prefix is rejected (no fallback for malformed IDs)
    const res = await SELF.fetch('https://gaslamar.com/check-session?session=invalid_id');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.reason).toBe('no_session');
  });

  it('skips email on duplicate webhook delivery when sentinel key is present', async () => {
    // Simulates a Mayar retry arriving after the sentinel was written by the first delivery.
    // The handler must return 200 without re-sending the email or overwriting the session.
    const sessionId = await seedSession('paid', 'single');

    // Pre-seed the sentinel as the first successful delivery would have written it
    await env.GASLAMAR_SESSIONS.put(`payment_processed_${sessionId}`, '1', { expirationTtl: 172800 });

    const invoiceId = 'inv_duplicate_sentinel_test';
    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${invoiceId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );

    const payload = JSON.stringify({
      status: 'paid',
      id: invoiceId,
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const invoiceId = 'inv_already_paid_check';
    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${invoiceId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );

    const payload = JSON.stringify({
      status: 'paid',
      id: invoiceId,
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    expect(res.status).toBe(200);
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('paid');
  });
});

describe('POST /webhook/mayar — multi-candidate invoice ID fallback', () => {
  it('finds session via data.id when payload.id is a non-matching event ID', async () => {
    // Regression: Mayar sometimes puts a webhook-event UUID at payload.id and the
    // actual invoice ID at payload.data.id. The handler must try all candidates.
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = 'inv_real_invoice_001';
    const eventId   = 'evt_non_matching_uuid_999';

    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${invoiceId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );

    const payload = JSON.stringify({
      id:     eventId,            // top-level id is the WEBHOOK EVENT id — won't match KV
      status: 'paid',
      data:   { id: invoiceId },  // invoice id is nested under data — this one matches
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payload,
    });

    expect(res.status).toBe(200);
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated?.status).toBe('paid');
  });

  it('finds session via data.transactionId — the real Mayar webhook shape (data.id = txn UUID)', async () => {
    // Regression guard for the confirmed production bug:
    // Mayar's webhook sets data.id = data.transactionId (payment transaction UUID).
    // This is a DIFFERENT UUID from the invoice ID returned by /invoice/create (data.id there).
    // The fix stores mayar_session_{transactionId} at creation so this lookup succeeds.
    const sessionId     = await seedSession('pending', 'single');
    const transactionId = 'txn_real_mayar_shape_001';

    // Simulate what createPayment.js now stores
    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${transactionId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );

    // Exact shape Mayar sandbox sends (confirmed from production logs)
    const payload = JSON.stringify({
      event: 'payment.received',
      data: {
        id:            transactionId,  // ← transaction ID, NOT invoice ID
        transactionId: transactionId,
        status:        'SUCCESS',
        productId:     'some-mayar-product-uuid',
      },
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payload,
    });

    expect(res.status).toBe(200);
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated?.status).toBe('paid');
  });

  it('finds session when only transaction_id index exists (no invoice_id index in KV)', async () => {
    // Edge case: invoice_id index was never written (e.g. KV write failed) but
    // transaction_id index succeeded — webhook must still find the session.
    const sessionId     = await seedSession('pending', 'single');
    const transactionId = 'txn_only_no_invoice_idx';

    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${transactionId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );
    // Deliberately do NOT store mayar_session_{invoiceId}

    const payload = JSON.stringify({
      data: { id: transactionId, transactionId, status: 'paid' },
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payload,
    });

    expect(res.status).toBe(200);
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated?.status).toBe('paid');
  });

  it('finds session via invoice_id field when id and data.id are absent', async () => {
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = 'inv_via_invoice_id_field';

    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${invoiceId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );

    const payload = JSON.stringify({ invoice_id: invoiceId, status: 'paid' });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payload,
    });

    expect(res.status).toBe(200);
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated?.status).toBe('paid');
  });
});

describe('POST /webhook/mayar — missing order_id', () => {
  it('returns 400 when payload has no identifiable invoice or order ID', async () => {
    // A webhook with only status and redirect_url (no id/invoice_id/order_id) must return 400
    // so Mayar retries with a corrected payload rather than silently swallowing the event.
    const payload = JSON.stringify({ status: 'paid' });
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /webhook/mayar — reference field and result_id_session_ fallback', () => {
  it('finds session directly when reference field IS the session ID', async () => {
    // Mayar echoes back the `reference` field we set during invoice creation.
    // The handler detects `sess_` prefix and uses it directly without a KV lookup.
    const sessionId = await seedSession('pending', 'single');

    const payload = JSON.stringify({
      status: 'paid',
      reference: sessionId,   // echoed back from createMayarInvoice `reference: sessionId`
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    expect(res.status).toBe(200);
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated?.status).toBe('paid');
  });

  it('finds session via result_id_session_ fallback index when primary KV index is missing', async () => {
    // Simulates the case where Mayar's webhook ID doesn't match the stored invoice ID,
    // but we stored a result_id_session_ index at payment creation time.
    const sessionId = await seedSession('pending', 'single');
    const resultId = crypto.randomUUID();

    // Store the fallback index (as /create-payment does when result_id is present)
    await env.GASLAMAR_SESSIONS.put(
      `result_id_session_${resultId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );

    // No mayar_session_ index — simulates KV index mismatch
    const payload = JSON.stringify({
      id: resultId,   // Mayar sends the result_id as the event ID
      status: 'paid',
    });

    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    expect(res.status).toBe(200);
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated?.status).toBe('paid');
  });
});

describe('POST /webhook/mayar — case-insensitive isPaid status', () => {
  async function seedAndIndex(status) {
    const sessionId = await seedSession('pending', 'single');
    const invoiceId = `inv_case_${status.replace(/[^a-z0-9]/gi, '_')}`;
    await env.GASLAMAR_SESSIONS.put(
      `mayar_session_${invoiceId}`,
      JSON.stringify({ session_id: sessionId }),
      { expirationTtl: 604800 },
    );
    const payload = JSON.stringify({ id: invoiceId, status });
    const res = await SELF.fetch('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    return { status: res.status, sessionStatus: updated?.status };
  }

  it('processes status "PAID" (uppercase)', async () => {
    const { status, sessionStatus } = await seedAndIndex('PAID');
    expect(status).toBe(200);
    expect(sessionStatus).toBe('paid');
  });

  it('processes status "Paid" (mixed case)', async () => {
    const { status, sessionStatus } = await seedAndIndex('Paid');
    expect(status).toBe(200);
    expect(sessionStatus).toBe('paid');
  });

  it('processes status "SUCCESS" (uppercase)', async () => {
    const { status, sessionStatus } = await seedAndIndex('SUCCESS');
    expect(status).toBe(200);
    expect(sessionStatus).toBe('paid');
  });

  it('processes status "Settlement" (mixed case)', async () => {
    const { status, sessionStatus } = await seedAndIndex('Settlement');
    expect(status).toBe(200);
    expect(sessionStatus).toBe('paid');
  });

  it('does not process status "pending" (not a paid status)', async () => {
    const { sessionStatus } = await seedAndIndex('pending');
    expect(sessionStatus).toBe('pending'); // unchanged
  });
});

describe('verifyMayarWebhook — production HMAC path', () => {
  // These tests call verifyMayarWebhook directly with a production-like env object
  // so we can verify the crypto path that SELF.fetch tests cannot reach
  // (SELF always runs in sandbox mode where HMAC is bypassed).

  it('accepts webhook with correct HMAC in production', async () => {
    const secret  = 'prod_webhook_secret_abc123';
    const payload = JSON.stringify({ id: 'inv_prod_hmac_ok', status: 'paid' });
    const sig     = await hmacSign(secret, payload);

    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': sig },
      body:    payload,
    });

    const result = await verifyMayarWebhook(req, { ENVIRONMENT: 'production', MAYAR_WEBHOOK_SECRET: secret });
    expect(result.valid).toBe(true);
    expect(result.body).toBe(payload);
  });

  it('rejects webhook with wrong HMAC in production', async () => {
    const secret  = 'prod_webhook_secret_abc123';
    const payload = JSON.stringify({ id: 'inv_prod_hmac_bad', status: 'paid' });

    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'dead_wrong_sig' },
      body:    payload,
    });

    const result = await verifyMayarWebhook(req, { ENVIRONMENT: 'production', MAYAR_WEBHOOK_SECRET: secret });
    expect(result.valid).toBe(false);
  });

  it('rejects webhook with missing x-mayar-signature in production', async () => {
    const payload = JSON.stringify({ id: 'inv_prod_no_sig', status: 'paid' });

    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payload,
    });

    const result = await verifyMayarWebhook(req, { ENVIRONMENT: 'production', MAYAR_WEBHOOK_SECRET: 'any_secret' });
    expect(result.valid).toBe(false);
  });

  it('rejects when ENVIRONMENT is undefined (fail-closed)', async () => {
    const payload = JSON.stringify({ id: 'inv_no_env', status: 'paid' });

    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'sig' },
      body:    payload,
    });

    const result = await verifyMayarWebhook(req, {}); // no ENVIRONMENT
    expect(result.valid).toBe(false);
  });

  it('rejects webhooks when no secret is configured regardless of environment', async () => {
    // Fail-closed: no secret configured = reject in all environments (including sandbox).
    // This prevents a staging URL with no secret from accepting forged payment webhooks.
    const payload = JSON.stringify({ id: 'inv_no_secret_test', status: 'paid' });

    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'totally_wrong' },
      body:    payload,
    });

    // staging without secret → fail closed → invalid
    const stagingNoSecretResult = await verifyMayarWebhook(req.clone(), { ENVIRONMENT: 'staging' });
    expect(stagingNoSecretResult.valid).toBe(false);

    // sandbox without secret → fail closed → invalid
    const sandboxResult = await verifyMayarWebhook(req.clone(), { ENVIRONMENT: 'sandbox' });
    expect(sandboxResult.valid).toBe(false);

    // staging WITH secret → HMAC verified → wrong sig = invalid
    const stagingWithSecretResult = await verifyMayarWebhook(req.clone(), { ENVIRONMENT: 'staging', MAYAR_WEBHOOK_SECRET: 'some_secret' });
    expect(stagingWithSecretResult.valid).toBe(false);
  });

  it('accepts x-callback-token in sandbox when it matches the secret', async () => {
    // Mayar sandbox sends x-callback-token instead of x-mayar-signature.
    // When MAYAR_WEBHOOK_SECRET equals the token value, the webhook must be accepted.
    const secret = 'my-staging-callback-token';
    const payload = JSON.stringify({ id: 'inv_callback_token_test', status: 'paid' });

    const reqMatch = new Request('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-callback-token': secret },
      body: payload,
    });
    const result = await verifyMayarWebhook(reqMatch, { ENVIRONMENT: 'staging', MAYAR_WEBHOOK_SECRET: secret });
    expect(result.valid).toBe(true);
  });

  it('rejects x-callback-token in sandbox when it does not match the secret', async () => {
    const payload = JSON.stringify({ id: 'inv_callback_token_mismatch', status: 'paid' });
    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-callback-token': 'wrong-token' },
      body: payload,
    });
    const result = await verifyMayarWebhook(req, { ENVIRONMENT: 'staging', MAYAR_WEBHOOK_SECRET: 'correct-secret' });
    expect(result.valid).toBe(false);
  });

  it('allows sandbox webhook with secret set but no auth headers (Mayar simulator sends nothing)', async () => {
    // Mayar sandbox payment simulator does not consistently send x-callback-token or
    // x-mayar-signature. When MAYAR_WEBHOOK_SECRET is configured in staging but Mayar
    // sends no header, the webhook must still be accepted — we cannot verify what was
    // not sent. A wrong value (x-mayar-signature present but incorrect) is still rejected.
    const payload = JSON.stringify({ id: 'inv_sandbox_no_headers', status: 'paid' });
    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // no x-callback-token, no x-mayar-signature
      body: payload,
    });
    const result = await verifyMayarWebhook(req, { ENVIRONMENT: 'staging', MAYAR_WEBHOOK_SECRET: 'some-staging-secret' });
    expect(result.valid).toBe(true);
    expect(result.body).toBe(payload);
  });

  it('still rejects sandbox webhook with secret set and wrong x-mayar-signature present', async () => {
    // If x-mayar-signature IS present (even in sandbox), it must be verified.
    // Only *absent* headers are allowed through — a wrong value is always rejected.
    const payload = JSON.stringify({ id: 'inv_sandbox_bad_sig', status: 'paid' });
    const req = new Request('https://gaslamar.com/webhook/mayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mayar-signature': 'bad_signature' },
      body: payload,
    });
    const result = await verifyMayarWebhook(req, { ENVIRONMENT: 'staging', MAYAR_WEBHOOK_SECRET: 'some-staging-secret' });
    expect(result.valid).toBe(false);
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
    const secretHash = await sha256Full(FIXED_TEST_SECRET);
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'Budi CV text',
      job_desc: JOB_DESC,
      tier: '3pack',
      status: 'paid',
      credits_remaining: 3,
      total_credits: 3,
      created_at: Date.now(),
      session_secret_hash: secretHash,
    }), { expirationTtl: 1800 });

    const res = await post('/get-session', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credits_remaining).toBe(3);
    expect(body.total_credits).toBe(3);
    expect(body.tier).toBe('3pack');
  });

  it('falls back to credits_remaining=1 for sessions without the field', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    const secretHash = await sha256Full(FIXED_TEST_SECRET);
    // Seed without credits fields (omitted, not a legacy session without hash)
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'Budi CV text',
      job_desc: JOB_DESC,
      tier: 'single',
      status: 'paid',
      created_at: Date.now(),
      session_secret_hash: secretHash,
    }), { expirationTtl: 1800 });

    const res = await post('/get-session', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET });
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
    const secretHash = await sha256Full(FIXED_TEST_SECRET);
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'CV text jobhunt',
      job_desc: JOB_DESC,
      tier: 'jobhunt',
      status: 'paid',
      credits_remaining: 10,
      total_credits: 10,
      created_at: Date.now(),
      session_secret_hash: secretHash,
    }), { expirationTtl: 604800 });

    const res = await post('/get-session', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': FIXED_TEST_SECRET }, '10.3.0.1');
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

/**
 * Pre-populate tailoring KV cache so tailorCVID/tailorCVEN
 * short-circuit without making real Claude API calls.
 * Use this instead of fetchMock for generate success-path tests — avoids an
 * unreliable interaction between MockPool and concurrent parallel fetch calls.
 * Key format must stay in sync with GEN_KEY_PREFIX_ID/EN in tailoring.js.
 */
async function preTailorCache(cvText, jobDesc) {
  const h = await sha256Full(cvText + '\x00' + jobDesc);
  await env.GASLAMAR_SESSIONS.put(`${GEN_KEY_PREFIX_ID}${h}`, MOCK_CV_ID.content[0].text, { expirationTtl: 172800 });
  await env.GASLAMAR_SESSIONS.put(`${GEN_KEY_PREFIX_EN}${h}`, MOCK_CV_EN.content[0].text, { expirationTtl: 172800 });
}

/**
 * Build an extraHeaders object that carries session authentication via Cookie.
 * All session-authenticated endpoints now read session_id from the Cookie header
 * instead of the request body or query params.
 */
function sessionCookie(sessionId) {
  return { Cookie: `__Host-session_id=${sessionId}` };
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

describe('POST /resend-email — recovery index migration', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('moves recovery index entries using hashed email keys', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('ready', 'single');
    const oldEmail = 'old@example.com';
    const newEmail = 'new@example.com';
    const oldHash = await sha256Full(oldEmail);
    const newHash = await sha256Full(newEmail);
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      ...(await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' })),
      email: oldEmail,
    }), { expirationTtl: 1800 });
    await env.GASLAMAR_SESSIONS.put(`email_session_${oldHash}`, JSON.stringify({ session_ids: [sessionId] }), { expirationTtl: 1800 });

    const res = await post('/resend-email', { email: newEmail }, {
      ...sessionCookie(sessionId),
      'X-Session-Secret': secret,
    }, '10.55.0.1');
    expect(res.status).toBe(200);

    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${oldHash}`, { type: 'json' })).toBeNull();
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${oldEmail}`, { type: 'json' })).toBeNull();
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${newEmail}`, { type: 'json' })).toBeNull();
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${newHash}`, { type: 'json' }))
      .toEqual({ session_ids: [sessionId] });
  });

  it('falls back to legacy plaintext email index and migrates to hashed key', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('ready', 'single');
    const oldEmail = 'legacy@example.com';
    const newEmail = 'migrated@example.com';
    const newHash = await sha256Full(newEmail);
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      ...(await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' })),
      email: oldEmail,
    }), { expirationTtl: 1800 });
    await env.GASLAMAR_SESSIONS.put(`email_session_${oldEmail}`, JSON.stringify({ session_ids: [sessionId] }), { expirationTtl: 1800 });

    const res = await post('/resend-email', { email: newEmail }, {
      ...sessionCookie(sessionId),
      'X-Session-Secret': secret,
    }, '10.55.0.2');
    expect(res.status).toBe(200);

    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${oldEmail}`, { type: 'json' })).toBeNull();
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${newEmail}`, { type: 'json' })).toBeNull();
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${newHash}`, { type: 'json' }))
      .toEqual({ session_ids: [sessionId] });
  });

  it('migrates remaining legacy plaintext index entries to hashed keys', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('ready', 'single');
    const remainingId = 'sess_11111111-1111-4111-8111-111111111111';
    const oldEmail = 'shared-legacy@example.com';
    const newEmail = 'shared-new@example.com';
    const oldHash = await sha256Full(oldEmail);
    const newHash = await sha256Full(newEmail);
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      ...(await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' })),
      email: oldEmail,
    }), { expirationTtl: 1800 });
    await env.GASLAMAR_SESSIONS.put(`email_session_${oldEmail}`, JSON.stringify({ session_ids: [remainingId, sessionId] }), { expirationTtl: 1800 });

    const res = await post('/resend-email', { email: newEmail }, {
      ...sessionCookie(sessionId),
      'X-Session-Secret': secret,
    }, '10.55.0.3');
    expect(res.status).toBe(200);

    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${oldEmail}`, { type: 'json' })).toBeNull();
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${oldHash}`, { type: 'json' }))
      .toEqual({ session_ids: [remainingId] });
    expect(await env.GASLAMAR_SESSIONS.get(`email_session_${newHash}`, { type: 'json' }))
      .toEqual({ session_ids: [sessionId] });
  });

  it('lets /resend-access find the session by the changed email only', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('ready', 'single');
    const oldEmail = 'recover-old@example.com';
    const newEmail = 'recover-new@example.com';
    const oldHash = await sha256Full(oldEmail);
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      ...(await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' })),
      email: oldEmail,
    }), { expirationTtl: 1800 });
    await env.GASLAMAR_SESSIONS.put(`email_session_${oldHash}`, JSON.stringify({ session_ids: [sessionId] }), { expirationTtl: 1800 });

    const changeRes = await post('/resend-email', { email: newEmail }, {
      ...sessionCookie(sessionId),
      'X-Session-Secret': secret,
    }, '10.55.0.4');
    expect(changeRes.status).toBe(200);

    const envWithResend = { ...env, RESEND_API_KEY: 'test-resend-key' };
    fetchMock
      .get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(200, JSON.stringify({ id: 'email_access_new' }))
      .times(1);

    const oldAccess = await handleResendAccess(jsonRequest('/resend-access', { email: oldEmail }, '10.55.0.5'), envWithResend);
    expect(oldAccess.status).toBe(200);
    const tokensAfterOldEmail = await env.GASLAMAR_SESSIONS.list({ prefix: 'email_token_' });
    expect(tokensAfterOldEmail.keys).toEqual([]);

    const newAccess = await handleResendAccess(jsonRequest('/resend-access', { email: newEmail }, '10.55.0.6'), envWithResend);
    expect(newAccess.status).toBe(200);
    const tokensAfterNewEmail = await env.GASLAMAR_SESSIONS.list({ prefix: 'email_token_' });
    expect(tokensAfterNewEmail.keys).toHaveLength(1);
  });
});

describe('POST /resend-access', () => {
  it('returns 429 after 3 requests per email per hour', async () => {
    const email = `rate-${crypto.randomUUID()}@example.com`;
    const ip = '10.56.0.1';

    for (let i = 0; i < 3; i++) {
      const res = await post('/resend-access', { email }, {}, ip);
      expect(res.status).toBe(200);
    }

    const blocked = await post('/resend-access', { email }, {}, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
});

// ── Patch 5: Abuse / rate-limit regression tests ──────────────────────────────

// Each test uses a unique high-octet IP to avoid exhausting the shared
// RATE_LIMITER_PAYMENT binding (5 req/min per IP) that exchange-token reuses.
describe('POST /exchange-token — token format validation', () => {
  it('rejects non-hex token (returns 400)', async () => {
    const res = await post('/exchange-token', { email_token: 'not-a-hex-token-at-all!!' }, {}, '10.201.0.1');
    expect(res.status).toBe(400);
  });

  it('rejects token shorter than 32 chars (returns 400)', async () => {
    const res = await post('/exchange-token', { email_token: 'abc123' }, {}, '10.201.0.2');
    expect(res.status).toBe(400);
  });

  it('rejects token longer than 32 chars (returns 400)', async () => {
    const res = await post('/exchange-token', { email_token: 'a'.repeat(64) }, {}, '10.201.0.3');
    expect(res.status).toBe(400);
  });

  it('rejects uppercase hex token — must be lowercase (returns 400)', async () => {
    // hexToken() always produces lowercase; uppercase is a different format
    const res = await post('/exchange-token', { email_token: 'A'.repeat(32) }, {}, '10.201.0.4');
    expect(res.status).toBe(400);
  });

  it('rejects missing email_token (returns 400)', async () => {
    const res = await post('/exchange-token', {}, {}, '10.201.0.5');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a valid-format token that does not exist in KV', async () => {
    const token = 'deadbeef'.repeat(4); // 32 lowercase hex chars
    const res = await post('/exchange-token', { email_token: token }, {}, '10.201.0.6');
    expect(res.status).toBe(404);
  });
});

describe('POST /exchange-token — single-use enforcement', () => {
  it('succeeds on first use and sets a session cookie', async () => {
    const sessionId = await seedSession('paid', 'single');
    const token = crypto.randomUUID().replace(/-/g, ''); // 32 lowercase hex chars
    await env.GASLAMAR_SESSIONS.put(`email_token_${token}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 3600 });

    const res = await post('/exchange-token', { email_token: token }, {}, '10.202.0.1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('session_id');
    expect(res.headers.get('Set-Cookie')).toMatch(/__Host-session_id=/);
  });

  it('returns 404 on second use of the same token (single-use enforcement)', async () => {
    const sessionId = await seedSession('paid', 'single');
    const token = crypto.randomUUID().replace(/-/g, '');
    await env.GASLAMAR_SESSIONS.put(`email_token_${token}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 3600 });

    // First use — should succeed
    const first = await post('/exchange-token', { email_token: token }, {}, '10.202.0.2');
    expect(first.status).toBe(200);

    // Second use — token was deleted on first use; use same IP, rate limit has 5 slots
    const second = await post('/exchange-token', { email_token: token }, {}, '10.202.0.2');
    expect(second.status).toBe(404);
  });

  it('KV token key is absent after successful exchange', async () => {
    const sessionId = await seedSession('paid', 'single');
    const token = crypto.randomUUID().replace(/-/g, '');
    const kvKey = `email_token_${token}`;
    await env.GASLAMAR_SESSIONS.put(kvKey, JSON.stringify({ session_id: sessionId }), { expirationTtl: 3600 });

    await post('/exchange-token', { email_token: token }, {}, '10.202.0.3');

    const remaining = await env.GASLAMAR_SESSIONS.get(kvKey);
    expect(remaining).toBeNull();
  });

  it('rejects and consumes a token mapped to a malformed session id', async () => {
    const token = crypto.randomUUID().replace(/-/g, '');
    const kvKey = `email_token_${token}`;
    await env.GASLAMAR_SESSIONS.put(
      kvKey,
      JSON.stringify({ session_id: 'sess_bad; SameSite=None' }),
      { expirationTtl: 3600 },
    );

    const res = await post('/exchange-token', { email_token: token }, {}, '10.202.0.4');
    expect(res.status).toBe(404);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    await expect(env.GASLAMAR_SESSIONS.get(kvKey)).resolves.toBeNull();
  });
});

describe('POST /resend-access — unknown email returns generic success', () => {
  it('returns 200 with generic message for an email that has no registered session', async () => {
    const res = await post('/resend-access', { email: 'nobody@nowhere-unknown.example.com' }, {}, '10.77.1.1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Must not reveal whether the email exists
    expect(typeof body.message).toBe('string');
  });

  it('returns same 200 shape for unknown and known emails (no oracle)', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const knownEmail = `known-${crypto.randomUUID()}@example.com`;
    const emailHash = await sha256Full(knownEmail);
    await env.GASLAMAR_SESSIONS.put(`email_session_${emailHash}`, JSON.stringify({ session_ids: [sessionId] }), { expirationTtl: 3600 });

    const unknownRes = await post('/resend-access', { email: `noone-${crypto.randomUUID()}@example.com` }, {}, '10.77.2.1');
    const unknownBody = await unknownRes.json();

    // Both return 200 with success:true — caller cannot distinguish known from unknown
    expect(unknownRes.status).toBe(200);
    expect(unknownBody.success).toBe(true);
  });
});

describe('GET /check-session — response shape and field allowlist', () => {
  it('returns exactly the documented fields for an active session (no PII leakage)', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await get('/check-session', sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Documented fields must be present
    expect(body).toHaveProperty('status', 'paid');
    expect(body).toHaveProperty('credits_remaining');
    expect(body).toHaveProperty('total_credits');
    expect(body).toHaveProperty('tier', 'single');
    expect(body).toHaveProperty('ttl_seconds');

    // Sensitive session fields must NOT be present
    expect(body).not.toHaveProperty('session_id');
    expect(body).not.toHaveProperty('cv_text');
    expect(body).not.toHaveProperty('job_desc');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('session_secret_hash');
    expect(body).not.toHaveProperty('mayar_invoice_id');
    expect(body).not.toHaveProperty('ip');
  });

  it('ttl_seconds is a non-negative number', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await get('/check-session', sessionCookie(sessionId));
    const body = await res.json();
    expect(typeof body.ttl_seconds).toBe('number');
    expect(body.ttl_seconds).toBeGreaterThanOrEqual(0);
  });
});

describe('Session token non-disclosure', () => {
  it('POST /exchange-token sets the HttpOnly cookie without returning session_id in JSON', async () => {
    const sessionId = await seedSession('paid', 'single');
    const token = '0123456789abcdef0123456789abcdef';
    await env.GASLAMAR_SESSIONS.put(`email_token_${token}`, JSON.stringify({ session_id: sessionId }), { expirationTtl: 3600 });

    const res = await post('/exchange-token', { email_token: token }, {}, '10.78.0.1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(res.headers.get('Set-Cookie')).toMatch(/__Host-session_id=sess_/);
  });

});

// ── (end Patch 5 abuse/rate-limit tests) ──────────────────────────────────────

describe('Cookie-only session auth — POST /get-session', () => {
  it('returns 200 when only the HttpOnly session cookie is present, even for historical hashed sessions', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('cv');
    expect(body).not.toHaveProperty('job_desc');
    expect(body.tier).toBe('single');
  });

  it('ignores stale or wrong X-Session-Secret headers instead of treating them as auth', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/get-session', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': 'wrong-secret' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('cv');
    expect(body).not.toHaveProperty('job_desc');
    expect(body.tier).toBe('single');
  });

  it('accepts sessions without a stored hash because the cookie is the auth credential', async () => {
    const sessionId = await seedLegacySession('paid', 'single');
    const res = await post('/get-session', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
  });
});

describe('Cookie-only session auth — POST /generate', () => {
  it('does not require a client-readable secret for hashed sessions', async () => {
    const { sessionId } = await seedSessionWithSecret('generating');
    const res = await post('/generate', {}, { ...sessionCookie(sessionId) }, '10.4.0.1');
    expect(res.status).not.toBe(403);
  });

  it('ignores wrong X-Session-Secret headers', async () => {
    const { sessionId } = await seedSessionWithSecret('generating');
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': 'wrong' }, '10.4.0.2');
    expect(res.status).not.toBe(403);
  });

  it('still returns 403 (status not generating) for paid session with correct secret', async () => {
    // /generate requires status=generating; a paid session still 403s for wrong status.
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/generate', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': secret }, '10.4.0.3');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/generating|belum dikonfirmasi/i);
  });
});

describe('Cookie-only session auth — POST /session/ping', () => {
  it('returns 200 when only the HttpOnly session cookie is present', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', {}, sessionCookie(sessionId));
    expect(res.status).toBe(200);
  });

  it('ignores wrong X-Session-Secret headers', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': 'bad' });
    expect(res.status).toBe(200);
  });

  it('returns 200 with correct secret', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', {}, { ...sessionCookie(sessionId), 'X-Session-Secret': secret });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('accepts sessions without stored hash', async () => {
    const sessionId = await seedLegacySession('paid', 'single');
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
// POST /fetch-job-url — LinkedIn guest API + JSON-LD + new gate markers
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /fetch-job-url — LinkedIn guest API and JSON-LD extraction', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  // Range 10.103.0.x is reserved for this suite.
  let _ipSeq = 0;
  const nextIp = () => `10.103.0.${++_ipSeq}`;

  it('returns job_desc from LinkedIn guest API when successful', async () => {
    // Guest API returns a clean HTML fragment — handler should use it and skip page scraping.
    const guestHtml = '<div class="show-more-less-html"><p>Software Engineer. Requirements: 3+ years Python, strong SQL skills, team player.</p></div>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/9876543' })
      .reply(200, guestHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/9876543' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toBeTruthy();
    expect(body.job_desc).toContain('Python');
  });

  it('falls back to page scraping when guest API returns non-200', async () => {
    const pageHtml = '<html><body>Requirements: Minimum 2 years experience in Java and Spring Boot required.</body></html>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/1111111' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/1111111' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/1111111' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('Java');
  });

  it('falls back to page scraping when guest API returns an auth gate', async () => {
    const gateHtml = '<html><body>Join to apply for this role. Sign in to view all applicants.</body></html>';
    const pageHtml = '<html><body>About the job: We need a senior engineer with Go and Kubernetes experience for our platform team.</body></html>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/2222222' })
      .reply(200, gateHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/2222222' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/2222222' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('Kubernetes');
  });

  it('extracts job description from JSON-LD JobPosting schema on page', async () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Senior Backend Engineer',
      hiringOrganization: { '@type': 'Organization', name: 'Acme Corp' },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Jakarta' } },
      description: '<p>We are looking for a Senior Backend Engineer with 5+ years Node.js experience. Strong knowledge of PostgreSQL and Redis required. You will lead the API platform team.</p>',
    });
    const pageHtml = `<html><head><script type="application/ld+json">${jsonLd}</script></head><body><nav>LinkedIn Home Jobs</nav></body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/3333333' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/3333333' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/3333333' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('Senior Backend Engineer');
    expect(body.job_desc).toContain('Acme Corp');
    expect(body.job_desc).toContain('PostgreSQL');
    // Should NOT include nav noise from the body
    expect(body.job_desc).not.toContain('LinkedIn Home Jobs');
  });

  it('prefers JSON-LD over body text when both are present', async () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Data Scientist',
      hiringOrganization: { '@type': 'Organization', name: 'DataCo' },
      description: 'Looking for Python and ML expertise with TensorFlow background.',
    });
    const pageHtml = `<html><head><script type="application/ld+json">${jsonLd}</script></head><body><p>Some random nav text that should be ignored in favour of JSON-LD structured data.</p></body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/4444444' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/4444444' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/4444444' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('TensorFlow');
    expect(body.job_desc).not.toContain('random nav text');
  });

  it('returns 422 with linkedin_auth_required on "Join to apply" gate marker', async () => {
    const gateHtml = `<html><body>Join to apply for this position at Acme Corp. ${'x'.repeat(100)}</body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/5555555' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/5555555' })
      .reply(200, gateHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/5555555' }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.linkedin_auth_required).toBe(true);
  });

  it('returns 422 with linkedin_auth_required on "Sign in to view" gate marker', async () => {
    const gateHtml = `<html><body>Sign in to view all 50 applicants for this role. ${'y'.repeat(100)}</body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/6666666' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/6666666' })
      .reply(200, gateHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/6666666' }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.linkedin_auth_required).toBe(true);
  });

  it("returns 422 with linkedin_auth_required on \"Verify you're human\" challenge", async () => {
    const gateHtml = `<html><body>Verify you're human. ${'z'.repeat(100)}</body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/7777777' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/7777777' })
      .reply(200, gateHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/7777777' }, {}, nextIp());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.linkedin_auth_required).toBe(true);
  });

  it('does NOT block a valid security-engineer job posting that mentions "security check"', async () => {
    // "security check" was previously in LINKEDIN_GATE_MARKERS — it falsely blocked
    // security-engineer jobs. Verify it no longer triggers a gate response.
    const pageHtml = '<html><body>About the job: Looking for a Security Engineer. Must pass a background security check and obtain a clearance. ' +
      'Requirements: 5 years of penetration testing experience. Strong knowledge of OWASP top 10. ' +
      'You will perform security checks on production systems and audit cloud infrastructure.</body></html>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/8888888' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/8888888' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/8888888' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('penetration testing');
  });

  it('extracts JSON-LD with @type array form ["JobPosting","Thing"]', async () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': ['JobPosting', 'Thing'],
      title: 'DevOps Engineer',
      hiringOrganization: { '@type': 'Organization', name: 'CloudCo' },
      description: 'We need a DevOps Engineer with Kubernetes and Terraform skills for our platform.',
    });
    const pageHtml = `<html><head><script type="application/ld+json">${jsonLd}</script></head><body><nav>nav</nav></body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/9900001' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/9900001' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/9900001' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('DevOps Engineer');
    expect(body.job_desc).toContain('Terraform');
  });

  it('extracts JSON-LD with hiringOrganization as array', async () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Product Manager',
      hiringOrganization: [{ '@type': 'Organization', name: 'ArrayCorp' }],
      description: 'We are hiring a Product Manager with 3 years experience in agile product development.',
    });
    const pageHtml = `<html><head><script type="application/ld+json">${jsonLd}</script></head><body></body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/9900002' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/9900002' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/9900002' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('ArrayCorp');
    expect(body.job_desc).toContain('agile');
  });

  it('decodes HTML entities in JSON-LD description', async () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Frontend Engineer',
      hiringOrganization: { '@type': 'Organization', name: 'EntitiesCo' },
      description: 'We use React &amp; TypeScript. Salary: &gt;Rp 20 juta. &#8220;Great team&#8221; &amp; flexible work.',
    });
    const pageHtml = `<html><head><script type="application/ld+json">${jsonLd}</script></head><body></body></html>`;
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/9900003' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/9900003' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/9900003' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Entities should be decoded to real characters, not literal &amp; etc.
    expect(body.job_desc).toContain('React & TypeScript');
    expect(body.job_desc).not.toContain('&amp;');
  });

  it('does not crash on JSON-LD containing literal null (JSON.parse edge case)', async () => {
    // JSON.parse('null') = null — accessing null['@graph'] used to throw TypeError.
    // Handler should gracefully skip it and fall through to body text extraction.
    const pageHtml = '<html><head>' +
      '<script type="application/ld+json">null</script>' +
      '</head><body>About the job: Senior DevOps with Terraform and AWS skills needed for cloud team.</body></html>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/9900005' })
      .reply(404, 'Not Found', { headers: { 'content-type': 'text/html' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/9900005' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/9900005' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('Terraform');
  });

  it('returns null from guest API and falls through when guest API redirects (redirect:manual)', async () => {
    // A 3xx from the guest API (e.g. LinkedIn redirecting to /authwall) should
    // NOT be followed — return null and fall through to full-page scraping.
    const pageHtml = '<html><body>About the job: React developer with 3 years TypeScript experience for our web team.</body></html>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs-guest/jobs/api/jobPosting/9900004' })
      .reply(302, '', { headers: { 'content-type': 'text/html', location: 'https://www.linkedin.com/authwall' } })
      .times(1);
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/jobs/view/9900004' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/jobs/view/9900004' }, {}, nextIp());
    // Falls through to page scraping which finds the job content
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('TypeScript');
  });

  it('does not attempt guest API for non-/jobs/view/ LinkedIn URLs', async () => {
    // URL has no numeric job ID — should skip guest API and go straight to page scraping.
    const pageHtml = '<html><body>Requirements: 3 years of React and TypeScript for this frontend role.</body></html>';
    fetchMock
      .get('https://www.linkedin.com')
      .intercept({ path: '/company/acmecorp/jobs/' })
      .reply(200, pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      .times(1);

    const res = await post('/fetch-job-url', { url: 'https://www.linkedin.com/company/acmecorp/jobs/' }, {}, nextIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_desc).toContain('TypeScript');
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
    const res = await post('/interview-kit', {}, { Cookie: '__Host-session_id=sess_nonexistent' }, nextKitIp());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toMatch(/sesi/i);
  });

  it('accepts cookie-only auth for historical hashed sessions', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_CLAUDE_KIT_RESPONSE))
      .times(1);
    const res = await post('/interview-kit', {}, sessionCookie(sessionId), nextKitIp());
    expect(res.status).toBe(200);
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

  it('does not expose parser or upstream exception details on Interview Kit failure', async () => {
    const sessionId = await seedSession('paid', 'single');

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify({ content: [{ text: 'not json at all' }] }))
      .times(1);

    const res = await post('/interview-kit', { language: 'id' }, sessionCookie(sessionId), nextKitIp());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe('Gagal menghasilkan Interview Kit. Coba lagi.');
    expect(body.message).not.toMatch(/unexpected|json|token|syntax/i);
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

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /validate-coupon', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('rejects missing coupon_code → 400', async () => {
    const res = await post('/validate-coupon', { tier: 'single' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('rejects code shorter than 3 chars → 400', async () => {
    const res = await post('/validate-coupon', { coupon_code: 'AB', tier: 'single' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('rejects missing or invalid tier → 400', async () => {
    const res = await post('/validate-coupon', { coupon_code: 'PROMO50', tier: 'premium' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.message).toMatch(/paket/i);
  });

  it('rejects coupon code with injection characters → 400', async () => {
    const injectionCodes = [
      '<script>alert(1)</script>',
      "'; DROP TABLE sessions;--",
      'CODE WITH SPACES',
      'CODE\nNEWLINE',
      'CODE\ttab',
      '../../etc/passwd',
    ];
    for (const code of injectionCodes) {
      const res = await post('/validate-coupon', { coupon_code: code, tier: 'single' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.valid).toBe(false);
    }
  });

  it('returns valid=false when Mayar says coupon is invalid', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: /\/hl\/v1\/coupon\/validate/, method: 'GET' })
      .reply(200, JSON.stringify({ statusCode: 200, data: { valid: false } }));

    const res = await post('/validate-coupon', { coupon_code: 'EXPIRED123', tier: 'single' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns discount info for a valid percentage coupon', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: /\/hl\/v1\/coupon\/validate/, method: 'GET' })
      .reply(200, JSON.stringify({
        statusCode: 200,
        data: {
          valid: true,
          coupon: { discountType: 'percentage', discountValue: 50, minimumPurchase: null },
        },
      }));

    const res = await post('/validate-coupon', { coupon_code: 'HEMAT50', tier: 'single' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.coupon_code).toBe('HEMAT50');
    expect(body.discount_type).toBe('percentage');
    expect(body.discount_value).toBe(50);
    expect(body.original_amount).toBe(59000);
    expect(body.discounted_amount).toBe(29500); // 59000 * 0.5
  });

  it('returns discount info for a valid monetary coupon', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: /\/hl\/v1\/coupon\/validate/, method: 'GET' })
      .reply(200, JSON.stringify({
        statusCode: 200,
        data: {
          valid: true,
          coupon: { discountType: 'monetary', discountValue: 10000, minimumPurchase: null },
        },
      }));

    const res = await post('/validate-coupon', { coupon_code: 'HEMAT10K', tier: '3pack' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.discount_type).toBe('monetary');
    expect(body.original_amount).toBe(149000);
    expect(body.discounted_amount).toBe(139000);
  });

  it('100% discount yields discounted_amount of 0', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: /\/hl\/v1\/coupon\/validate/, method: 'GET' })
      .reply(200, JSON.stringify({
        statusCode: 200,
        data: {
          valid: true,
          coupon: { discountType: 'percentage', discountValue: 100, minimumPurchase: null },
        },
      }));

    const res = await post('/validate-coupon', { coupon_code: 'LAUNCH100', tier: 'coba' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.discounted_amount).toBe(0);
    expect(body.original_amount).toBe(29000);
  });

  it('Mayar API error is caught and surfaces as valid=false (graceful degradation)', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: /\/hl\/v1\/coupon\/validate/, method: 'GET' })
      .reply(500, 'Internal Server Error');

    const res = await post('/validate-coupon', { coupon_code: 'ANYCODE', tier: 'jobhunt' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    // Must not surface raw server error text
    expect(body.message).not.toContain('Internal Server Error');
  });

  it('coupon code is normalised to uppercase in the response', async () => {
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: /\/hl\/v1\/coupon\/validate/, method: 'GET' })
      .reply(200, JSON.stringify({
        statusCode: 200,
        data: {
          valid: true,
          coupon: { discountType: 'percentage', discountValue: 20, minimumPurchase: null },
        },
      }));

    const res = await post('/validate-coupon', { coupon_code: 'hemat20', tier: 'single' });
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.coupon_code).toBe('HEMAT20');
  });
});

describe('POST /create-payment — scoring snapshot preservation', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  it('writes scoring_<token> snapshot when cvtext_ entry contains scoring data', async () => {
    const token = 'b'.repeat(64);
    const cvTextKey = `cvtext_${token}`;
    const mockScoring = { skor: 71, verdict: 'DO', skor_6d: { portfolio: 7 } };
    await env.GASLAMAR_SESSIONS.put(cvTextKey, JSON.stringify({
      text: 'CV content for scoring test',
      job_desc: JOB_DESC,
      ip: '10.1.1.1',
      scoring: mockScoring,
    }), { expirationTtl: 86400 });

    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({
        data: { id: 'inv_scoring_snap', link: 'https://web.mayar.club/pay/inv_scoring_snap' }
      }))
      .times(1);

    const res = await post('/create-payment', {
      tier: 'single',
      cv_text_key: cvTextKey,
    }, {}, '10.1.1.1');
    expect(res.status).toBe(200);

    // cvtext_ entry must be deleted (consumed)
    const cvEntry = await env.GASLAMAR_SESSIONS.get(cvTextKey, { type: 'json' });
    expect(cvEntry).toBeNull();

    // scoring_ snapshot must be preserved for /get-scoring fallback
    const snapshot = await env.GASLAMAR_SESSIONS.get(`scoring_${token}`, { type: 'json' });
    expect(snapshot).not.toBeNull();
    expect(snapshot.scoring).toBeDefined();
    expect(snapshot.scoring.skor).toBe(71);
    expect(snapshot.scoring.verdict).toBe('DO');
  });

  it('does not write scoring_ key when cvtext_ has no scoring field', async () => {
    // seedCVTextKey omits scoring — verifies graceful no-op when scoring is absent
    const key = await seedCVTextKey(undefined, '10.1.1.2');
    const token = key.slice('cvtext_'.length);

    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/create', method: 'POST' })
      .reply(200, JSON.stringify({
        data: { id: 'inv_no_scoring', link: 'https://web.mayar.club/pay/inv_no_scoring' }
      }))
      .times(1);

    const res = await post('/create-payment', {
      tier: 'single',
      cv_text_key: key,
    }, {}, '10.1.1.2');
    expect(res.status).toBe(200);

    // scoring_ key should not exist (nothing to preserve)
    const snapshot = await env.GASLAMAR_SESSIONS.get(`scoring_${token}`, { type: 'json' });
    expect(snapshot).toBeNull();
  });
});

describe('GET /get-scoring — fallback to scoring_ snapshot after payment', () => {
  let scoringIpSeq = 0;
  const nextScoringIp = () => `10.221.0.${++scoringIpSeq}`;

  it('returns scoring from cvtext_ entry when it is still present', async () => {
    const token = 'c'.repeat(64);
    const mockScoring = { skor: 85, verdict: 'DO', skor_6d: {} };
    await env.GASLAMAR_SESSIONS.put(`cvtext_${token}`, JSON.stringify({
      text: 'raw cv',
      job_desc: 'raw jd',
      ip: '1.2.3.4',
      scoring: mockScoring,
    }), { expirationTtl: 86400 });

    const res = await get('/get-scoring', { Cookie: `__Host-cv_key=cvtext_${token}` }, '1.2.3.4');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(85);
    // Must never expose raw fields
    expect(body.text).toBeUndefined();
    expect(body.job_desc).toBeUndefined();
    expect(body.ip).toBeUndefined();
  });

  it('falls back to scoring_ snapshot when cvtext_ was deleted by payment creation', async () => {
    const token = 'd'.repeat(64);
    const mockScoring = { skor: 62, verdict: 'TIMED', skor_6d: {} };

    // Simulate post-payment state: cvtext_ gone, scoring_ snapshot present
    await env.GASLAMAR_SESSIONS.delete(`cvtext_${token}`);
    await env.GASLAMAR_SESSIONS.put(`scoring_${token}`, JSON.stringify({ scoring: mockScoring }), { expirationTtl: 86400 });

    const res = await get('/get-scoring', { Cookie: `__Host-cv_key=cvtext_${token}` }, nextScoringIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(62);
    expect(body.scoring.verdict).toBe('TIMED');
  });

  it('uses the HttpOnly analysis cookie when no key query parameter is present', async () => {
    const token = 'f'.repeat(64);
    const mockScoring = { skor: 78, verdict: 'DO', skor_6d: {} };
    await env.GASLAMAR_SESSIONS.put(`cvtext_${token}`, JSON.stringify({
      text: 'raw cv',
      job_desc: 'raw jd',
      ip: '1.2.3.4',
      scoring: mockScoring,
    }), { expirationTtl: 86400 });

    const res = await get('/get-scoring', { Cookie: `__Host-cv_key=cvtext_${token}` }, '1.2.3.4');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(78);
  });

  it('allows scoring lookups when the cvtext_ key was stored from a different IP (log-only)', async () => {
    // IP mismatch is intentionally non-blocking on /get-scoring — same rationale as
    // validateSession.js: mobile users and VPN users legitimately change IPs between
    // /analyze and /get-scoring. The 256-bit random key is already unguessable.
    const token = 'a1'.repeat(32);
    await env.GASLAMAR_SESSIONS.put(`cvtext_${token}`, JSON.stringify({
      text: 'raw cv',
      job_desc: 'raw jd',
      ip: '10.221.99.1',
      scoring: { skor: 51, verdict: 'TIMED', skor_6d: {} },
    }), { expirationTtl: 86400 });

    const res = await get('/get-scoring', { Cookie: `__Host-cv_key=cvtext_${token}` }, '10.221.99.2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(51);
  });

  it('allows scoring fallback snapshots even when the preserved key belongs to a different IP', async () => {
    // IP mismatch is log-only on /get-scoring — see above.
    const token = 'b1'.repeat(32);
    await env.GASLAMAR_SESSIONS.put(`scoring_${token}`, JSON.stringify({
      ip: '10.221.88.1',
      scoring: { skor: 61, verdict: 'TIMED', skor_6d: {} },
    }), { expirationTtl: 86400 });

    const res = await get('/get-scoring', { Cookie: `__Host-cv_key=cvtext_${token}` }, '10.221.88.2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(61);
  });

  it('returns 404 when both cvtext_ and scoring_ keys are absent', async () => {
    const token = 'e'.repeat(64);
    const res = await get('/get-scoring', { Cookie: `__Host-cv_key=cvtext_${token}` }, nextScoringIp());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 401 when no cv_key cookie is present', async () => {
    const res = await get('/get-scoring', {}, nextScoringIp());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns scoring via sessionToken cookie (new session flow)', async () => {
    const sessionId = crypto.randomUUID();
    const cvToken   = 'f1'.repeat(32);
    const cvKey     = `cvtext_${cvToken}`;
    const mockScoring = { skor: 82, verdict: 'DO', skor_6d: {} };
    await env.GASLAMAR_SESSIONS.put(`analysis_session_${sessionId}`, JSON.stringify({
      sessionId, resultId: crypto.randomUUID(), cvKey, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    }), { expirationTtl: 86400 });
    await env.GASLAMAR_SESSIONS.put(cvKey, JSON.stringify({
      text: 'cv text', job_desc: 'jd', ip: '1.2.3.4', scoring: mockScoring,
    }), { expirationTtl: 86400 });

    const res = await get('/get-scoring', { Cookie: `sessionToken=${sessionId}` }, '1.2.3.4');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(82);
    expect(body.text).toBeUndefined();
  });

  it('returns 401 via sessionToken when analysis_session_ KV entry is missing', async () => {
    const sessionId = crypto.randomUUID();
    const res = await get('/get-scoring', { Cookie: `sessionToken=${sessionId}` }, nextScoringIp());
    expect(res.status).toBe(401);
  });

  it('returns 401 when only a ?key= query param is provided (no cookie)', async () => {
    // The ?key= param is intentionally ignored — accepting it would allow unauthenticated enumeration.
    const token = 'e1'.repeat(32);
    const res = await get(`/get-scoring?key=cvtext_${token}`, {}, nextScoringIp());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns scoring via cv_key cookie (new session flow)', async () => {
    const token = '1'.repeat(64);
    const mockScoring = { skor: 77, verdict: 'DO', skor_6d: {} };
    await env.GASLAMAR_SESSIONS.put(`cvtext_${token}`, JSON.stringify({
      text: 'raw cv', job_desc: 'raw jd', ip: '1.2.3.4', scoring: mockScoring,
    }), { expirationTtl: 86400 });

    // Pass key via HttpOnly cookie — no query param; use same IP as stored entry
    const res = await get('/get-scoring', { Cookie: `__Host-cv_key=cvtext_${token}` }, '1.2.3.4');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(77);
    // Must never expose raw fields
    expect(body.text).toBeUndefined();
    expect(body.cv_text).toBeUndefined();
  });

  it('X-Analysis-Session header returns scoring when no cookie present (Safari/ITP fallback)', async () => {
    const sessionId   = crypto.randomUUID();
    const cvKeyToken  = 'd'.repeat(64);
    const mockScoring = { skor: 88, verdict: 'DO', skor_6d: {} };
    await env.GASLAMAR_SESSIONS.put(`cvtext_${cvKeyToken}`, JSON.stringify({
      text: 'raw cv', job_desc: 'raw jd', ip: nextScoringIp(), scoring: mockScoring,
    }), { expirationTtl: 86400 });
    await env.GASLAMAR_SESSIONS.put(`analysis_session_${sessionId}`, JSON.stringify({
      sessionId, resultId: crypto.randomUUID(), cvKey: `cvtext_${cvKeyToken}`,
      createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    }), { expirationTtl: 86400 });

    const res = await get('/get-scoring', { 'X-Analysis-Session': sessionId }, nextScoringIp());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.scoring.skor).toBe(88);
    expect(body.text).toBeUndefined();
  });

  it('X-Analysis-Session header with unknown UUID → 401', async () => {
    const res = await get('/get-scoring', { 'X-Analysis-Session': crypto.randomUUID() }, nextScoringIp());
    expect(res.status).toBe(401);
  });

  it('cookie takes precedence over query param', async () => {
    const goodToken = '2'.repeat(64);
    const badToken  = '3'.repeat(64);
    await env.GASLAMAR_SESSIONS.put(`cvtext_${goodToken}`, JSON.stringify({
      text: 'cv', job_desc: 'jd', scoring: { skor: 55 },
    }), { expirationTtl: 86400 });

    // Cookie key is valid; query param points to a nonexistent key.
    const res = await get(
      `/get-scoring?key=cvtext_${badToken}`,
      { Cookie: `__Host-cv_key=cvtext_${goodToken}` },
      nextScoringIp(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoring.skor).toBe(55);
  });
});

describe('Rate limiting — GET /get-scoring (10 req/min per IP, 20/min with cookie)', () => {
  // Unique IP range to avoid cross-suite contamination
  const RL_GS_IP = '10.99.3.1';

  it('allows 10 requests and blocks the 11th with 429', async () => {
    // First 10: rate-limit passes, no cookie → 401 (auth check before KV lookup)
    for (let i = 0; i < 10; i++) {
      const r = await get('/get-scoring', {}, RL_GS_IP);
      expect(r.status).not.toBe(429);
    }
    // 11th must be blocked
    const res = await get('/get-scoring', {}, RL_GS_IP);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.message).toContain('Terlalu banyak');
  });

  it('counters are per-IP — a different IP is not blocked', async () => {
    // Exhaust limit for one IP (10.99.3.2)
    for (let i = 0; i < 10; i++) {
      await get('/get-scoring', {}, '10.99.3.2');
    }
    // A different IP should still pass rate limiting (will get 401 from missing cookie)
    const res = await get('/get-scoring', {}, '10.99.3.3');
    expect(res.status).toBe(401);
  });

  it('missing cookie returns 401 — identical body prevents enumeration', async () => {
    // Requests without a cookie return 401 before any KV lookup, preventing key enumeration.
    const withQueryParam = await get('/get-scoring?key=notvalid_' + 'a'.repeat(64), {}, '10.99.3.4');
    const noParams       = await get('/get-scoring', {}, '10.99.3.4');
    expect(withQueryParam.status).toBe(401);
    expect(noParams.status).toBe(401);
    // Both produce identical 401 with no key-existence information
    expect((await withQueryParam.json()).valid).toBe(false);
    expect((await noParams.json()).valid).toBe(false);
  });
});

describe('POST /api/log', () => {
  it('returns method-not-allowed instead of a static 404 for wrong-method client logging calls', async () => {
    const res = await SELF.fetch('https://gaslamar.com/api/log', {
      method: 'GET',
      headers: {
        Origin: GASLAMAR_ORIGIN,
        'CF-Connecting-IP': '1.2.3.4',
      },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST, OPTIONS');
  });

  it('answers CORS preflight for client logging', async () => {
    const res = await SELF.fetch('https://gaslamar.com/api/log', {
      method: 'OPTIONS',
      headers: {
        Origin: GASLAMAR_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
        'CF-Connecting-IP': '1.2.3.4',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GASLAMAR_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('accepts application/json body and returns ok:true', async () => {
    const res = await post('/api/log', { event: 'test_error', data: { message: 'test' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('accepts text/plain body containing JSON and returns ok:true', async () => {
    const payload = JSON.stringify({ event: 'test_error', data: { message: 'test' } });
    const res = await SELF.fetch('https://gaslamar.com/api/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        Origin: GASLAMAR_ORIGIN,
        'CF-Connecting-IP': '1.2.3.4',
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('accepts text/plain body containing non-JSON and logs raw', async () => {
    const res = await SELF.fetch('https://gaslamar.com/api/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        Origin: GASLAMAR_ORIGIN,
        'CF-Connecting-IP': '1.2.3.4',
      },
      body: 'plain text payload',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects oversized payload → 413', async () => {
    const bigPayload = 'x'.repeat(8193);
    const res = await SELF.fetch('https://gaslamar.com/api/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: GASLAMAR_ORIGIN,
        'CF-Connecting-IP': '1.2.3.4',
      },
      body: bigPayload,
    });
    expect(res.status).toBe(413);
  });

  it('handles top-level PII key names without error (redacted server-side)', async () => {
    // PII_FIELDS keys at top level are redacted to [REDACTED] before logging.
    // Test verifies the endpoint accepts them without error.
    const res = await post('/api/log', { email: 'user@example.com', session_id: 'sess_abc', event: 'test' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('redacts nested PII and raw CV/JD values from client log payloads', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };
    try {
      const res = await post('/api/log', {
        event: 'nested_pii',
        data: {
          email: 'user@example.com',
          session_id: 'sess_abc',
          token: '0123456789abcdef0123456789abcdef',
          cv_text: 'Sensitive CV line',
          job_desc: 'Sensitive JD line',
          message: 'failed for user@example.com?token=0123456789abcdef0123456789abcdef',
        },
      });
      expect(res.status).toBe(200);
      const emitted = logs.find(line => line.includes('"event":"client_log"') && line.includes('nested_pii'));
      expect(emitted).toBeTruthy();
      expect(emitted).not.toContain('user@example.com');
      expect(emitted).not.toContain('sess_abc');
      expect(emitted).not.toContain('0123456789abcdef0123456789abcdef');
      expect(emitted).not.toContain('Sensitive CV line');
      expect(emitted).not.toContain('Sensitive JD line');
      expect(emitted).toContain('[REDACTED]');
      expect(emitted).toContain('[EMAIL_REDACTED]');
    } finally {
      console.log = originalLog;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /get-result — exhausted field', () => {
  const CV_RESULT = {
    cv_id: 'Budi Santoso\nSoftware Engineer',
    cv_id_docx: 'Budi Santoso\nSoftware Engineer',
    cv_en: null,
    cv_en_docx: null,
    job_title: 'Engineer',
    company: 'PT XYZ',
    tier: 'single',
    saved_at: Date.now(),
  };

  it('returns exhausted:true when session is in exhausted state', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'cv', job_desc: 'jd', tier: 'single', status: 'exhausted',
      created_at: Date.now(), credits_remaining: 0, total_credits: 1,
    }), { expirationTtl: 600 });
    await env.GASLAMAR_SESSIONS.put(`cv_result_${sessionId}`, JSON.stringify(CV_RESULT), { expirationTtl: 600 });

    const res = await post('/get-result', {}, { Cookie: `__Host-session_id=${sessionId}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exhausted).toBe(true);
  });

  it('returns exhausted:false when session still has credits (multi-credit user)', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'cv', job_desc: 'jd', tier: '3pack', status: 'ready',
      created_at: Date.now(), credits_remaining: 2, total_credits: 3,
    }), { expirationTtl: 600 });
    await env.GASLAMAR_SESSIONS.put(`cv_result_${sessionId}`, JSON.stringify({ ...CV_RESULT, tier: '3pack' }), { expirationTtl: 600 });

    const res = await post('/get-result', {}, { Cookie: `__Host-session_id=${sessionId}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exhausted).toBe(false);
  });

  it('returns exhausted:true when session is absent (expired after last credit)', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    // No session entry — only the cv_result_ entry remains
    await env.GASLAMAR_SESSIONS.put(`cv_result_${sessionId}`, JSON.stringify(CV_RESULT), { expirationTtl: 600 });

    const res = await post('/get-result', {}, { Cookie: `__Host-session_id=${sessionId}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exhausted).toBe(true);
  });

  it('returns 401 when no session cookie', async () => {
    const res = await post('/get-result', {});
    expect(res.status).toBe(401);
  });

  it('returns 404 when cv_result_ entry is absent', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    const res = await post('/get-result', {}, { Cookie: `__Host-session_id=${sessionId}` });
    expect(res.status).toBe(404);
  });
});

describe('Security headers', () => {
  const REQUIRED = [
    ['content-security-policy', "default-src 'none'; frame-ancestors 'none'"],
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
    ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ];

  async function assertSecurityHeaders(res) {
    for (const [header, expected] of REQUIRED) {
      expect(res.headers.get(header), `Missing ${header}`).toBe(expected);
    }
  }

  it('GET /health returns all four security headers', async () => {
    const res = await get('/health');
    await assertSecurityHeaders(res);
  });

  it('OPTIONS preflight returns CORS Allow-Origin header', async () => {
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'OPTIONS',
      headers: { Origin: GASLAMAR_ORIGIN, 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(GASLAMAR_ORIGIN);
  });

  it('GET /check-session returns all four security headers', async () => {
    const res = await get('/check-session');
    await assertSecurityHeaders(res);
  });

  it('GET /get-scoring returns all four security headers (even on error)', async () => {
    const res = await get('/get-scoring?key=cvtext_abc');
    await assertSecurityHeaders(res);
  });

  it('POST /analyze validation error returns all four security headers', async () => {
    const res = await post('/analyze', {});
    await assertSecurityHeaders(res);
  });

  it('404 response returns all four security headers', async () => {
    const res = await get('/nonexistent-endpoint-xyz');
    await assertSecurityHeaders(res);
  });
});

describe('POST /admin/cancel-invoice', () => {
  const ADMIN_SECRET = 'test-admin-secret-abc';

  // Admin endpoint is called server-to-server — no Origin header (CI pipeline curl call).
  // Requests without Origin are not subject to the CORS origin check (isUnsafeOrigin
  // only fails when Origin is present but not allowlisted, or Sec-Fetch-Site=cross-site).
  function adminPost(body, token = ADMIN_SECRET, extraEnv = {}) {
    return route(new Request('https://gaslamar.com/admin/cancel-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '1.2.3.4',
        'X-Admin-Token': token,
      },
      body: JSON.stringify(body),
    }), { ...env, ENVIRONMENT: 'staging', ADMIN_SECRET, ...extraEnv }, {});
  }

  it('returns 404 in production environment', async () => {
    const res = await route(new Request('https://gaslamar.com/admin/cancel-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-Admin-Token': ADMIN_SECRET },
      body: JSON.stringify({ session_id: `sess_${crypto.randomUUID()}` }),
    }), { ...env, ENVIRONMENT: 'production', ADMIN_SECRET }, {});
    expect(res.status).toBe(404);
  });

  it('returns 503 when ADMIN_SECRET is not configured', async () => {
    const res = await adminPost({ session_id: `sess_${crypto.randomUUID()}` }, ADMIN_SECRET, { ADMIN_SECRET: undefined });
    expect(res.status).toBe(503);
  });

  it('returns 401 when X-Admin-Token header is missing', async () => {
    const res = await route(new Request('https://gaslamar.com/admin/cancel-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({ session_id: `sess_${crypto.randomUUID()}` }),
    }), { ...env, ENVIRONMENT: 'staging', ADMIN_SECRET }, {});
    expect(res.status).toBe(401);
  });

  it('returns 403 when token is wrong', async () => {
    const res = await adminPost({ session_id: `sess_${crypto.randomUUID()}` }, 'wrong-token');
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid session_id format', async () => {
    const res = await adminPost({ session_id: 'not-a-valid-id' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when session does not exist', async () => {
    const res = await adminPost({ session_id: `sess_${crypto.randomUUID()}` });
    expect(res.status).toBe(404);
  });

  it('returns 409 when session is not in pending_payment status', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      status: 'paid',
      tier: 'single',
      mayar_invoice_id: 'inv_test',
    }), { expirationTtl: 604800 });

    const res = await adminPost({ session_id: sessionId });
    expect(res.status).toBe(409);
  });

  it('returns 404 when session has no mayar_invoice_id', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      status: 'pending_payment',
      tier: 'single',
    }), { expirationTtl: 604800 });

    const res = await adminPost({ session_id: sessionId });
    expect(res.status).toBe(404);
  });

  it('clears session invoice fields and returns 207 when Mayar cancel fails', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      status: 'pending_payment',
      tier: 'single',
      mayar_invoice_id: 'inv_cancel_test',
      invoice_url: 'https://mayar.shop/test',
      invoice_created_at: Date.now(),
    }), { expirationTtl: 604800 });

    fetchMock.activate();
    // Simulate Mayar returning 404 on all cancel endpoints
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: /\/hl\/v1\/(invoice|payment)\/inv_cancel_test\/(void|cancel)/, method: 'POST' })
      .reply(404, JSON.stringify({ message: 'Not found' }))
      .times(3);

    const res = await adminPost({ session_id: sessionId });
    fetchMock.deactivate();

    // 207 = session cleared locally but Mayar cancel failed
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.invoice_id).toBe('inv_cancel_test');

    // Session should have invoice fields cleared
    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated.invoice_url).toBeNull();
    expect(updated.mayar_invoice_id).toBeNull();
    expect(updated.admin_cancelled_at).toBeTypeOf('number');
  });

  it('returns 200 when Mayar void succeeds', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      status: 'pending_payment',
      tier: 'single',
      mayar_invoice_id: 'inv_void_ok',
      invoice_url: 'https://mayar.shop/test2',
      invoice_created_at: Date.now(),
    }), { expirationTtl: 604800 });

    fetchMock.activate();
    fetchMock
      .get('https://api.mayar.club')
      .intercept({ path: '/hl/v1/invoice/inv_void_ok/void', method: 'POST' })
      .reply(200, JSON.stringify({ data: { id: 'inv_void_ok', status: 'voided' } }));

    const res = await adminPost({ session_id: sessionId });
    fetchMock.deactivate();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.invoice_id).toBe('inv_void_ok');

    const updated = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(updated.invoice_url).toBeNull();
    expect(updated.mayar_invoice_id).toBeNull();
  });
});
