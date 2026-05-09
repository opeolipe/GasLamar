import { jsonResponse } from '../cors.js';

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

  // IP check removed: this endpoint is display-only and IPs legitimately change
  // (mobile networks, VPNs). A log-only check creates false security confidence
  // without blocking anything. Actual access control is enforced by session_secret
  // on the /generate and /get-session endpoints.
  return jsonResponse({ valid: true }, 200, request, env);
}
