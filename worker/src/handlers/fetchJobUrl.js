import { jsonResponse } from '../cors.js';
import { clientIp, log } from '../utils.js';
import { checkRateLimit, rateLimitResponse } from '../rateLimit.js';
import { sanitizeForLLM, hasPromptInjection } from '../sanitize.js';

// ---- Allowlist ---------------------------------------------------------------
//
// Only URLs from these root domains (and their subdomains) are permitted.
// The suffix check — hostname === d || hostname.endsWith('.' + d) — allows
// subdomains such as company.linkedin.com while blocking look-alikes such as
// evillinkedin.com or linkedin.com.evil.com.
//
// URL shorteners are intentionally excluded: they can be used to redirect the
// Worker to an arbitrary destination, defeating the allowlist entirely.

const ALLOWED_JOB_BOARD_DOMAINS = [
  // Global / English
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',

  // Indonesian job boards
  'jobstreet.co.id',
  'glints.com',
  'glints.id',
  'kalibrr.com',
  'karir.com',
  'jobindo.com',
];

function isAllowedDomain(hostname) {
  return ALLOWED_JOB_BOARD_DOMAINS.some(
    d => hostname === d || hostname.endsWith('.' + d)
  );
}

// ---- IP-range helpers --------------------------------------------------------
//
// Block private, loopback, link-local, and reserved addresses.
// These are checked when the supplied URL uses a bare IP address rather than
// a hostname. For hostnames the allowlist already prevents reaching internal
// services; the IP check exists as a second, independent layer.

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  // Reject malformed addresses (wrong octet count or out-of-range values)
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 127) return true;                        // 127.0.0.0/8  loopback
  if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local (AWS metadata)
  if (a === 0) return true;                          // 0.0.0.0/8  current network
  if (a >= 224 && a <= 239) return true;             // 224.0.0.0/4 multicast
  if (a >= 240) return true;                         // 240.0.0.0/4 reserved
  return false;
}

function isPrivateIPv6(rawHostname) {
  // new URL() wraps IPv6 literals in brackets: [::1]. Strip them before comparing.
  const addr = (rawHostname.startsWith('[') && rawHostname.endsWith(']'))
    ? rawHostname.slice(1, -1)
    : rawHostname;
  const lower = addr.toLowerCase();
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true; // loopback
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;  // unspecified
  if (lower.startsWith('fe80:')) return true;          // fe80::/10 link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique local
  if (lower.startsWith('::ffff:')) return true;        // IPv4-mapped — could map to private IPv4
  return false;
}

/**
 * Returns { isIP: boolean, isPrivate: boolean } for a parsed URL hostname.
 * IPv4 literals match /^\d+\.\d+\.\d+\.\d+$/.
 * IPv6 literals are returned by new URL() inside brackets: [::1].
 */
function classifyHostname(hostname) {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return { isIP: true, isPrivate: isPrivateIPv4(hostname) };
  }
  if (hostname.startsWith('[')) {
    return { isIP: true, isPrivate: isPrivateIPv6(hostname) };
  }
  return { isIP: false, isPrivate: false };
}

// ---- Gate markers ------------------------------------------------------------

// LinkedIn serves several types of interstitial pages with HTTP 200 that
// contain no job content: cookie/privacy consent, login walls, and bot
// verification challenges. Any of these phrases in the extracted text means
// the page is a gate, not a job posting.
//
// Deliberately narrow — a false positive silently blocks a valid job posting.
// Removed: 'security check' / 'pemeriksaan keamanan' — too broad; security-engineer
//   job postings routinely say "must pass a background security check".
// Removed: 'cf-challenge' — that is a CSS class/HTML attribute, not visible text;
//   it is stripped by tag-removal and can never appear in extracted content.
const LINKEDIN_GATE_MARKERS = [
  // Legacy cookie/privacy consent
  'authwall',
  'LinkedIn menghargai privasi',
  'Kebijakan Cookie',
  'cookie policy',
  'We use cookies',
  'Kami menggunakan cookie',
  'Accept cookies',
  'Terima cookie',
  // Auth / identity gates
  'Join to apply',
  'Sign in to view',
  'Sign in to apply',
  'Masuk untuk melamar',
  'Masuk untuk melihat',
  // Bot / verification challenges — use visible page text, not HTML class names
  "Verify you're human",
  'Verifikasi bahwa Anda',
  'Verifikasi manusia',
  'Checking your browser before accessing',
];

// ---- Browser-like request headers -------------------------------------------
//
// These headers mirror a Chrome browser making a top-level navigation request.
// They reduce bot-fingerprinting by LinkedIn and other job boards that check
// for missing or inconsistent browser signals.
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.google.com/',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'cross-site',
  'sec-fetch-user': '?1',
  'Upgrade-Insecure-Requests': '1',
  'DNT': '1',
};

// ---- JSON-LD extraction ------------------------------------------------------
//
// LinkedIn (and most major job boards) embed structured job data as
// <script type="application/ld+json"> in the page head using the JobPosting
// schema (https://schema.org/JobPosting). This data is server-rendered for SEO
// even when the rest of the page is a JavaScript SPA, making it far more
// reliable than body-text extraction which only sees the pre-hydration shell.

// Decode the most common HTML entities that appear in JSON-LD description fields.
// schema.org descriptions are often HTML strings with encoded characters.
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtmlTags(str) {
  return decodeHtmlEntities(str.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Given an array of raw JSON-LD text strings, returns a formatted job
 * description string if any of them contains a JobPosting schema, or null.
 */
function extractJobFromJsonLd(jsonLdTexts) {
  for (const raw of jsonLdTexts) {
    let data;
    try { data = JSON.parse(raw.trim()); } catch { continue; }
    // JSON.parse('null') = null — accessing null['@graph'] throws TypeError.
    // Also skip primitives (number, boolean, string) — none are valid schema.org objects.
    if (!data || typeof data !== 'object') continue;

    // Some pages wrap multiple schema objects in an @graph array
    const items = Array.isArray(data['@graph']) ? data['@graph'] : [data];

    for (const item of items) {
      // Guard against null/non-object elements inside an @graph array
      if (!item || typeof item !== 'object') continue;
      // @type can be a string OR an array e.g. ["JobPosting","Thing"]
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      if (!types.includes('JobPosting')) continue;

      const parts = [];
      if (item.title) parts.push(`Job Title: ${item.title}`);

      // hiringOrganization can be a single object or an array
      const orgRaw = item.hiringOrganization;
      const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;
      if (org?.name) parts.push(`Company: ${org.name}`);

      const loc = item.jobLocation;
      const address = Array.isArray(loc) ? loc[0]?.address : loc?.address;
      if (address?.addressLocality) {
        const region = address.addressRegion ? `, ${address.addressRegion}` : '';
        parts.push(`Location: ${address.addressLocality}${region}`);
      }

      if (item.employmentType) parts.push(`Employment Type: ${item.employmentType}`);

      if (item.description) {
        const desc = stripHtmlTags(item.description).slice(0, 4500);
        if (desc) parts.push(desc);
      }

      // Need at least title/company + description to be useful
      if (parts.length >= 2) return parts.join('\n\n');
    }
  }
  return null;
}

// ---- LinkedIn guest API ------------------------------------------------------
//
// LinkedIn exposes an unauthenticated endpoint that returns a lightweight
// HTML fragment for most public job postings without login walls or SPA
// overhead. This is the most reliable extraction path for LinkedIn job links
// that contain a numeric job ID.

function extractLinkedInJobId(pathname) {
  const m = pathname.match(/\/jobs\/view\/(\d+)/);
  return m ? m[1] : null;
}

// 500 KB is generous for a lightweight API fragment; prevents RAM exhaustion
// if a slow/compromised server streams a large body quickly.
const GUEST_API_MAX_BYTES = 500_000;

async function fetchLinkedInGuestApi(jobId, signal) {
  const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  let res;
  try {
    // redirect:'manual' keeps us consistent with the main scraping path — we do not
    // blindly follow redirects to unknown destinations from this endpoint either.
    // A 3xx here (e.g. LinkedIn sending to /authwall) means the job isn't public;
    // return null so the handler falls through to full-page scraping.
    res = await fetch(apiUrl, { headers: FETCH_HEADERS, redirect: 'manual', signal });
  } catch { return null; }

  // Any redirect or error → not a usable response
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return null;

  let html;
  try { html = await res.text(); } catch { return null; }

  // Cap before running regexes — prevents RAM exhaustion on unexpectedly large bodies.
  if (html.length > GUEST_API_MAX_BYTES) html = html.slice(0, GUEST_API_MAX_BYTES);

  // Strip script/style blocks, all remaining tags, then decode HTML entities
  const cleaned = decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  ).replace(/\s{2,}/g, ' ').trim().slice(0, 5000);

  if (cleaned.length < 50) return null;
  if (LINKEDIN_GATE_MARKERS.some(m => cleaned.toLowerCase().includes(m.toLowerCase()))) return null;

  return cleaned;
}

// ---- Handler -----------------------------------------------------------------

export async function handleFetchJobUrl(request, env) {
  const ip = clientIp(request);
  const allowed = await checkRateLimit(env, env.RATE_LIMITER_FETCH, ip);
  if (!allowed) return rateLimitResponse(request, env);

  const { url } = await request.json().catch(() => ({}));

  if (!url || typeof url !== 'string') {
    return jsonResponse({ message: 'Parameter url wajib diisi' }, 400, request, env);
  }

  // Cap URL length before parsing — very long strings waste CPU and are never legitimate.
  if (url.length > 2048) {
    return jsonResponse({ message: 'URL terlalu panjang (maks 2.048 karakter).' }, 400, request, env);
  }

  // ── Step 1: Parse URL (catches malformed inputs early) ──────────────────────
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return jsonResponse({ message: 'URL tidak valid.' }, 400, request, env);
  }

  // ── Step 2: Enforce HTTPS ────────────────────────────────────────────────────
  if (parsed.protocol !== 'https:') {
    return jsonResponse({ message: 'URL harus menggunakan HTTPS.' }, 400, request, env);
  }

  const { hostname } = parsed;

  // ── Step 3: Block private / reserved IP addresses ───────────────────────────
  const { isIP, isPrivate } = classifyHostname(hostname);
  if (isIP && isPrivate) {
    log('fetch_job_url_blocked', { reason: 'private_ip', hostname, requesterIp: ip });
    return jsonResponse({ message: 'URL tidak diizinkan (IP internal).' }, 400, request, env);
  }

  // ── Step 4: Domain allowlist ─────────────────────────────────────────────────
  if (!isAllowedDomain(hostname)) {
    log('fetch_job_url_blocked', { reason: 'domain_not_allowed', hostname, requesterIp: ip });
    return jsonResponse(
      { message: 'Domain tidak diizinkan. Hanya link job board yang didukung (LinkedIn, JobStreet, Glints, dll.).' },
      400, request, env
    );
  }

  const isLinkedIn  = hostname === 'linkedin.com'      || hostname.endsWith('.linkedin.com');
  const isIndeed    = hostname === 'indeed.com'         || hostname.endsWith('.indeed.com');
  const isGlassdoor = hostname === 'glassdoor.com'      || hostname.endsWith('.glassdoor.com');
  const isJobStreet = hostname === 'jobstreet.co.id'    || hostname.endsWith('.jobstreet.co.id');

  // Shared abort controller covers all outbound requests in this handler call.
  // Abort after 10s — prevents the Worker from being occupied by a slow host.
  const fetchController = new AbortController();
  const fetchTimeoutId = setTimeout(() => fetchController.abort(), 10000);

  // ── Step 5 (LinkedIn only): Try guest API for direct job links ───────────────
  // The guest API endpoint returns a lightweight HTML fragment without auth
  // walls for most public job postings. Try it before full-page scraping.
  if (isLinkedIn) {
    const jobId = extractLinkedInJobId(parsed.pathname);
    if (jobId) {
      const guestText = await fetchLinkedInGuestApi(jobId, fetchController.signal);
      if (guestText) {
        clearTimeout(fetchTimeoutId);
        if (hasPromptInjection(guestText)) {
          log('fetch_job_url_blocked', { reason: 'injection_detected', url, requesterIp: ip });
          return jsonResponse({ message: 'Halaman mengandung konten yang tidak diizinkan. Coba copy-paste manual.' }, 422, request, env);
        }
        return jsonResponse({ job_desc: sanitizeForLLM(guestText) }, 200, request, env);
      }
      // Guest API failed or returned a gate page — fall through to full-page scraping
    }
  }

  // ── Step 6: Fetch the page ───────────────────────────────────────────────────
  // We use redirect:'manual' to intercept each redirect and re-validate the
  // destination URL against the domain allowlist before following it.
  const MAX_STREAM_BYTES = 2 * 1024 * 1024; // 2 MB hard cap on bytes streamed
  let pageRes;
  let currentUrl = url;
  try {
    // Legitimate job boards redirect at most once (e.g., HTTP→HTTPS or www-normalisation).
    for (let hop = 0; hop < 2; hop++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(currentUrl, {
        headers: FETCH_HEADERS,
        redirect: 'manual',
        signal: fetchController.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) break;

        // Resolve relative redirects against the current URL
        let nextUrl;
        try { nextUrl = new URL(location, currentUrl).href; } catch { break; }

        // Re-validate the redirect destination: must be HTTPS and on an allowed domain
        let nextParsed;
        try { nextParsed = new URL(nextUrl); } catch { break; }
        if (nextParsed.protocol !== 'https:' || !isAllowedDomain(nextParsed.hostname)) {
          log('fetch_job_url_blocked', { reason: 'redirect_off_allowlist', dest: nextParsed.hostname, requesterIp: ip });
          clearTimeout(fetchTimeoutId);
          return jsonResponse(
            { message: 'URL dialihkan ke domain yang tidak diizinkan. Coba copy-paste manual.' },
            422, request, env
          );
        }
        // Re-run the private-IP check on every redirect destination.
        const { isIP: nextIsIP, isPrivate: nextIsPrivate } = classifyHostname(nextParsed.hostname);
        if (nextIsIP && nextIsPrivate) {
          log('fetch_job_url_blocked', { reason: 'redirect_private_ip', dest: nextParsed.hostname, requesterIp: ip });
          clearTimeout(fetchTimeoutId);
          return jsonResponse(
            { message: 'URL dialihkan ke alamat yang tidak diizinkan. Coba copy-paste manual.' },
            422, request, env
          );
        }
        currentUrl = nextUrl;
        continue;
      }

      pageRes = res;
      break;
    }
  } catch (err) {
    clearTimeout(fetchTimeoutId);
    const msg = err.name === 'AbortError'
      ? 'URL membutuhkan waktu terlalu lama untuk diakses. Coba copy-paste manual.'
      : 'Tidak bisa mengakses URL tersebut. Coba copy-paste manual.';
    return jsonResponse({ message: msg }, 422, request, env);
  }
  clearTimeout(fetchTimeoutId);

  if (!pageRes) {
    return jsonResponse({ message: 'Tidak bisa mengakses URL tersebut. Coba copy-paste manual.' }, 422, request, env);
  }

  // Detect auth-gate redirects via the final resolved URL — checked before HTMLRewriter
  // extraction to avoid wasting CPU on pages that clearly have no JD content.
  if (isLinkedIn && (currentUrl.includes('/authwall') || currentUrl.includes('/login'))) {
    return jsonResponse({
      message: 'LinkedIn membutuhkan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
      linkedin_auth_required: true,
    }, 422, request, env);
  }
  if (isIndeed && (currentUrl.includes('/account/login') || currentUrl.includes('/auth/login'))) {
    return jsonResponse({
      message: 'Indeed memerlukan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
    }, 422, request, env);
  }
  if (isGlassdoor && (currentUrl.includes('/profile/login_input') || currentUrl.includes('/signin'))) {
    return jsonResponse({
      message: 'Glassdoor memerlukan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
    }, 422, request, env);
  }
  if (isJobStreet && currentUrl.includes('/oauth/')) {
    return jsonResponse({
      message: 'JobStreet memerlukan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
    }, 422, request, env);
  }

  if (!pageRes.ok) {
    return jsonResponse({ message: 'Halaman tidak bisa diakses. Coba copy-paste manual.' }, 422, request, env);
  }

  const contentType = pageRes.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return jsonResponse({ message: 'URL bukan halaman web (HTML). Coba copy-paste manual.' }, 422, request, env);
  }

  // M6: Enforce byte limit during streaming via TransformStream.
  // The Content-Length header is advisory — a malicious server can lie and send
  // more data. We terminate the stream once MAX_STREAM_BYTES have been read.
  let streamBytesRead = 0;
  const { readable: limitedReadable, writable: limitedWritable } = new TransformStream({
    transform(chunk, controller) {
      streamBytesRead += chunk.byteLength;
      if (streamBytesRead > MAX_STREAM_BYTES) {
        controller.terminate();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
  pageRes.body.pipeTo(limitedWritable).catch(() => {});
  const limitedRes = new Response(limitedReadable, { headers: pageRes.headers });

  // ── Step 7: Extract content via HTMLRewriter ─────────────────────────────────
  // Two things happen in one streaming pass:
  //   a) JSON-LD scripts are collected separately for structured job data
  //   b) Body text is accumulated as the body-text fallback
  const MAX_EXTRACT_BYTES = 500 * 1024;
  let extractedBytes = 0;
  const chunks = [];
  const jsonLdTexts = [];

  await new HTMLRewriter()
    // Collect each <script type="application/ld+json"> into its own buffer.
    // element() fires on the opening tag → pushes a new slot.
    // text() appends to the most recent slot (always the current script's).
    .on('script[type="application/ld+json"]', {
      element() {
        jsonLdTexts.push({ text: '' });
      },
      text(text) {
        if (jsonLdTexts.length > 0) {
          jsonLdTexts[jsonLdTexts.length - 1].text += text.text;
        }
      },
    })
    .on('script, style, noscript', {
      text() { /* drop */ },
    })
    .on('body', {
      text(text) {
        if (extractedBytes >= MAX_EXTRACT_BYTES) return;
        const t = text.text.replace(/\s+/g, ' ');
        if (t.trim()) {
          extractedBytes += t.length;
          chunks.push(t);
        }
      },
    })
    .transform(limitedRes)
    .text();

  // ── Step 8: Prefer JSON-LD structured data; fall back to body text ───────────
  const jsonLdJob = extractJobFromJsonLd(jsonLdTexts.map(b => b.text));
  let raw;
  if (jsonLdJob) {
    raw = jsonLdJob;
  } else {
    raw = chunks.join(' ').replace(/\s{3,}/g, '\n\n').trim();
  }

  if (!raw || raw.length < 50) {
    return jsonResponse({ message: 'Tidak bisa mengekstrak teks dari halaman ini. Coba copy-paste manual.' }, 422, request, env);
  }

  // LinkedIn gate detection — covers HTTP-200 interstitials that don't redirect.
  if (isLinkedIn && LINKEDIN_GATE_MARKERS.some(m => raw.toLowerCase().includes(m.toLowerCase()))) {
    return jsonResponse({
      message: 'Tidak dapat mengambil job posting dari LinkedIn. Silakan copy-paste bagian Requirements & Responsibilities secara manual.',
      linkedin_auth_required: true,
    }, 422, request, env);
  }

  // Content-based auth-gate detection for other platforms.
  const OTHER_PLATFORM_GATES = [
    {
      active: isIndeed,
      markers: ['Sign in to Indeed', 'Log in to Indeed', 'Create an Indeed account', '/account/login'],
      message: 'Indeed memerlukan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
    },
    {
      active: isGlassdoor,
      markers: ['Sign In | Glassdoor', 'Sign in to Glassdoor', 'glassdoor.com/profile/login_input'],
      message: 'Glassdoor memerlukan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
    },
    {
      active: isJobStreet,
      markers: ['Sign in to JobStreet', 'Masuk ke JobStreet', 'jobstreet.co.id/oauth/'],
      message: 'JobStreet memerlukan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
    },
  ];
  for (const { active, markers, message } of OTHER_PLATFORM_GATES) {
    if (active && markers.some(m => raw.toLowerCase().includes(m.toLowerCase()))) {
      return jsonResponse({ message }, 422, request, env);
    }
  }

  // JD content trimming — only needed for body-text fallback; JSON-LD is already clean.
  if (!jsonLdJob) {
    const JD_MARKERS = [
      'About the job', 'Job Description', 'Deskripsi pekerjaan',
      'Requirements', 'Qualifications', 'Responsibilities',
      'Kualifikasi', 'Persyaratan', 'Tanggung Jawab',
      'About this role', "What you'll do", "What we're looking for",
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
  }

  if (raw.length > 5000) raw = raw.slice(0, 5000);

  // Reject scraped content that contains injection patterns before sending to caller.
  if (hasPromptInjection(raw)) {
    log('fetch_job_url_blocked', { reason: 'injection_detected', url, requesterIp: ip });
    return jsonResponse({ message: 'Halaman mengandung konten yang tidak diizinkan. Coba copy-paste manual.' }, 422, request, env);
  }

  return jsonResponse({ job_desc: sanitizeForLLM(raw) }, 200, request, env);
}
