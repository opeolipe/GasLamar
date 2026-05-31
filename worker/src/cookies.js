/**
 * Cookie utilities for session management.
 *
 * NOTE on SameSite=None:
 *   The Worker and frontend share the gaslamar.com domain via Cloudflare routes.
 *   SameSite=None;Secure is retained for compatibility across both production
 *   (gaslamar.com) and staging (api-staging.gaslamar.com) environments where
 *   the cookie domain may still differ from the Pages subdomain.
 *
 * CSRF SECURITY ASSESSMENT:
 *
 *   1. Origin enforcement: router.js rejects unsafe methods from unlisted
 *      browser Origins before handlers read request bodies or mutate data.
 *      This is required because CORS alone does not stop cross-site form/no-cors
 *      POSTs from being sent with cookies.
 *
 *   2. JSON-only API: All state-changing POST bodies use Content-Type:application/json.
 *      Browsers require a CORS pre-flight for non-simple content types, and the
 *      route-level Origin check also blocks simple cross-site fallbacks.
 *      No endpoint accepts application/x-www-form-urlencoded or multipart/form-data.
 *
 *   3. HttpOnly cookie: The session_id cookie is HttpOnly — a cross-site script cannot
 *      read it, only the browser sends it automatically with credentialed requests.
 *
 *   Conclusion: explicit Origin enforcement + JSON bodies + HttpOnly cookies are
 *   the active CSRF controls for this cross-origin Worker/Pages deployment.
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
 * Extract and validate the session_id cookie from a request.
 * Returns the session ID string (starting with "sess_") or null.
 */
export function getSessionIdFromCookie(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const id = cookies.session_id;
  // M4: Enforce a maximum length — session IDs are "sess_" + UUID (41 chars max).
  // A 1 MB cookie value would waste CPU on prefix check and downstream KV lookup.
  if (id && id.startsWith('sess_') && id.length <= 64) return id;
  return null;
}

/**
 * Extract and validate the short-lived analysis key cookie used to gate hasil.html.
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
 * Build a Set-Cookie value for the session_id cookie.
 * Max-Age matches the session KV TTL: 7 days (single/coba) or 30 days (multi-credit).
 *
 * @param {string}  sessionId
 * @param {boolean} isMulti  — true for 3-Pack / Job Hunt Pack
 */
export function makeSessionCookie(sessionId, isMulti = false) {
  const maxAge = isMulti ? 2592000 : 604800;
  // SameSite=None; Secure is safe here: Cloudflare Workers only accept HTTPS connections,
  // so the Secure flag is always satisfied. No explicit HTTPS check is needed.
  //
  // Partitioned (CHIPS) enables the cookie to be stored in cross-site contexts
  // (e.g. staging.gaslamar.pages.dev → api-staging.gaslamar.com) where browsers
  // that block unpartitioned third-party cookies would otherwise discard it.
  // In same-site / first-party contexts (production: gaslamar.com → gaslamar.com)
  // the Partitioned attribute is ignored by the browser per the CHIPS spec.
  return `session_id=${sessionId}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}; Partitioned`;
}

/** Build a short-lived HttpOnly cookie for the analysis result page. */
export function makeCvTextKeyCookie(cvTextKey) {
  return `cv_text_key=${cvTextKey}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400`;
}

/** Build a cookie that immediately clears the session (Max-Age=0). */
export function clearSessionCookie() {
  // Partitioned must match the original Set-Cookie to clear the same cookie bucket.
  return 'session_id=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0; Partitioned';
}
