import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { extractTextFromDOCX } from "../src/fileExtraction.js";

// cv must be a JSON string (the handler calls JSON.parse on it) — not a plain object.
const VALID_CV = JSON.stringify({ type: 'txt', data: 'John Doe\nSoftware Engineer\nPython JavaScript Node.js' });
let _ip = 200;
const nextIp = () => `10.99.${Math.floor(_ip/256)}.${_ip++ % 256}`;

async function post(path, body, ip) {
  return SELF.fetch('https://example.com' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || nextIp() },
    body: JSON.stringify(body),
  });
}

describe('job_desc type + length validation', () => {
  it('rejects non-string number → 400', async () => {
    const res = await post('/analyze', { cv: VALID_CV, job_desc: 99999 });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.message).toMatch(/terlalu panjang/i);
  });

  it('rejects non-string array → 400', async () => {
    const res = await post('/analyze', { cv: VALID_CV, job_desc: ['x'.repeat(5001)] });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.message).toMatch(/terlalu panjang/i);
  });

  it('rejects string 5001 chars → 400', async () => {
    const res = await post('/analyze', { cv: VALID_CV, job_desc: 'x'.repeat(5001) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.message).toMatch(/5\.000/);
  });

  it('passes string 5000 chars (length check, may fail downstream)', async () => {
    const res = await post('/analyze', { cv: VALID_CV, job_desc: 'x'.repeat(5000) });
    const body = await res.json().catch(() => ({}));
    // Must NOT be a length-related 400
    const isLengthRejection = res.status === 400 && body.message && /terlalu panjang|5\.000/.test(body.message);
    expect(isLengthRejection).toBe(false);
  });
});

function makeStoredDocxBase64(xmlText) {
  const xmlBytes = new TextEncoder().encode(xmlText);
  return makeDocxBase64(xmlBytes, 0, xmlBytes.length);
}

async function makeDeflatedDocxBase64(xmlText) {
  const xmlBytes = new TextEncoder().encode(xmlText);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const readPromise = new Response(cs.readable).arrayBuffer();
  await writer.write(xmlBytes);
  await writer.close();
  return makeDocxBase64(new Uint8Array(await readPromise), 8, xmlBytes.length);
}

function makeDocxBase64(payloadBytes, method, uncompressedLength) {
  const filenameBytes = new TextEncoder().encode('word/document.xml');
  const u32le = n => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF];
  const header = new Uint8Array([
    0x50, 0x4B, 0x03, 0x04,
    0x14, 0x00,
    0x00, 0x00,
    method & 0xFF, (method >> 8) & 0xFF,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    ...u32le(payloadBytes.length),
    ...u32le(uncompressedLength),
    filenameBytes.length & 0xFF, (filenameBytes.length >> 8) & 0xFF,
    0x00, 0x00,
  ]);
  const out = new Uint8Array(header.length + filenameBytes.length + payloadBytes.length);
  let off = 0;
  out.set(header, off); off += header.length;
  out.set(filenameBytes, off); off += filenameBytes.length;
  out.set(payloadBytes, off);
  let bin = '';
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe('DOCX extraction boundaries', () => {
  it('extracts a normal small DOCX document.xml', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Normal CV text under the ceiling</w:t></w:r></w:p></w:body></w:document>';
    await expect(extractTextFromDOCX(makeStoredDocxBase64(xml)))
      .resolves.toContain('Normal CV text under the ceiling');
  });

  it('rejects document.xml inflated above 1.5 MB', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>' + 'A'.repeat(1_500_001) + '</w:t></w:r></w:p></w:body></w:document>';
    await expect(extractTextFromDOCX(makeStoredDocxBase64(xml)))
      .rejects.toThrow(/terlalu besar|too large|decompressed/i);
  });

  it('rejects deflated document.xml inflated above 1.5 MB', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>' + 'A'.repeat(1_500_001) + '</w:t></w:r></w:p></w:body></w:document>';
    await expect(extractTextFromDOCX(await makeDeflatedDocxBase64(xml)))
      .rejects.toThrow(/terlalu besar|too large|decompressed/i);
  });
});
