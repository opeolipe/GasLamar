import { jsonResponse } from '../cors.js';
import { clientIp } from '../utils.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';

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
  const key = url.searchParams.get('key') || '';

  // Rate limit before any KV reads.
  const kvResult = await checkRateLimitKV(env, ip, 10, 60, 'get_scoring');
  if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60);

  // Validate key format — must be cvtext_ + exactly 64 hex chars (256-bit token).
  if (!key.startsWith('cvtext_') || key.length > 256) {
    return jsonResponse({ message: 'Key tidak valid', valid: false }, 400, request, env);
  }

  const stored = await env.GASLAMAR_SESSIONS.get(key, { type: 'json' });
  if (!stored || !stored.scoring) {
    return jsonResponse({ valid: false }, 404, request, env);
  }

  // Return scoring only — never cv_text, job_desc, ip, or inferred_role raw data.
  return jsonResponse({ valid: true, scoring: stored.scoring }, 200, request, env);
}
