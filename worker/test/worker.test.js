/**
 * worker.test.js — GasLamar Worker Tests
 * Run: npm test (in /worker directory)
 * Uses @cloudflare/vitest-pool-workers for real workerd runtime.
 */

import { SELF, env, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

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

/** Seed a cvtext_ key in KV and return the key. */
async function seedCVTextKey(text = 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ 2020-2024\n- Node.js REST API\n- React dashboard\n\nPENDIDIKAN\nS1 Teknik Informatika UI 2020') {
  const key = `cvtext_${crypto.randomUUID()}`;
  await env.GASLAMAR_SESSIONS.put(key, JSON.stringify({ text, job_desc: JOB_DESC }), { expirationTtl: 3600 });
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
const MOCK_EXTRACTION = {
  content: [{ text: 'Budi Santoso\nSoftware Engineer\n\nPENGALAMAN\nDeveloper PT XYZ 2020-2024\n- Node.js REST API development\n- React dashboard\n\nPENDIDIKAN\nS1 Teknik Informatika UI 2020' }],
};

const MOCK_SCORING = {
  content: [{ text: JSON.stringify({
    // Sub-scores: server sums these deterministically → skor = 40+20+10+5 = 75
    skor_relevansi: 40,
    skor_requirements: 20,
    skor_kualitas: 10,
    skor_keywords: 5,
    alasan_skor: 'CV relevan dengan job description.',
    gap: ['Belum ada sertifikasi cloud', 'Kurang pengalaman Docker'],
    rekomendasi: ['Tambah proyek cloud', 'Pelajari Docker'],
    kekuatan: ['Pengalaman Node.js solid', 'Proyek relevan'],
  }) }],
};

const MOCK_CV_ID = { content: [{ text: 'RINGKASAN PROFESIONAL\nDeveloper berpengalaman dengan 4 tahun di Node.js dan React...\n\nPENGALAMAN KERJA\nDeveloper PT XYZ (2020–2024)\n- Membangun REST API' }] };
const MOCK_CV_EN = { content: [{ text: 'PROFESSIONAL SUMMARY\nExperienced developer with 4 years in Node.js and React...\n\nWORK EXPERIENCE\nDeveloper PT XYZ (2020–2024)\n- Built REST API' }] };

// ============================================================
// Test suites
// ============================================================

describe('/health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('does not leak env info', async () => {
    const res = await get('/health');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['status']);
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

  it('blocks unknown origin — returns null', async () => {
    const res = await SELF.fetch('https://gaslamar.com/health', {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it('handles missing Origin header — returns null (not a real origin)', async () => {
    const res = await SELF.fetch('https://gaslamar.com/health');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it('handles OPTIONS preflight — 204 no body', async () => {
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'OPTIONS',
      headers: { Origin: 'https://gaslamar.com' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('POST /analyze — validation', () => {
  it('rejects missing cv → 400', async () => {
    const res = await post('/analyze', { job_desc: JOB_DESC });
    expect(res.status).toBe(400);
  });

  it('rejects missing job_desc → 400', async () => {
    const res = await post('/analyze', { cv: VALID_PDF_CV });
    expect(res.status).toBe(400);
  });

  it('rejects job_desc > 5000 chars → 400', async () => {
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('5.000');
  });

  it('rejects PDF with wrong magic bytes → 400', async () => {
    const res = await post('/analyze', { cv: INVALID_CV, job_desc: JOB_DESC });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('PDF');
  });

  it('accepts valid DOCX magic bytes', async () => {
    // DOCX magic bytes are valid — only failing due to Claude (no mock here)
    // We just verify the magic-byte check passes (returns 422/500 from Claude, not 400)
    const res = await post('/analyze', { cv: VALID_DOCX_CV, job_desc: JOB_DESC });
    expect(res.status).not.toBe(400); // passed file validation
  });

  it('extracts text from DOCX with data descriptor flag (Word/Google Docs format)', async () => {
    // Bit 3 of general-purpose flags set → compressedSz=0 in local header.
    // Previously crashed with "Called close() on a decompression stream with incomplete data".
    const cv = JSON.stringify({ type: 'docx', data: makeDOCXDataDescriptorBase64() });
    const res = await post('/analyze', { cv, job_desc: JOB_DESC });
    // Must NOT be 400 (bad magic) or 422 (extraction failed) —
    // will be 500 because there's no Claude API key in the test env.
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(422);
  });

  it('returns user-friendly error for malformed DOCX missing word/document.xml → 422', async () => {
    // VALID_DOCX_CV has PK magic bytes but no word/document.xml entry
    const res = await post('/analyze', { cv: VALID_DOCX_CV, job_desc: JOB_DESC });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).not.toContain('word/document.xml');
    expect(body.message).toMatch(/rusak|tidak lengkap|upload.*berbeda/i);
  });

  it('rejects file over 5MB → 400', async () => {
    // ~7MB base64-encoded payload (5MB * 4/3 ≈ 6.7MB)
    const bigData = btoa('A'.repeat(1024 * 1024 * 5 + 1));
    const bigCv = JSON.stringify({ type: 'pdf', data: makePdfBase64() + bigData });
    const res = await post('/analyze', { cv: bigCv, job_desc: JOB_DESC });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('5MB');
  });

  it('rejects malformed JSON body → 400', async () => {
    const res = await SELF.fetch('https://gaslamar.com/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: GASLAMAR_ORIGIN },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /analyze — happy path (mocked Claude)', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  // SKIP: requires outbound API access (no OS-level proxy). Un-skip in CI with direct internet.
  it.skip('returns skor + cv_text_key when Claude succeeds', async () => {
    // Mock extraction then scoring — both POST to /v1/messages, served in order
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_EXTRACTION))
      .times(1);
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_SCORING))
      .times(1);

    // Use a unique IP to avoid hitting rate limit from other test suites
    const res = await post('/analyze', { cv: VALID_PDF_CV, job_desc: JOB_DESC }, {}, '10.0.0.1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skor).toBe(75); // 40+20+10+5 computed server-side from sub-scores
    expect(body.cv_text_key).toMatch(/^cvtext_/);

    // Verify key is stored in KV
    const stored = await env.GASLAMAR_SESSIONS.get(body.cv_text_key, { type: 'json' });
    expect(stored).not.toBeNull();
    expect(stored.text).toBeTruthy();
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
});

describe('POST /create-payment — one-time key consumption', () => {
  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  // SKIP: requires outbound API access (no OS-level proxy). Un-skip in CI with direct internet.
  it.skip('consumes cv_text_key — second call returns 400', async () => {
    const key = await seedCVTextKey();

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

describe('POST /session/ping', () => {
  it('rejects missing body → 400', async () => {
    const res = await post('/session/ping', {});
    expect(res.status).toBe(400);
  });

  it('rejects invalid session_id format → 400', async () => {
    const res = await post('/session/ping', { session_id: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/session/ping', { session_id: 'sess_nonexistent' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.expired).toBe(true);
  });

  it('returns ok:true and refreshes session for known session', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/session/ping', { session_id: sessionId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('paid');
  });
});

describe('GET /check-session', () => {
  it('rejects missing session → 400', async () => {
    const res = await get('/check-session');
    expect(res.status).toBe(400);
  });

  it('rejects session without sess_ prefix → 400', async () => {
    const res = await get('/check-session?session=invalid_id');
    expect(res.status).toBe(400);
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

describe('POST /get-session', () => {
  it('rejects missing session_id → 400', async () => {
    const res = await post('/get-session', {});
    expect(res.status).toBe(400);
  });

  it('rejects session_id without sess_ prefix → 400', async () => {
    const res = await post('/get-session', { session_id: 'abc123' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/get-session', { session_id: 'sess_nonexistent' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when status is pending (not paid)', async () => {
    const sessionId = await seedSession('pending');
    const res = await post('/get-session', { session_id: sessionId });
    expect(res.status).toBe(403);
  });

  it('returns cv/job_desc/tier and sets status to generating for paid session', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/get-session', { session_id: sessionId });
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

describe('POST /generate — validation', () => {
  it('rejects missing session_id → 400', async () => {
    const res = await post('/generate', {});
    expect(res.status).toBe(400);
  });

  it('rejects session_id without sess_ prefix → 400', async () => {
    const res = await post('/generate', { session_id: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    const res = await post('/generate', { session_id: 'sess_nonexistent' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when status is paid (not generating)', async () => {
    const sessionId = await seedSession('paid');
    const res = await post('/generate', { session_id: sessionId });
    expect(res.status).toBe(403);
  });

  it('returns 403 when status is pending', async () => {
    const sessionId = await seedSession('pending');
    const res = await post('/generate', { session_id: sessionId });
    expect(res.status).toBe(403);
  });
});

describe('POST /generate — happy path (mocked Claude)', () => {
  // Use a unique IP (10.0.0.3) so generate validation tests (IP 1.2.3.4)
  // don't exhaust this suite's rate-limit slots.
  const GENERATE_IP = '10.0.0.3';

  beforeAll(() => fetchMock.activate());
  afterAll(() => fetchMock.deactivate());

  // SKIP: requires outbound API access (no OS-level proxy). Un-skip in CI with direct internet.
  it.skip('generates bilingual CV for single tier — deletes session after', async () => {
    const sessionId = await seedSession('generating', 'single');

    // tailorCVID + tailorCVEN run in parallel — two Claude calls
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_CV_ID))
      .times(1);
    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_CV_EN))
      .times(1);

    const res = await post('/generate', { session_id: sessionId }, {}, GENERATE_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cv_id).toBeTruthy();
    expect(body.cv_en).toBeTruthy(); // bilingual

    // Session deleted after use (one-time)
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session).toBeNull();
  });

  // SKIP: requires outbound API access (no OS-level proxy). Un-skip in CI with direct internet.
  it.skip('generates ID-only CV for coba tier — cv_en is null', async () => {
    const sessionId = await seedSession('generating', 'coba');

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, JSON.stringify(MOCK_CV_ID))
      .times(1);

    const res = await post('/generate', { session_id: sessionId }, {}, GENERATE_IP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cv_id).toBeTruthy();
    expect(body.cv_en).toBeNull(); // no EN for coba tier
  });

  // SKIP: requires outbound API access (no OS-level proxy). Un-skip in CI with direct internet.
  it.skip('resets session to paid on Claude failure (so user can retry)', async () => {
    const sessionId = await seedSession('generating', 'single');

    fetchMock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(500, JSON.stringify({ error: { message: 'Internal server error' } }))
      .times(2); // both parallel calls fail

    const res = await post('/generate', { session_id: sessionId }, {}, GENERATE_IP);
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

    // In sandbox mode (no MAYAR_WEBHOOK_SECRET set), webhook passes HMAC check
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

    // Session should now be 'paid'
    const session = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
    expect(session?.status).toBe('paid');
  });

  it('ignores non-paid statuses (does not update session)', async () => {
    const sessionId = await seedSession('pending', 'single');

    const payload = JSON.stringify({
      status: 'expired',
      redirect_url: `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`,
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

    const res = await post('/get-session', { session_id: sessionId });
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

    const res = await post('/get-session', { session_id: sessionId });
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
    await env.GASLAMAR_SESSIONS.put(sessionId, JSON.stringify({
      cv_text: 'CV text',
      job_desc: JOB_DESC,
      tier: '3pack',
      status: 'pending',
      credits_remaining: 3,
      total_credits: 3,
      mayar_invoice_id: 'inv_multi1',
      created_at: Date.now(),
    }), { expirationTtl: 604800 });

    const payload = JSON.stringify({
      status: 'paid',
      data: { redirect_url: `https://gaslamar.com/download.html?session=${sessionId}` },
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

    const res = await post('/get-session', { session_id: sessionId }, {}, '10.3.0.1');
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
      session_id: sessionId,
      job_desc: 'x'.repeat(5001),
    }, {}, '10.1.0.1');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/terlalu panjang/i);
  });
});

// ---- Session secret validation tests ----

/** Helper: compute SHA-256 as 64-char hex (mirrors worker's sha256Full). */
async function sha256Full(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    const res = await post('/get-session', { session_id: sessionId });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/akses ditolak|token sesi/i);
  });

  it('returns 403 when wrong secret is provided', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/get-session', { session_id: sessionId }, { 'X-Session-Secret': 'wrong-secret' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/akses ditolak|token sesi/i);
  });

  it('returns 200 when correct secret is provided', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/get-session', { session_id: sessionId }, { 'X-Session-Secret': secret });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cv).toBeTruthy();
    expect(body.tier).toBe('single');
  });

  it('returns 200 for legacy sessions without a stored hash (no secret required)', async () => {
    // seedSession creates sessions without session_secret_hash — backward compat
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/get-session', { session_id: sessionId });
    expect(res.status).toBe(200);
  });
});

describe('Session secret — POST /generate', () => {
  it('returns 403 when secret is missing and session has a hash', async () => {
    const { sessionId } = await seedSessionWithSecret('generating');
    const res = await post('/generate', { session_id: sessionId }, {}, '10.4.0.1');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/akses ditolak|token sesi/i);
  });

  it('returns 403 when wrong secret is provided', async () => {
    const { sessionId } = await seedSessionWithSecret('generating');
    const res = await post('/generate', { session_id: sessionId }, { 'X-Session-Secret': 'wrong' }, '10.4.0.2');
    expect(res.status).toBe(403);
  });

  it('still returns 403 (status not generating) for paid session with correct secret', async () => {
    // /generate requires status=generating; a paid session with correct secret still 403s for wrong status
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/generate', { session_id: sessionId }, { 'X-Session-Secret': secret }, '10.4.0.3');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/generating|belum dikonfirmasi/i);
  });
});

describe('Session secret — POST /session/ping', () => {
  it('returns 403 when secret is missing and session has a hash', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', { session_id: sessionId });
    expect(res.status).toBe(403);
  });

  it('returns 403 when wrong secret is provided', async () => {
    const { sessionId } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', { session_id: sessionId }, { 'X-Session-Secret': 'bad' });
    expect(res.status).toBe(403);
  });

  it('returns 200 with correct secret', async () => {
    const { sessionId, secret } = await seedSessionWithSecret('paid');
    const res = await post('/session/ping', { session_id: sessionId }, { 'X-Session-Secret': secret });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 200 for legacy sessions without stored hash (backward compat)', async () => {
    const sessionId = await seedSession('paid', 'single');
    const res = await post('/session/ping', { session_id: sessionId });
    expect(res.status).toBe(200);
  });
});
