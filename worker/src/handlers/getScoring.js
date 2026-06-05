import { jsonResponse } from '../cors.js';
import { clientIp, log } from '../utils.js';
import { checkRateLimit, checkRateLimitKVSession, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';
import { getCvKeyFromCookie, getSessionTokenFromCookie } from '../cookies.js';

/**
 * GET /get-scoring
 *
 * Returns the scoring result that was stored alongside the cvtext_ entry at /analyze time.
 * This lets hasil.html fetch the analysis result from the server instead of relying on a
 * large sessionStorage blob — the user can open the page in a new tab or refresh without
 * losing their data, as long as the 24h cvtext_ TTL has not expired.
 *
 * Security:
 *  - Requires the HttpOnly cv_key cookie set by /analyze. No cookie → 401.
 *  - ?key= query param is intentionally ignored — accepting caller-controlled keys
 *    would allow unauthenticated enumeration of the scoring KV namespace.
 *  - Only the scoring portion is returned; cv_text and job_desc are never exposed.
 *  - Rate-limited: 20 req/min with a valid cv_key cookie, 10 req/min by IP otherwise.
 */
export async function handleGetScoring(request, env) {
  const ip             = clientIp(request);
  const sessionToken   = getSessionTokenFromCookie(request);
  const cvKeyCookie    = getCvKeyFromCookie(request);

  // Header fallback for browsers that block cross-site cookies (e.g. Safari ITP).
  // Mirrors the check-session fallback — uses the same analysis_session_ KV lookup.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const headerSessionId = (() => {
    const h = request.headers.get('X-Analysis-Session');
    return (h && UUID_RE.test(h)) ? h : null;
  })();
  const effectiveSessionId = sessionToken ?? headerSessionId;

  // Use whichever auth token is present for the rate-limit bucket (authenticated callers get higher limit).
  // headerSessionId is included so Safari/ITP users on the header fallback get the same 20 req/min limit.
  const authToken      = sessionToken ?? cvKeyCookie ?? headerSessionId;

  // Atomic burst guard — CF native binding has no TOCTOU race, catches parallel floods.
  if (!await checkRateLimit(env, env.RATE_LIMITER_GET_SCORING, ip)) {
    return rateLimitResponse(request, env, 60);
  }

  // KV sliding-window counter — authenticated callers get 20 req/min; unauthenticated IPs get 10/min.
  const kvResult = await checkRateLimitKVSession(env, ip, authToken, 10, 20, 60, 'get_scoring');
  if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60, kvResult);
  const withRl = res => addRateLimitHeaders(res, kvResult);

  if (!effectiveSessionId && !cvKeyCookie) {
    return withRl(jsonResponse({ valid: false }, 401, request, env));
  }

  // Resolve the cvtext_ KV key from whichever auth is present.
  // New path: sessionToken (cookie or header) → analysis_session_ → cvKey
  // Legacy path: cv_key cookie contains the cvtext_ key directly.
  let key;
  if (effectiveSessionId) {
    const session = await env.GASLAMAR_SESSIONS.get(
      `analysis_session_${effectiveSessionId}`,
      { type: 'json' },
    );
    if (!session?.cvKey) {
      return withRl(jsonResponse({ valid: false }, 401, request, env));
    }
    key = session.cvKey;
  } else {
    key = cvKeyCookie;
  }

  let stored = await env.GASLAMAR_SESSIONS.get(key, { type: 'json' });
  if (!stored || !stored.scoring) {
    // cvtext_ entry may have been deleted after payment creation. Fall back to the
    // scoring snapshot preserved by /create-payment.
    const fallbackKey = `scoring_${key.slice('cvtext_'.length)}`;
    stored = await env.GASLAMAR_SESSIONS.get(fallbackKey, { type: 'json' });
  }
  if (!stored || !stored.scoring) {
    return withRl(jsonResponse({ valid: false }, 404, request, env));
  }
  if (stored.ip && stored.ip !== ip) {
    log('get_scoring_ip_mismatch', { ip, stored_ip: stored.ip });
  }

  // Return scoring only — never cv_text, job_desc, ip, or inferred_role raw data.
  return withRl(jsonResponse({ valid: true, scoring: stored.scoring }, 200, request, env));
}
