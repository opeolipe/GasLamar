/**
 * POST /exchange-token
 *
 * Exchanges a short-lived, single-use email_token for a session_id cookie.
 * Used when the user clicks the download link in a confirmation email, which may
 * be opened on a different device or browser where no session cookie exists.
 *
 * Flow:
 *   1. Email is sent with ?token=<email_token> (NOT ?session=<session_id>)
 *   2. download.html detects ?token= on load and POSTs to this endpoint
 *   3. We look up the KV entry email_token_<token> → { session_id }
 *   4. If valid: delete the token (single-use), set session cookie, return { ok: true }
 *   5. download.html then strips ?token= from the URL and resumes normally
 *
 * Security properties:
 *   - Tokens are 128-bit random hex — not guessable
 *   - Tokens expire after 1 hour (EMAIL_TOKEN_TTL in email.js)
 *   - Tokens are deleted on first use (single-use)
 *   - Rate-limited to 5 req/min per IP (reuses RATE_LIMITER_PAYMENT binding)
 *   - Session cookie set here has the same attributes as the one from /create-payment
 */

import { jsonResponseWithCookie } from '../cors.js';
import { jsonResponse } from '../cors.js';
import { clientIp, log, logError } from '../utils.js';
import { checkRateLimit, rateLimitResponse } from '../rateLimit.js';
import { getSession } from '../sessions.js';
import { makeSessionCookie } from '../cookies.js';
import { KV_CV_RESULT_PREFIX } from '../constants.js';

export async function handleExchangeToken(request, env) {
  const ip = clientIp(request);

  // Reuse the payment rate limiter (5 req/min) — token exchange is equally sensitive
  const allowed = await checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip);
  if (!allowed) {
    return rateLimitResponse(request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { email_token } = body;

  // H6 FIX: Require exactly 32 hex characters (128-bit token from hexToken()).
  // The original check accepted 1–64 chars — a 1-char token has only 16 possibilities,
  // making short tokens trivially brute-forceable against the KV lookup key.
  if (!email_token || typeof email_token !== 'string' || !/^[0-9a-f]{32}$/.test(email_token)) {
    return jsonResponse({ message: 'Token tidak valid' }, 400, request, env);
  }

  const kvKey = `email_token_${email_token}`;
  const stored = await env.GASLAMAR_SESSIONS.get(kvKey, { type: 'json' });

  if (!stored || !stored.session_id) {
    logError('exchange_token_not_found', { ip });
    return jsonResponse({ message: 'Token tidak valid atau sudah kedaluwarsa' }, 404, request, env);
  }

  // Delete immediately — single-use enforcement.
  // Must happen before the session check so that two concurrent requests with the
  // same token can't both pass and both receive a cookie (double-use race).
  await env.GASLAMAR_SESSIONS.delete(kvKey);

  // Verify the linked session still exists in KV
  const session = await getSession(env, stored.session_id);
  if (!session) {
    // Session may have been deleted after the last credit was used.
    // The CV result record (cv_result_<session_id>) has its own TTL (7/30 days)
    // and is still readable even after the session is gone. If it exists, set the
    // cookie anyway so the frontend can call /get-result to retrieve the CV.
    const result = await env.GASLAMAR_SESSIONS.get(
      `${KV_CV_RESULT_PREFIX}${stored.session_id}`, { type: 'json' }
    );
    if (!result) {
      logError('exchange_token_session_gone', { ip });
      return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
    }
    const isMulti = result.tier === '3pack' || result.tier === 'jobhunt';
    log('exchange_token_result_only', { session_id: stored.session_id, ip });
    return jsonResponseWithCookie(
      { ok: true, session_id: stored.session_id },
      200,
      makeSessionCookie(stored.session_id, isMulti),
      request,
      env
    );
  }

  log('exchange_token_success', { session_id: stored.session_id, ip });

  const isMulti = (session.total_credits ?? 1) > 1;
  const cookieHeader = makeSessionCookie(stored.session_id, isMulti);

  // Return session_id so the frontend can store it in localStorage for
  // multi-credit session management (heartbeat, credit tracking, etc.)
  return jsonResponseWithCookie(
    { ok: true, session_id: stored.session_id },
    200,
    cookieHeader,
    request,
    env
  );
}
