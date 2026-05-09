import { jsonResponse } from '../cors.js';
import { clientIp, log } from '../utils.js';

export async function handleValidateSession(request, env) {
  const url = new URL(request.url);
  const cvKey = url.searchParams.get('cvKey');

  // H7 FIX: Enforce a maximum length on cvKey before the KV lookup.
  // Without a cap, a 1 MB cvtext_<garbage> string wastes CPU on key processing
  // and KV round-trip overhead, enabling a low-effort CPU exhaustion attack.
  if (!cvKey || !cvKey.startsWith('cvtext_') || cvKey.length > 256) {
    return jsonResponse({ valid: false, reason: 'invalid_key' }, 400, request, env);
  }

  const stored = await env.GASLAMAR_SESSIONS.get(cvKey, { type: 'json' });
  if (!stored) {
    return jsonResponse({ valid: false, reason: 'not_found' }, 200, request, env);
  }

  const ip = clientIp(request);
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
