/**
 * Extract the real client IP from a Cloudflare Worker request.
 *
 * Priority:
 *  1. CF-Connecting-IP  — set by Cloudflare's network for every proxied request
 *  2. X-Forwarded-For   — first entry; fallback for direct wrangler-dev / tunnel requests
 *  3. 'unknown'         — last resort; all 'unknown' requests share one rate-limit bucket,
 *                         so the limit is still enforced, just not per-IP
 *
 * CF-Connecting-IP is absent when:
 *  • Testing with `curl` directly against a Workers subdomain without the Cloudflare proxy
 *  • Using `wrangler dev` in local mode (no CF network)
 * In those cases X-Forwarded-For is often set by the local wrangler proxy.
 */
export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    'unknown'
  );
}

// ---- Structured Logging ----

export function log(event, data = {}) {
  console.log(JSON.stringify({ event, ts: Date.now(), ...data }));
}

export function logError(event, data = {}) {
  console.error(JSON.stringify({ event, ts: Date.now(), ...data }));
}

// ---- Crypto Helpers ----

/** Compute a hex SHA-256 of text (first 32 chars used as KV key segment). */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Compute full 64-char hex SHA-256 (used for session secret binding). */
export async function sha256Full(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a cryptographically random hex string of `byteCount` bytes (256 bits = 64 hex chars). */
export function hexToken(byteCount) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteCount)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- Filename Utilities ----

// Internal sanitizer: transliterate accented chars, strip non-alphanumeric, collapse spaces→hyphens.
export function _sanitizeFilenamePart(raw, maxLen) {
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
export function extractJobMetadata(jobDesc) {
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
