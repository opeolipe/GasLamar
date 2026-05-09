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
  // M5: Also block all-zeros (unspecified address) — same threat class as loopback.
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
  // HTTP is blocked unconditionally — we only retrieve content over TLS.
  // Non-http(s) schemes (file:, ftp:, data:, …) are also blocked here.
  if (parsed.protocol !== 'https:') {
    return jsonResponse({ message: 'URL harus menggunakan HTTPS.' }, 400, request, env);
  }

  const { hostname } = parsed;

  // ── Step 3: Block private / reserved IP addresses ───────────────────────────
  // Defense layer 1 — catches direct IP-address SSRF attempts even before the
  // allowlist is consulted. We use the hostname extracted by the URL parser, so
  // encoding tricks (%31%32%37 for 127) are already normalised.
  const { isIP, isPrivate } = classifyHostname(hostname);
  if (isIP && isPrivate) {
    log('fetch_job_url_blocked', { reason: 'private_ip', hostname, requesterIp: ip });
    return jsonResponse({ message: 'URL tidak diizinkan (IP internal).' }, 400, request, env);
  }

  // ── Step 4: Domain allowlist ─────────────────────────────────────────────────
  // Defense layer 2 — only known job board domains (and their subdomains) are
  // allowed. Because we test parsed.hostname (not the raw URL string), common
  // bypass patterns are neutralised automatically by the URL parser:
  //
  //   https://linkedin.com@evil.com   → hostname = evil.com      ✗
  //   https://linkedin.com.evil.com   → hostname = linkedin.com.evil.com  ✗
  //   https://evil.com/linkedin.com   → hostname = evil.com      ✗
  //
  // Public bare IPs (not caught by step 3) also fail here since they don't
  // match any domain in the allowlist.
  if (!isAllowedDomain(hostname)) {
    log('fetch_job_url_blocked', { reason: 'domain_not_allowed', hostname, requesterIp: ip });
    return jsonResponse(
      { message: 'Domain tidak diizinkan. Hanya link job board yang didukung (LinkedIn, JobStreet, Glints, dll.).' },
      400, request, env
    );
  }

  const isLinkedIn = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');

  // ── Step 5: Fetch the page ───────────────────────────────────────────────────
  // All SSRF checks have passed; make the outbound request.
  // Abort after 10s — prevents the Worker from being occupied by a slow host.
  //
  // We use redirect:'manual' to intercept each redirect and re-validate the
  // destination URL against the domain allowlist before following it. This
  // prevents an open-redirect on any allowlisted job board from being used
  // to proxy arbitrary external URLs through this endpoint.
  const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
  };

  const fetchController = new AbortController();
  const fetchTimeoutId = setTimeout(() => fetchController.abort(), 10000);

  let pageRes;
  let currentUrl = url;
  try {
    // C2 FIX: Reduced from 5 to 2 hops — legitimate job boards redirect at most once
    // (e.g., HTTP→HTTPS or www-normalisation). More hops increase SSRF surface.
    for (let hop = 0; hop < 2; hop++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(currentUrl, {
        headers: FETCH_HEADERS,
        redirect: 'manual',
        signal: fetchController.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) break; // no Location header — treat as terminal response

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
        // C2 FIX: Also re-run the private-IP check on every redirect destination.
        // The initial check only covers the user-supplied URL, not redirect hops.
        // A compromised allowlisted server could redirect to an internal IP address.
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

  // LinkedIn redirects unauthenticated requests to /authwall — detect the redirect
  // before wasting CPU on HTMLRewriter extraction.
  // currentUrl holds the final resolved URL after manual redirect chain.
  if (isLinkedIn && (currentUrl.includes('/authwall') || currentUrl.includes('/login'))) {
    return jsonResponse({
      message: 'LinkedIn membutuhkan login untuk melihat lowongan ini. Silakan copy-paste deskripsi pekerjaan secara manual.',
      linkedin_auth_required: true,
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
  // more data. We terminate the stream once MAX_STREAM_BYTES have been read,
  // regardless of what the server claims. The 500KB extraction cap below is a
  // second, independent layer that limits what we actually store.
  const MAX_STREAM_BYTES = 2 * 1024 * 1024; // 2 MB hard cap on bytes streamed
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

  // Extract text using HTMLRewriter — drop script/style noise, collect body text.
  // Cap total extracted bytes at 500KB; further chunks are dropped.
  const MAX_EXTRACT_BYTES = 500 * 1024;
  let extractedBytes = 0;
  const chunks = [];
  await new HTMLRewriter()
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

  let raw = chunks.join(' ').replace(/\s{3,}/g, '\n\n').trim();

  if (!raw || raw.length < 50) {
    return jsonResponse({ message: 'Tidak bisa mengekstrak teks dari halaman ini. Coba copy-paste manual.' }, 422, request, env);
  }

  // LinkedIn gate detection — covers two distinct interstitials served with HTTP 200:
  //   1. Auth wall (body contains "authwall")
  //   2. Cookie / privacy consent page (body contains consent-specific phrases)
  // Both cases return no useful JD content; reject early with a clear user message.
  const LINKEDIN_GATE_MARKERS = [
    'authwall',
    'LinkedIn menghargai privasi',
    'Kebijakan Cookie',
    'cookie policy',
    'We use cookies',
    'Kami menggunakan cookie',
    'Accept cookies',
    'Terima cookie',
  ];
  if (isLinkedIn && LINKEDIN_GATE_MARKERS.some(m => raw.toLowerCase().includes(m.toLowerCase()))) {
    return jsonResponse({
      message: 'Tidak dapat mengambil job posting dari LinkedIn. Silakan copy-paste bagian Requirements & Responsibilities secara manual.',
      linkedin_auth_required: true,
    }, 422, request, env);
  }

  // LinkedIn-specific: JD content appears after significant nav text.
  // Trim to the first known JD section marker when it appears in the first 60 % of the text.
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

  if (raw.length > 5000) raw = raw.slice(0, 5000);

  // Reject scraped content that contains injection patterns before sending to caller.
  // Unlikely from allowlisted job boards, but defence-in-depth against a compromised
  // page or future redirect to an attacker-controlled allowed subdomain.
  if (hasPromptInjection(raw)) {
    log('fetch_job_url_blocked', { reason: 'injection_detected', url, requesterIp: ip });
    return jsonResponse({ message: 'Halaman mengandung konten yang tidak diizinkan. Coba copy-paste manual.' }, 422, request, env);
  }

  return jsonResponse({ job_desc: sanitizeForLLM(raw) }, 200, request, env);
}
