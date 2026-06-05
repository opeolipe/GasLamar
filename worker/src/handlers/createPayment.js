import { jsonResponseWithCookie } from '../cors.js';
import { jsonResponse } from '../cors.js';
import { clientIp, sha256Hex, log } from '../utils.js';
import { checkRateLimit, checkRateLimitKV, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';
import { TIER_CREDITS, SESSION_TTL_MULTI, VALID_TIERS } from '../constants.js';
import { createMayarInvoice, logMayarEnvironment, MayarError } from '../mayar.js';
import { createSession, getSession, updateSession } from '../sessions.js';
import { makeSessionCookie, getCvKeyFromCookie, getSessionTokenFromCookie, getSessionIdFromCookie } from '../cookies.js';
import { SESSION_STATES } from '../sessionStates.js';

export async function handleCreatePayment(request, env) {
  const ip = clientIp(request);

  const [cfAllowed, kvRl] = await Promise.all([
    checkRateLimit(env, env.RATE_LIMITER_PAYMENT, ip),
    checkRateLimitKV(env, ip, 15, 60, 'create_payment'),
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

  const { tier, cv_text_key: cv_text_key_body, email: rawEmail, coupon_code: rawCoupon } = body;

  // Resolution order for cv_text_key:
  // 1. __Host-cv_key HttpOnly cookie (all environments — uses SameSite=None; Partitioned on
  //    staging so it survives the cross-origin request from staging.gaslamar.pages.dev).
  // 2. cv_text_key in request body (legacy sessions that stored it in sessionStorage).
  // 3. sessionToken cookie → analysis_session_ KV (belt-and-suspenders fallback).
  let cv_text_key = getCvKeyFromCookie(request) || cv_text_key_body || null;

  if (!cv_text_key) {
    const analysisToken = getSessionTokenFromCookie(request);
    if (analysisToken) {
      const analysisSession = await env.GASLAMAR_SESSIONS.get(`analysis_session_${analysisToken}`, { type: 'json' });
      if (analysisSession?.cvKey && /^cvtext_[0-9a-f]{64}$/.test(analysisSession.cvKey)) {
        cv_text_key = analysisSession.cvKey;
        log('create_payment_cv_key_from_analysis_session', { ip });
      }
    }
  }

  // Sanitize coupon code — uppercase, strip non-alphanumeric, max 64 chars
  const couponCode = (rawCoupon && typeof rawCoupon === 'string')
    ? rawCoupon.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').substring(0, 64) || null
    : null;

  // Optional email — basic validation, silently ignore if malformed
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const sessionEmail = (rawEmail && typeof rawEmail === 'string' && emailRegex.test(rawEmail) && rawEmail.length <= 254)
    ? rawEmail.toLowerCase().trim()
    : null;

  // Validate tier first — gives a specific rejection for unknown tiers regardless of
  // whether cv_text_key is also missing, preventing the ambiguous "Data tidak lengkap"
  // response that would otherwise mask an invalid tier name.
  // Trim whitespace defensively so minor formatting differences don't produce silent failures.
  // Alias map: "starter" → "coba" for backward compatibility with older frontend bundles
  // that used the display label as the tier key before the rename.
  const TIER_ALIASES = { starter: 'coba' };
  const trimmed = (typeof tier === 'string') ? tier.trim().toLowerCase() : tier;
  const normalizedTier = TIER_ALIASES[trimmed] ?? trimmed;
  if (!normalizedTier || !VALID_TIERS.includes(normalizedTier)) {
    return withRl(jsonResponse({
      message: `Tier tidak valid. Nilai yang diterima: ${VALID_TIERS.join(', ')}`,
      valid_tiers: VALID_TIERS,
    }, 400, request, env));
  }
  // Use the trimmed value for all downstream logic
  const validatedTier = normalizedTier;

  if (!cv_text_key) {
    return withRl(jsonResponse({ message: 'Sesi analisis tidak ditemukan. Ulangi upload CV untuk melanjutkan.', code: 'cv_key_missing' }, 400, request, env));
  }

  // Strict format: exactly "cvtext_" + 64 lowercase hex chars (256-bit random token).
  // Mirrors getScoring.js validation — prevents oversized KV key lookups that hit
  // Cloudflare's 512-byte key limit with a confusing error.
  if (!/^cvtext_[0-9a-f]{64}$/.test(cv_text_key)) {
    return withRl(jsonResponse({ message: 'cv_text_key tidak valid' }, 400, request, env));
  }
  const stored = await env.GASLAMAR_SESSIONS.get(cv_text_key, { type: 'json' });
  if (!stored || !stored.text) {
    // Before giving up with cv_expired, check whether the user already completed a
    // /create-payment call that succeeded on the backend but failed on the frontend
    // (e.g. due to an allowlist mismatch). In that case the cvtext_ entry was already
    // consumed and deleted, but the session cookie was written and the invoice_url was
    // stored in the session — so we can resume without creating a duplicate invoice.
    const existingSessionId = getSessionIdFromCookie(request);
    if (existingSessionId) {
      const existingSession = await getSession(env, existingSessionId);
      if (
        existingSession?.status === SESSION_STATES.PENDING_PAYMENT &&
        existingSession?.tier === validatedTier
      ) {
        const credits = TIER_CREDITS[validatedTier] ?? 1;
        const isMulti = credits > 1;

        // Check whether the stored invoice is still within its validity window.
        // Sandbox invoices expire quickly (~1h); production invoices last much longer.
        // If expired, fall through to create a fresh invoice — a new Mayar email will
        // be sent, which is correct because the old link is dead.
        const INVOICE_TTL_MS = env.ENVIRONMENT === 'production'
          ? 23 * 60 * 60 * 1000   // 23h — conservative for production
          : 50 * 60 * 1000;       // 50min — sandbox invoices expire ~1h after creation
        // Old sessions may not have invoice_created_at — treat as still valid (backward compat).
        const invoiceAge = existingSession.invoice_created_at
          ? Date.now() - existingSession.invoice_created_at
          : 0;
        const invoiceValid = existingSession.invoice_url && invoiceAge < INVOICE_TTL_MS;

        if (invoiceValid) {
          log('create_payment_resumed', { ip, sessionId: existingSessionId });
          const cookieHeader = makeSessionCookie(existingSessionId, isMulti, env);
          return withRl(jsonResponseWithCookie({ invoice_url: existingSession.invoice_url }, 200, cookieHeader, request, env));
        }

        // Invoice expired or URL missing — create a fresh invoice and update the session.
        // Session data already has cv_text + job_desc so we can recreate without cvtext_.
        log('create_payment_invoice_expired_refresh', { ip, sessionId: existingSessionId, invoiceAge });
        const mayarKeyForRefresh = env.ENVIRONMENT === 'production' ? env.MAYAR_API_KEY : env.MAYAR_API_KEY_SANDBOX;
        if (mayarKeyForRefresh) {
          try {
            const redirectUrl = env.ENVIRONMENT === 'staging'
              ? 'https://staging.gaslamar.pages.dev/download.html'
              : 'https://gaslamar.com/download.html';
            const { invoice_id: newInvoiceId, transaction_id: newTransactionId, invoice_url: newInvoiceUrl } = await createMayarInvoice(
              existingSessionId, validatedTier, env, redirectUrl, existingSession.email ?? null, null
            );
            if (newInvoiceUrl) {
              await updateSession(env, existingSessionId, {
                mayar_invoice_id: newInvoiceId,
                invoice_url: newInvoiceUrl,
                invoice_created_at: Date.now(),
              });
              if (newInvoiceId) {
                await env.GASLAMAR_SESSIONS.put(
                  `mayar_session_${newInvoiceId}`,
                  JSON.stringify({ session_id: existingSessionId }),
                  { expirationTtl: isMulti ? 2592000 : 604800 }
                );
                if (newTransactionId && newTransactionId !== newInvoiceId) {
                  await env.GASLAMAR_SESSIONS.put(
                    `mayar_session_${newTransactionId}`,
                    JSON.stringify({ session_id: existingSessionId }),
                    { expirationTtl: isMulti ? 2592000 : 604800 }
                  );
                }
              }
              log('create_payment_invoice_refreshed', { ip, sessionId: existingSessionId });
              const cookieHeader = makeSessionCookie(existingSessionId, isMulti, env);
              return withRl(jsonResponseWithCookie({ invoice_url: newInvoiceUrl }, 200, cookieHeader, request, env));
            }
          } catch (refreshErr) {
            console.error(JSON.stringify({ event: 'create_payment_refresh_failed', error: refreshErr.message, type: refreshErr instanceof MayarError ? 'gateway' : 'internal' }));
            // Fall through to cv_expired — user may need to re-upload
          }
        }
      }
    }
    // M22: Include a stable machine-readable code so the client can branch on it
    // without depending on the Indonesian message text (which can change).
    return withRl(jsonResponse({ message: 'Sesi analisis kedaluwarsa. Ulangi upload CV.', code: 'cv_expired' }, 400, request, env));
  }

  // IP-binding check — reject if the key was created from a different network.
  // stored.ip is absent on entries written before this check was added; those pass through.
  if (stored.ip && stored.ip !== ip) {
    log('cvtext_ip_mismatch', { ip, stored_ip: stored.ip });
    return withRl(jsonResponse({ message: 'Sesi tidak valid dari jaringan ini. Ulangi upload CV.' }, 403, request, env));
  }

  // Validate Mayar API key before creating an invoice lock (gives a clear 503
  // without blocking retries for 60s when staging/sandbox config is missing).
  const mayarKey = env.ENVIRONMENT === 'production' ? env.MAYAR_API_KEY : env.MAYAR_API_KEY_SANDBOX;
  if (!mayarKey) {
    console.error(JSON.stringify({ event: 'create_payment_no_apikey', environment: env.ENVIRONMENT ?? 'sandbox' }));
    return withRl(jsonResponse({ message: 'Layanan pembayaran sedang tidak tersedia. Hubungi support@gaslamar.com.', code: 'PAYMENT_GATEWAY_ERROR' }, 503, request, env));
  }

  // Idempotency: prevent duplicate invoices from rapid concurrent requests.
  // cv_text_key is single-use (deleted after invoice creation); a KV lock with a short
  // TTL ensures only one request reaches the Mayar API per cv_text_key.
  const invoiceLockKey = `invoice_lock_${cv_text_key}`;
  const existingLock = await env.GASLAMAR_SESSIONS.get(invoiceLockKey);
  if (existingLock) {
    return withRl(jsonResponse({ message: 'Permintaan sedang diproses. Coba lagi sebentar.' }, 409, request, env));
  }
  await env.GASLAMAR_SESSIONS.put(invoiceLockKey, '1', { expirationTtl: 60 }); // KV minimum TTL is 60s

  // Create session
  const sessionId = `sess_${crypto.randomUUID()}`;

  const credits = TIER_CREDITS[validatedTier] ?? 1;

  try {
    // Redirect after payment completes — points to the right frontend per environment.
    // ENVIRONMENT = "staging"    → staging.gaslamar.pages.dev
    // ENVIRONMENT = "production" → gaslamar.com  (and everything else)
    const redirectUrl = env.ENVIRONMENT === 'staging'
      ? 'https://staging.gaslamar.pages.dev/download.html'
      : 'https://gaslamar.com/download.html';

    logMayarEnvironment(env);
    console.log(JSON.stringify({ event: 'payment_redirect_url', redirectUrl, environment: env.ENVIRONMENT ?? 'sandbox' }));

    // Create Mayar invoice first — if this fails, cv_text_key is still intact and user can retry
    const { invoice_id, transaction_id, invoice_url } = await createMayarInvoice(sessionId, validatedTier, env, redirectUrl, sessionEmail, couponCode);

    if (invoice_id) {
      // Store session so the Mayar webhook can complete it even if we don't redirect now.
      const sessionData = {
        cv_text: stored.text,
        job_desc: stored.job_desc,
        // Carry inferred_role through to /generate so it can choose tailoring mode.
        inferred_role: stored.inferred_role ?? null,
        // Carry result_id so /generate can validate the client-supplied analytics ID.
        ...(stored.result_id ? { result_id: stored.result_id } : {}),
        tier: validatedTier,
        status: SESSION_STATES.PENDING_PAYMENT,
        mayar_invoice_id: invoice_id,
        // Store invoice_url so the frontend can resume if the first redirect attempt
        // failed (e.g. allowlist mismatch) and cvtext_ was already consumed.
        ...(invoice_url ? { invoice_url } : {}),
        invoice_created_at: Date.now(),
        credits_remaining: credits,
        total_credits: credits,
        ip,
        ...(sessionEmail ? { email: sessionEmail } : {}),
      };
      await createSession(env, sessionId, sessionData);

      // Secondary KV index: invoice_id → session_id.
      // The Mayar webhook identifies payments by invoice ID; without the ?session= query
      // param in the redirect URL we need this index to correlate the webhook to a session.
      // TTL matches the session (7d single / 30d multi).
      // IMPORTANT: log the exact KV key so we can compare against candidateInvoiceIds in
      // the webhook logs if a webhook_no_session error appears.
      console.log(JSON.stringify({ event: 'mayar_session_index_stored', kv_key: `mayar_session_${invoice_id}`, sessionId, invoice_id, transaction_id: transaction_id ?? null }));
      const indexTtl = credits > 1 ? 2592000 : 604800;
      await env.GASLAMAR_SESSIONS.put(
        `mayar_session_${invoice_id}`,
        JSON.stringify({ session_id: sessionId }),
        { expirationTtl: indexTtl }
      );
      // Mayar's webhook sends data.id = the payment transaction ID, which is a different
      // UUID from the invoice ID above. Store a second index so the webhook handler finds
      // the session regardless of which ID Mayar echoes back.
      if (transaction_id && transaction_id !== invoice_id) {
        await env.GASLAMAR_SESSIONS.put(
          `mayar_session_${transaction_id}`,
          JSON.stringify({ session_id: sessionId }),
          { expirationTtl: indexTtl }
        );
      }

      // Fallback index: keyed by result_id (the analytics UUID stored in cvtext_).
      // Used by the webhook handler when the primary invoice-ID index is missing
      // (e.g. Mayar sends a transaction ID we didn't store) and Mayar echoes back
      // our `reference` field instead of the original invoice ID.
      if (stored.result_id && typeof stored.result_id === 'string') {
        await env.GASLAMAR_SESSIONS.put(
          `result_id_session_${stored.result_id}`,
          JSON.stringify({ session_id: sessionId }),
          { expirationTtl: indexTtl }
        );
      }

      // Preserve scoring snapshot so /get-scoring can still serve hasil.html if the user
      // returns to /hasil after the payment redirect (e.g. cancellation or back-navigation).
      // The raw CV text is deleted below; scoring data contains no PII and is safe to keep.
      // Non-critical: a write failure here must not abort payment — suppress with .catch().
      if (stored.scoring && typeof stored.scoring === 'object' && typeof stored.scoring.skor === 'number') {
        await env.GASLAMAR_SESSIONS.put(
          `scoring_${cv_text_key.slice('cvtext_'.length)}`,
          JSON.stringify({ scoring: stored.scoring, ip }),
          { expirationTtl: 86400 }, // 24 h — matches original cvtext_ window
        ).catch((e) => console.warn(JSON.stringify({ event: 'scoring_snapshot_write_failed', error: e.message })));
      }

      // Delete cv_text_key LAST — only after both the session and secondary index are
      // persisted. If either write above throws (KV transient error), cv_text_key still
      // exists so the user can retry after the invoice lock expires (60 s). Deleting first
      // would orphan the Mayar invoice with no recoverable session if a write failed.
      await env.GASLAMAR_SESSIONS.delete(cv_text_key);
    }

    if (!invoice_url) {
      // Invoice may or may not have been created — either way, cannot redirect.
      // Do NOT release the invoice lock; do NOT allow retry with the same cv_text_key.
      console.error(JSON.stringify({ event: 'create_payment_no_url', tier: validatedTier, invoice_id: invoice_id ?? null }));
      return withRl(jsonResponse({ message: 'Link pembayaran tidak tersedia. Hubungi support@gaslamar.com jika sudah melakukan pembayaran.', code: 'PAYMENT_GATEWAY_ERROR' }, 503, request, env));
    }

    // Email → session index for access recovery (/resend-access).
    // Key uses SHA-256 of the email (not plaintext) to avoid PII exposure in KV key space.
    // Array capped at 10 entries (oldest dropped) to bound O(n) reads in resendAccess.
    // TTL = 30 days (max session lifetime) so PII is not retained after sessions expire.
    if (sessionEmail) {
      const emailKeyHash = await sha256Hex(sessionEmail);
      const indexKey = `email_session_${emailKeyHash}`;
      const existing = await env.GASLAMAR_SESSIONS.get(indexKey, { type: 'json' });
      // Support old single-id format from before this change
      const ids = existing?.session_ids ?? (existing?.session_id ? [existing.session_id] : []);
      if (!ids.includes(sessionId)) ids.push(sessionId);
      // Cap at 10 — drop the oldest entries first
      const cappedIds = ids.length > 10 ? ids.slice(ids.length - 10) : ids;
      await env.GASLAMAR_SESSIONS.put(indexKey, JSON.stringify({ session_ids: cappedIds }), { expirationTtl: 2592000 });
    }

    // Set HttpOnly session cookie — eliminates session_id from URLs (browser history,
    // Referer headers, server logs). Cookie travels automatically with all credentialed
    // requests to this Worker origin.
    const isMulti = credits > 1;
    const cookieHeader = makeSessionCookie(sessionId, isMulti, env);

    return withRl(jsonResponseWithCookie({ invoice_url }, 200, cookieHeader, request, env));
  } catch (e) {
    // Release invoice lock — Mayar never received a valid request, so the user can retry.
    await env.GASLAMAR_SESSIONS.delete(invoiceLockKey).catch(() => {});
    const isMayarError = e instanceof MayarError;
    console.error(JSON.stringify({
      event: 'create_payment_failed',
      error: e.message,
      tier: validatedTier,
      mayar_status: isMayarError ? (e.mayarStatus ?? 'all_404') : null,
      type: isMayarError ? 'gateway' : 'internal',
    }));
    if (isMayarError) {
      // Mayar gateway failure — surface a 502 so clients/monitors can distinguish
      // payment-gateway outages from Worker bugs.
      return withRl(jsonResponse({
        message: 'Layanan pembayaran sedang tidak tersedia. Coba lagi beberapa saat atau hubungi support@gaslamar.com.',
        code: 'PAYMENT_GATEWAY_ERROR',
      }, 502, request, env));
    }
    return withRl(jsonResponse({ message: 'Gagal membuat invoice. Coba lagi atau hubungi support@gaslamar.com.' }, 500, request, env));
  }
}
