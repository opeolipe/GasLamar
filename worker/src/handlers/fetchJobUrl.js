import { jsonResponse } from '../cors.js';
import { clientIp } from '../utils.js';
import { checkRateLimit, rateLimitResponse } from '../rateLimit.js';

export async function handleFetchJobUrl(request, env) {
  const ip = clientIp(request);
  const allowed = await checkRateLimit(env, env.RATE_LIMITER_FETCH, ip);
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
