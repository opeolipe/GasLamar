import { jsonResponse } from '../cors.js';
import { clientIp, log } from '../utils.js';

export async function handleValidateSession(request, env) {
  const url = new URL(request.url);
  const cvKey = url.searchParams.get('cvKey');

  if (!cvKey || !cvKey.startsWith('cvtext_')) {
    return jsonResponse({ valid: false, reason: 'invalid_key' }, 400, request, env);
  }

  const stored = await env.GASLAMAR_SESSIONS.get(cvKey, { type: 'json' });
  if (!stored) {
    return jsonResponse({ valid: false, reason: 'not_found' }, 200, request, env);
  }

  const ip = clientIp(request);
  if (stored.ip && stored.ip !== ip) {
    log('validate_session_ip_mismatch', { ip, stored_ip: stored.ip });
    // Soft check — log only, don't reject display-only validation
  }

  return jsonResponse({ valid: true }, 200, request, env);
}
