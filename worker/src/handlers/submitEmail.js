import { jsonResponse } from '../cors.js';
import { clientIp } from '../utils.js';
import { checkRateLimit, checkRateLimitKV, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';

export async function handleSubmitEmail(request, env) {
  const ip = clientIp(request);

  // Reuse payment rate limiter (5 req/min per IP)
  const [cfAllowed, kvRl] = await Promise.all([
    checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip),
    checkRateLimitKV(env, ip, 15, 60, 'submit_email'),
  ]);
  if (!cfAllowed || !kvRl.allowed) {
    const retryAfter = !kvRl.allowed ? (kvRl.retryAfter ?? 60) : 60;
    return rateLimitResponse(request, env, retryAfter, kvRl);
  }
  const withRl = res => addRateLimitHeaders(res, kvRl);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return withRl(jsonResponse({ message: 'Request body tidak valid' }, 400, request, env));
  }

  // Trim surrounding whitespace before any checks — avoids rejecting valid addresses
  // that arrive with accidental leading/trailing spaces from the client.
  const email = typeof body.email === 'string' ? body.email.trim() : '';

  if (!email) {
    return withRl(jsonResponse({ message: 'Email tidak valid' }, 400, request, env));
  }

  // Basic format + length check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return withRl(jsonResponse({ message: 'Format email tidak valid' }, 400, request, env));
  }

  // Store with 30-day TTL — keyed by timestamp + short UUID to avoid collisions
  const key = `email_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  await env.GASLAMAR_SESSIONS.put(
    key,
    JSON.stringify({ email: email.toLowerCase(), submitted_at: Date.now(), ip }),
    { expirationTtl: 86400 * 30 }
  );

  return withRl(jsonResponse({ ok: true }, 200, request, env));
}
