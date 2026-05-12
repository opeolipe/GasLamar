import { jsonResponse, jsonResponseWithCookie } from '../cors.js';
import { clientIp, log, sha256Full } from '../utils.js';
import { TIER_CREDITS, VALID_TIERS } from '../constants.js';
import { checkRateLimitKV } from '../rateLimit.js';
import { createSession } from '../sessions.js';
import { makeSessionCookie } from '../cookies.js';

/**
 * POST /bypass-payment — sandbox-only payment bypass for E2E testing.
 *
 * Skips Mayar invoice creation and immediately creates a 'paid' session.
 * Returns 404 in production so it is completely unreachable in live traffic.
 *
 * Usage (staging / local):
 *   curl -X POST https://<worker>/bypass-payment \
 *     -H 'Content-Type: application/json' \
 *     -d '{"tier":"single","cv_text_key":"cvtext_<key from /analyze>"}'
 *   → { "session_id": "sess_..." }  +  Set-Cookie: session_id=...
 *
 * Then navigate to /download.html — the cookie carries the session automatically.
 */
export async function handleBypassPayment(request, env) {
  if (env.ENVIRONMENT === 'production') {
    return jsonResponse({ message: 'Not found' }, 404, request, env);
  }

  // Defense-in-depth: require a pre-shared secret even in sandbox/staging so that
  // a misconfigured ENVIRONMENT alone cannot expose this endpoint.  Set
  // BYPASS_PAYMENT_SECRET via `wrangler secret put BYPASS_PAYMENT_SECRET` for any
  // non-production environment that needs this endpoint.  When absent, the endpoint
  // is still unreachable even if ENVIRONMENT is wrong.
  const bypassSecret = env.BYPASS_PAYMENT_SECRET;
  if (!bypassSecret) {
    return jsonResponse({ message: 'Not found' }, 404, request, env);
  }

  // Defense-in-depth rate limit — protects against accidental misconfiguration where
  // ENVIRONMENT is not 'production' on a live environment. 20 req/min is generous
  // enough for automated E2E suites but limits any unintended exposure.
  const ip = clientIp(request);
  const rl = await checkRateLimitKV(env, ip, 20, 60, 'bypass_payment');
  if (!rl.allowed) {
    return jsonResponse({ message: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, 429, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { tier, cv_text_key, bypass_secret: providedBypassSecret } = body;

  // Constant-time comparison for bypass secret to prevent timing attacks.
  const encoder = new TextEncoder();
  const envBytes = encoder.encode(bypassSecret);
  const reqBytes = encoder.encode(typeof providedBypassSecret === 'string' ? providedBypassSecret : '');
  let secretDiff = envBytes.length ^ reqBytes.length;
  const maxLen = Math.max(envBytes.length, reqBytes.length);
  for (let i = 0; i < maxLen; i++) secretDiff |= (envBytes[i] ?? 0) ^ (reqBytes[i] ?? 0);
  if (secretDiff !== 0) {
    return jsonResponse({ message: 'Not found' }, 404, request, env);
  }

  if (!tier || !cv_text_key) {
    return jsonResponse({ message: 'Data tidak lengkap' }, 400, request, env);
  }

  if (!VALID_TIERS.includes(tier)) {
    return jsonResponse({ message: 'Tier tidak valid' }, 400, request, env);
  }

  if (!cv_text_key.startsWith('cvtext_')) {
    return jsonResponse({ message: 'cv_text_key tidak valid' }, 400, request, env);
  }

  const stored = await env.GASLAMAR_SESSIONS.get(cv_text_key, { type: 'json' });
  if (!stored || !stored.text) {
    return jsonResponse({ message: 'Sesi analisis kedaluwarsa. Ulangi upload CV.' }, 400, request, env);
  }

  const sessionId = `sess_${crypto.randomUUID()}`;
  const credits = TIER_CREDITS[tier] ?? 1;

  // Callers must supply their own session_secret so they can use it in subsequent
  // /get-session and /generate calls. A server-generated secret that is not returned
  // in the response would produce a session impossible to use — failing silently at
  // generation time rather than here, making E2E failures hard to diagnose.
  if (typeof body.session_secret !== 'string' || body.session_secret.length < 16 || body.session_secret.length > 256) {
    return jsonResponse({ message: 'session_secret wajib disertakan dan harus 16–256 karakter' }, 400, request, env);
  }
  const testSecret = body.session_secret;
  const secretHash = await sha256Full(testSecret);

  await createSession(env, sessionId, {
    cv_text: stored.text,
    job_desc: stored.job_desc,
    tier,
    status: 'paid',
    credits_remaining: credits,
    total_credits: credits,
    ip,
    mayar_invoice_id: 'bypass_sandbox',
    session_secret_hash: secretHash,
  });
  // Delete cv_text_key AFTER createSession succeeds — mirrors production payment flow.
  // If createSession throws, cv_text_key is still intact and the user can retry.
  await env.GASLAMAR_SESSIONS.delete(cv_text_key);

  log('bypass_payment_created', { sessionId, tier, credits });

  const cookieHeader = makeSessionCookie(sessionId, credits > 1);
  return jsonResponseWithCookie({ session_id: sessionId }, 200, cookieHeader, request, env);
}
