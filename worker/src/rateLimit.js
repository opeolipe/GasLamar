import { corsResponse } from './cors.js';
import { log, logError } from './utils.js';

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
        // Increment counter — preserve original TTL by recalculating remaining seconds
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
    return { allowed: true }; // fail open — don't block legitimate users on KV errors
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
