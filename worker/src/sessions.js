import { SESSION_TTL, SESSION_TTL_MULTI } from './constants.js';
import { sha256Full, logError } from './utils.js';

// Returns the appropriate TTL based on how many total credits the session has.
// Multi-credit sessions (total_credits > 1) get 30 days so users can come back
// later to use remaining credits via the emailed link.
export function getSessionTtl(data) {
  return (data && data.total_credits > 1) ? SESSION_TTL_MULTI : SESSION_TTL;
}

export async function createSession(env, sessionId, data) {
  await env.GASLAMAR_SESSIONS.put(
    sessionId,
    JSON.stringify({ ...data, created_at: Date.now() }),
    { expirationTtl: getSessionTtl(data) }
  );
}

export async function getSession(env, sessionId) {
  const raw = await env.GASLAMAR_SESSIONS.get(sessionId, { type: 'json' });
  return raw;
}

export async function updateSession(env, sessionId, updates) {
  const existing = await getSession(env, sessionId);
  if (!existing) return false;
  const merged = { ...existing, ...updates };
  await env.GASLAMAR_SESSIONS.put(
    sessionId,
    JSON.stringify(merged),
    { expirationTtl: getSessionTtl(merged) }
  );
  return true;
}

export async function deleteSession(env, sessionId) {
  await env.GASLAMAR_SESSIONS.delete(sessionId);
}

/**
 * Verify the X-Session-Secret header against the stored hash.
 * - If the session has no stored hash (legacy session), rejects — force re-auth.
 *   All sessions created after the secret feature shipped have a hash; legacy
 *   sessions are well past their 7/30-day KV TTL so none should remain in the wild.
 * - If the session has a hash but no secret is provided, returns false.
 * - Uses constant-time comparison for all paths to prevent timing attacks.
 */
export async function verifySessionSecret(session, providedSecret) {
  if (!session.session_secret_hash) {
    // C3 FIX: Legacy sessions (no hash) are permanently rejected — fail-closed.
    // Accepting them unconditionally was an indefinite auth-bypass for anyone
    // who held a pre-secret session token.
    logError('legacy_session_rejected', {});
    return false;
  }
  if (!providedSecret) return false;
  const hash = await sha256Full(providedSecret);
  // Always run the full constant-time loop regardless of length mismatch,
  // then fail if lengths differ — prevents hash-length oracle via timing.
  const refHash = session.session_secret_hash;
  const len = Math.max(hash.length, refHash.length);
  let diff = hash.length ^ refHash.length; // non-zero if lengths differ
  for (let i = 0; i < len; i++) {
    diff |= (hash.charCodeAt(i) || 0) ^ (refHash.charCodeAt(i) || 0);
  }
  return diff === 0;
}
