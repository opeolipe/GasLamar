import { jsonResponse } from '../cors.js';
import { clientIp, log } from '../utils.js';
import { checkRateLimit, checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';
import { getCvKeyFromCookie } from '../cookies.js';

/**
 * GET /get-scoring?key=cvtext_<token>
 *
 * Returns the scoring result that was stored alongside the cvtext_ entry at /analyze time.
 * This lets hasil.html fetch the analysis result from the server instead of relying on a
 * large sessionStorage blob — the user can open the page in a new tab or refresh without
 * losing their data, as long as the 24h cvtext_ TTL has not expired.
 *
 * Security:
 *  - Only the scoring portion is returned; cv_text and job_desc are never exposed.
 *  - The cvtext_ key is a 256-bit random token — unguessable by enumeration.
 *  - Rate-limited 10 req/min per IP (same window as /validate-session).
 */
export async function handleGetScoring(request, env) {
  const ip  = clientIp(request);
  const url = new URL(request.url);
  // Atomic burst guard — CF native binding has no TOCTOU race, catches parallel floods.
  if (!await checkRateLimit(env, env.RATE_LIMITER_GET_SCORING, ip)) {
    return rateLimitResponse(request, env, 60);
  }

  // KV sliding-window counter — secondary layer, survives CF binding absence.
  const kvResult = await checkRateLimitKV(env, ip, 10, 60, 'get_scoring');
  if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60);

  // Prefer the HttpOnly cv_key cookie (set by /analyze after the cookie migration).
  // Fall back to the ?key= query param for sessions established before the migration.
  const key = getCvKeyFromCookie(request) || url.searchParams.get('key') || '';

  // Validate key format: exactly "cvtext_" (7 chars) + 64 lowercase hex chars = 71 chars total.
  if (!/^cvtext_[0-9a-f]{64}$/.test(key)) {
    return jsonResponse({ message: 'Key tidak valid', valid: false }, 400, request, env);
  }

  let stored = await env.GASLAMAR_SESSIONS.get(key, { type: 'json' });
  if (!stored || !stored.scoring) {
    // cvtext_ entry may have been deleted after payment creation. Fall back to the
    // scoring snapshot preserved by /create-payment so hasil.html can still render
    // if the user returns to /hasil after a Mayar redirect (cancel or back-navigation).
    const fallbackKey = `scoring_${key.slice('cvtext_'.length)}`;
    stored = await env.GASLAMAR_SESSIONS.get(fallbackKey, { type: 'json' });
  }
  if (!stored || !stored.scoring) {
    return jsonResponse({ valid: false }, 404, request, env);
  }
  // IP mismatch is intentionally non-blocking here — same rationale as validateSession.js:
  // mobile users, carrier-grade NAT, and VPN users legitimately change IPs between
  // /analyze and /get-scoring. The cvtext_ key is a 256-bit random token so it is
  // already unguessable; IP binding adds friction without meaningful security benefit
  // for a read-only scoring endpoint. Log for abuse visibility only.
  if (stored.ip && stored.ip !== ip) {
    log('get_scoring_ip_mismatch', { ip, stored_ip: stored.ip });
  }

  // Return scoring only — never cv_text, job_desc, ip, or inferred_role raw data.
  return jsonResponse({ valid: true, scoring: stored.scoring }, 200, request, env);
}
