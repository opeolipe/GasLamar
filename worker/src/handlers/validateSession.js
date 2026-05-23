import { jsonResponse } from '../cors.js';
import { clientIp, log } from '../utils.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';

export async function handleValidateSession(request, env) {
  const ip = clientIp(request);
  const rl = await checkRateLimitKV(env, ip, 20, 60, 'validate_session');
  if (!rl.allowed) return rateLimitResponse(request, env, rl.retryAfter ?? 60);

  const url = new URL(request.url);
  const cvKey = url.searchParams.get('cvKey');

  // Strict format: exactly "cvtext_" + 64 lowercase hex chars (256-bit random token).
  // Mirrors the validation in getScoring.js — prevents oversized KV key lookups.
  if (!cvKey || !/^cvtext_[0-9a-f]{64}$/.test(cvKey)) {
    return jsonResponse({ valid: false, reason: 'invalid_key' }, 400, request, env);
  }

  let stored = await env.GASLAMAR_SESSIONS.get(cvKey, { type: 'json' });
  if (!stored) {
    // cvtext_ entry may have been consumed by /create-payment (which deletes it after
    // storing a scoring snapshot under scoring_<token>). Check the snapshot so that
    // users returning from Mayar after a cancel/back-navigation are not incorrectly
    // redirected to access.html — their scoring data is still present and they can
    // use the cached invoice URL or re-upload if needed.
    const fallbackKey = `scoring_${cvKey.slice('cvtext_'.length)}`;
    const fallback = await env.GASLAMAR_SESSIONS.get(fallbackKey);
    if (fallback) {
      log('validate_session_scoring_fallback', { ip: clientIp(request) });
      return jsonResponse({ valid: true, note: 'scoring_snapshot' }, 200, request, env);
    }
    return jsonResponse({ valid: false, reason: 'not_found' }, 404, request, env);
  }

  if (stored.ip && stored.ip !== ip) {
    log('validate_session_ip_mismatch', { ip, stored_ip: stored.ip });
    // Intentional log-only: this endpoint is display-only (scoring page freshness check).
    // IPs legitimately change with mobile handoffs, carrier-grade NAT, IPv4→IPv6 transitions,
    // and VPNs — rejecting here would silently break the scoring page for a large portion
    // of mobile users.  The authoritative IP-binding check is in /create-payment, which is
    // the only endpoint with real security consequences.
  }

  return jsonResponse({ valid: true }, 200, request, env);
}
