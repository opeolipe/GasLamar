/**
 * Cookie utilities for session management.
 *
 * NOTE on SameSite=None:
 *   The Worker runs on a different registrable domain from the frontend
 *   (gaslamar-worker.carolineratuolivia.workers.dev vs gaslamar.com).
 *   SameSite=Strict/Lax would block the cookie from being included in
 *   cross-site fetch requests that use credentials:'include'. SameSite=None;Secure
 *   is required for cross-domain cookie transmission.
 *
 * CSRF SECURITY ASSESSMENT — no CSRF tokens needed:
 *
 *   1. CORS allowlist: Access-Control-Allow-Origin is set from a strict allowlist
 *      (PRODUCTION_ORIGINS / STAGING_ORIGINS in constants.js — never '*'). Browsers block credentialed
 *      pre-flight responses from any other origin, so a cross-site attacker page
 *      cannot successfully send credentialed requests to this Worker.
 *
 *   2. JSON-only API: All state-changing POST bodies use Content-Type:application/json.
 *      Browsers require a CORS pre-flight for non-simple content types, giving the
 *      allowlist check a chance to block attacker origins before any body is read.
 *      No endpoint accepts application/x-www-form-urlencoded or multipart/form-data.
 *
 *   3. X-Session-Secret header: Sensitive operations (/generate, /session/ping) require
 *      this custom header. Cross-origin pages cannot set custom request headers without
 *      a pre-flight that CORS will block.
 *
 *   4. HttpOnly cookie: The session_id cookie is HttpOnly — a cross-site script cannot
 *      read it, only the browser sends it automatically with credentialed requests.
 *
 *   Conclusion: the combination of strict CORS + JSON bodies + custom header provides
 *   CSRF protection equivalent to SameSite=Strict in a same-origin deployment.
 *   Traditional double-submit or synchronizer CSRF tokens are not required.
 */

/** Parse a Cookie header string into a key→value plain object. */
export function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const out = {};
  for (const pair of cookieHeader.split(';')) {
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
  if (id && id.startsWith('sess_')) return id;
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
  return `session_id=${sessionId}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}

/** Build a cookie that immediately clears the session (Max-Age=0). */
export function clearSessionCookie() {
  return 'session_id=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0';
}
