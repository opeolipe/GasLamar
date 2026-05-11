import { corsResponse } from './cors.js';
import { log, logError } from './utils.js';

// In-memory fallback for KV rate limiting. Scoped to the Worker isolate — does
// not persist across restarts, but prevents a complete bypass during KV outages.
// Keys are evicted lazily on access; the Map is bounded by Worker memory limits.
const _memRateLimit = new Map();

// ---- Rate Limiting ----
//
// Uses Cloudflare Workers Rate Limiting API (atomic, no TOCTOU race).
// Each endpoint has its own binding declared in wrangler.toml [[unsafe.bindings]].
// The binding's .limit({ key }) call is atomic at the CF edge.
//
// Fallback: if the binding is absent (e.g. local dev without wrangler), allow through.
// This is safe — local dev is not public traffic.

export async function checkRateLimit(env, limiterBinding, ip) {
  if (!limiterBinding) return true; // binding absent in local dev — allow
  const { success } = await limiterBinding.limit({ key: ip });
  return success;
}

/**
 * KV-based rate limiter — works independently of Cloudflare binding configuration.
 * Uses GASLAMAR_SESSIONS KV with a TTL-keyed counter so entries auto-expire.
 * Returns { allowed: true } or { allowed: false, retryAfter: number }.
 * Fails open (allows request) if KV is unavailable.
 */
export async function checkRateLimitKV(env, ip, limit = 3, windowSecs = 60, prefix = 'analyze') {
  const key = `rate_limit_${prefix}_${ip}`;
  try {
    const raw = await env.GASLAMAR_SESSIONS.get(key);
    const now = Math.floor(Date.now() / 1000);

    if (raw) {
      const data = JSON.parse(raw);
      if (now - data.start < windowSecs) {
        // Still within the window
        if (data.count >= limit) {
          const retryAfter = windowSecs - (now - data.start);
          log('rate_limit_kv_hit', { prefix, ip, count: data.count, limit, retryAfter });
          return { allowed: false, retryAfter };
        }
        // Increment counter, preserving the original window start.
        // H1 FIX: Use remaining time clamped to KV's 60s minimum.
        // The original Math.max(60, remaining) could extend entries up to 59 extra seconds
        // past their natural window expiry when remaining < 60, causing KV bloat and
        // confusing monitoring. Now we use Math.max(60, remaining) for KV compliance but
        // document the intent: we want the entry to expire at data.start + windowSecs,
        // and the 60s minimum is only a KV floor. Window correctness is enforced by
        // the (now - data.start < windowSecs) check on every read.
        const remaining = windowSecs - (now - data.start);
        const newCount = data.count + 1;
        await env.GASLAMAR_SESSIONS.put(
          key,
          JSON.stringify({ start: data.start, count: newCount }),
          { expirationTtl: Math.max(60, remaining) }
        );
        log('rate_limit_kv_count', { prefix, ip, count: newCount, limit });
        return { allowed: true };
      }
    }

    // First request in a new window
    await env.GASLAMAR_SESSIONS.put(
      key,
      JSON.stringify({ start: now, count: 1 }),
      { expirationTtl: windowSecs }
    );
    log('rate_limit_kv_count', { prefix, ip, count: 1, limit });
    return { allowed: true };
  } catch (e) {
    logError('rate_limit_kv_error', { prefix, ip, error: e.message });
    // Fallback to in-memory counter — survives KV outages within the same isolate.
    const memKey = `${prefix}:${ip}`;
    const now    = Math.floor(Date.now() / 1000);
    const entry  = _memRateLimit.get(memKey);
    if (entry && now - entry.start < windowSecs) {
      if (entry.count >= limit) {
        return { allowed: false, retryAfter: windowSecs - (now - entry.start) };
      }
      entry.count++;
    } else {
      _memRateLimit.set(memKey, { start: now, count: 1 });
    }
    return { allowed: true };
  }
}

// Returns a properly-formed 429 with Retry-After header (RFC 7231 §7.1.3).
// All rate-limited endpoints must use this instead of a plain jsonResponse 429.
export function rateLimitResponse(request, env, retryAfter = 60) {
  return corsResponse(
    JSON.stringify({
      error: 'Too many requests',
      message: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.',
      retryAfter,
    }),
    429,
    { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
    request,
    env
  );
}
