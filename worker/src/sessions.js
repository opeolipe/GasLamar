import { SESSION_TTL, SESSION_TTL_MULTI } from './constants.js';

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
