import { SESSION_TTL, SESSION_TTL_MULTI } from './constants.js';
import { sha256Full } from './utils.js';

// Returns the appropriate TTL based on how many total credits the session has.
// Multi-credit sessions (total_credits > 1) get 7 days so users can come back
// the next day (or later) to use remaining credits via the emailed link.
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
 * - If the session has no stored hash (legacy session), returns true (backward compat).
 * - If the session has a hash but no secret is provided, returns false.
 * - Uses constant-time comparison to prevent timing attacks.
 */
export async function verifySessionSecret(session, providedSecret) {
  if (!session.session_secret_hash) return true; // legacy session — no hash stored
  if (!providedSecret) return false;
  const hash = await sha256Full(providedSecret);
  if (hash.length !== session.session_secret_hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ session.session_secret_hash.charCodeAt(i);
  }
  return diff === 0;
}
