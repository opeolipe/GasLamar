import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const VALID_CV = { type: 'txt', data: 'John Doe\nSoftware Engineer\nPython JavaScript Node.js' };
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
