/**
 * Cookie utilities for session management.
 *
 * COOKIE SECURITY MODEL:
 *   All session cookies use the __Host- prefix, which enforces:
 *     - Secure flag (HTTPS-only transport)
 *     - Path=/ (no subpath scope creep)
 *     - No Domain attribute (host-only; not shared with subdomains)
 *
 *   SameSite=Strict prevents cross-site request forgery at the cookie layer.
 *   The Worker and frontend share the gaslamar.com domain via Cloudflare routes,
 *   so same-site restrictions are satisfied in production. Staging environments
 *   that cross origins must use token-based flows (e.g. exchangeToken.js) rather
 *   than relying on automatic cookie attachment.
 *
 * CSRF SECURITY ASSESSMENT:
 *
 *   1. SameSite=Strict: cookies are never attached to cross-site requests.
 *
 *   2. Origin enforcement: router.js rejects unsafe methods from unlisted
 *      browser Origins before handlers read request bodies or mutate data.
 *
 *   3. JSON-only API: All state-changing POST bodies use Content-Type:application/json.
 *      Browsers require a CORS pre-flight for non-simple content types.
 *
 *   4. HttpOnly: JavaScript cannot read these cookies, blocking XSS exfiltration.
 *
 *   Conclusion: __Host- prefix + SameSite=Strict + HttpOnly + Origin enforcement +
 *   JSON bodies form a defence-in-depth CSRF/XSS control stack.
 */

/** Parse a Cookie header string into a key→value plain object. */
export function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const out = {};
  let count = 0;
  for (const pair of cookieHeader.split(';')) {
    // M3: Cap at 100 cookies — a header with 10 000 semicolons causes O(n) allocation.
    if (++count > 100) break;
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Extract and validate the __Host-session_id cookie from a request.
 * Returns the session ID string (starting with "sess_") or null.
 */
export function getSessionIdFromCookie(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const id = cookies['__Host-session_id'];
  // M4: Enforce a maximum length — session IDs are "sess_" + UUID (41 chars max).
  // A 1 MB cookie value would waste CPU on prefix check and downstream KV lookup.
  if (id && id.startsWith('sess_') && id.length <= 64) return id;
  return null;
}

/**
 * Extract and validate the short-lived analysis key cookie used to gate hasil.html.
 * Reads the legacy `cv_text_key` name only — new sessions use `__Host-cv_key`.
 * The value is a cvtext_ token; it is still IP-bound in KV before any sensitive
 * operation can use it.
 */
export function getCvTextKeyFromCookie(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const key = cookies.cv_text_key;
  if (key && /^cvtext_[0-9a-f]{64}$/.test(key)) return key;
  return null;
}

/**
 * Build a Set-Cookie value for the __Host-session_id cookie.
 * Max-Age matches the session KV TTL: 7 days (single/coba) or 30 days (multi-credit).
 *
 * __Host- prefix enforces: Secure, Path=/, no Domain — host-only binding.
 * SameSite=Strict prevents cross-site cookie attachment (CSRF defence layer 1).
 *
 * @param {string}  sessionId
 * @param {boolean} isMulti  — true for 3-Pack / Job Hunt Pack
 */
export function makeSessionCookie(sessionId, isMulti = false) {
  const maxAge = isMulti ? 2592000 : 604800;
  return `__Host-session_id=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * Build a short-lived HttpOnly cookie for the analysis result page (legacy name).
 * New sessions use __Host-cv_key; this builder is retained only for backward compat
 * if a legacy client sends cv_text_key.
 */
export function makeCvTextKeyCookie(cvTextKey) {
  return `cv_text_key=${cvTextKey}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
}

/** Build a cookie that immediately clears the __Host-session_id cookie (Max-Age=0). */
export function clearSessionCookie() {
  return '__Host-session_id=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

/**
 * Build a Set-Cookie value for the __Host-cv_key cookie.
 * Max-Age matches the cvtext_ KV entry expirationTtl in analyze.js (24h).
 * HttpOnly prevents XSS from reading the analysis-session token.
 * __Host- prefix enforces host-only binding (no Domain, Path=/, Secure required).
 *
 * @param {string} cvKey — the cvtext_<64-hex> token returned by /analyze
 */
export function makeCvKeyCookie(cvKey) {
  return `__Host-cv_key=${cvKey}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
}

/**
 * Extract and validate the __Host-cv_key cookie from a request.
 * Returns the cv_key string (starting with "cvtext_" + 64 hex chars) or null.
 */
export function getCvKeyFromCookie(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const key = cookies['__Host-cv_key'];
  if (key && /^cvtext_[0-9a-f]{64}$/.test(key)) return key;
  return null;
}

/**
 * Build a Set-Cookie value for the sessionToken cookie (analysis session).
 * Stores a UUID that points to the analysis_session_ KV entry (never the cv_text directly).
 * Max-Age matches the analysis session KV TTL (24h).
 *
 * SameSite=None; Partitioned (CHIPS): works for staging cross-domain
 * (staging.gaslamar.pages.dev → api-staging.gaslamar.com).
 * In production (gaslamar.com first-party) the cookie is same-site so SameSite
 * attribute is irrelevant — it is always sent.
 */
export function makeSessionTokenCookie(sessionId) {
  return `sessionToken=${sessionId}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400; Partitioned`;
}

/**
 * Extract and validate the sessionToken cookie from a request.
 * Returns the session ID string (UUID format) or null.
 */
export function getSessionTokenFromCookie(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const id = cookies.sessionToken;
  // UUID v4: 8-4-4-4-12 hex groups — max 36 chars
  if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id;
  return null;
}
