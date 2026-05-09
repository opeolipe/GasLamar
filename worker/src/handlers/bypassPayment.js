import { jsonResponse, jsonResponseWithCookie } from '../cors.js';
import { clientIp, log } from '../utils.js';
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

  const { tier, cv_text_key } = body;

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

  await env.GASLAMAR_SESSIONS.delete(cv_text_key);

  await createSession(env, sessionId, {
    cv_text: stored.text,
    job_desc: stored.job_desc,
    tier,
    status: 'paid',
    credits_remaining: credits,
    total_credits: credits,
    ip,
    mayar_invoice_id: 'bypass_sandbox',
  });

  log('bypass_payment_created', { sessionId, tier, credits });

  const cookieHeader = makeSessionCookie(sessionId, credits > 1);
  return jsonResponseWithCookie({ session_id: sessionId }, 200, cookieHeader, request, env);
}
