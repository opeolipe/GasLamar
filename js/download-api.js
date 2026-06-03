// ── Module: download-api.js ───────────────────────────────────────────────────
// Session polling, heartbeat keep-alive, and poll UI.
// Depends on: all shared state vars + helpers from download-state.js,
// showState/showSessionError/showCreditsDashboard from download-ui.js,
// startCountdown from download-countdown.js,
// fetchAndGenerateCV from download-generation.js (hoisted — defined later).

// ── startPolling ──────────────────────────────────────────────────────────────
// Resets counters and fires the first poll after POLL_INITIAL_DELAY (2 s).
// The delay absorbs Cloudflare KV eventual-consistency lag after /create-payment.
function startPolling(sessionId) {
  pollCount        = 0;
  notFoundCount    = 0;
  pollCurrentDelay = POLL_INITIAL_DELAY;
  pollStartTime    = Date.now();
  clearTimeout(pollTimer);
  pollTimer = setTimeout(function() { poll(sessionId); }, POLL_INITIAL_DELAY);
}

// ── restartPolling ────────────────────────────────────────────────────────────
// Called by the "Check Again" button. Resets backoff and restarts the loop.
function restartPolling() {
  document.getElementById('check-btn').classList.add('hidden');
  document.getElementById('contact-btn').classList.add('hidden');
  startPolling(null);
}

// ── handlePaidSession ─────────────────────────────────────────────────────────
// Handles the paid/generating branch of a poll response.
// Extracted from poll() to keep that function at a single level of branching.
async function handlePaidSession(data, sessionId) {
  clearTimeout(pollTimer);

  const creditsForHeartbeat = data.total_credits != null ? data.total_credits : 1;
  startSessionHeartbeat(sessionId);
  if (data.expires_at) startCountdown(data.expires_at, creditsForHeartbeat);

  const creditsRemaining = data.credits_remaining != null ? data.credits_remaining : 1;
  const totalCredits     = data.total_credits     != null ? data.total_credits     : 1;

  syncTierFromServer(data.tier); // overwrites client-stored tier; warns on mismatch

  if (window.Analytics) Analytics.track('payment_confirmed', {
    tier:          data.tier || undefined,
    total_credits: totalCredits,
    poll_attempts: pollCount,
  });

  // Returning multi-credit user who has already used ≥1 credit:
  // show the dashboard without auto-generating a new CV
  const isReturning = totalCredits > 1 && creditsRemaining < totalCredits;
  if (isReturning) {
    showCreditsDashboard(creditsRemaining, totalCredits, data.tier);
  } else {
    await fetchAndGenerateCV(sessionId);
  }
}

// ── poll ──────────────────────────────────────────────────────────────────────
// One tick of the payment-confirmation polling loop.
// Increments pollCount, fires GET /check-session, and branches on status.
async function poll(sessionId) {
  pollCount++;
  updatePollUI();

  try {
    // Session auth travels only via the HttpOnly cookie set by /create-payment.
    // No session ID in headers — the server ignores custom session headers and
    // reads exclusively from the cookie.
    const checkUrl = WORKER_URL + '/check-session';
    const res = await fetch(checkUrl, {
      credentials: 'include',
    });

    if (res.status === 400) {
      showSessionError(
        'Link Tidak Valid',
        'Link download tidak valid. Pastikan menggunakan link lengkap yang dikirim ke email kamu.',
        false
      );
      return;
    }

    if (res.status === 404) {
      notFoundCount++;
      // Allow up to 4 consecutive 404s (~12 s) before declaring the session
      // invalid — enough time for KV propagation after a real payment.
      if (notFoundCount < 4) {
        updatePollUI();
        scheduleNextPoll(sessionId);
        return;
      }
      // Try /get-result before giving up \u2014 session may be deleted after credit exhaustion
      // but the generated CV is stored separately for 30 days.
      try {
        const resultRes = await fetch(WORKER_URL + '/get-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (resultRes.ok) {
          const resultData = await resultRes.json();
          // Display the cached CV with 0 credits (exhausted state)
          await showExhaustedResult(resultData);
          return;
        }
      } catch (_) {}

      // No stored result \u2014 redirect to recovery page
      clearClientSessionData(sessionId);
      window.location.replace('access.html?expired=1&source=download');
      return;
    }
    notFoundCount = 0; // reset on any non-404 response

    if (res.status === 429) {
      const retryAfterSec = parseInt(res.headers.get('Retry-After') || '0', 10);
      const retryMs = retryAfterSec > 0 ? retryAfterSec * 1000 : pollCurrentDelay;
      scheduleNextPoll(sessionId, retryMs);
      return;
    }

    if (!res.ok) {
      scheduleNextPoll(sessionId);
      return;
    }

    const data     = await res.json();
    const { status } = data;

    // 200 + authenticated:false means "no cookie" — redirect to access recovery.
    if (data.authenticated === false && data.reason === 'no_session') {
      clearClientSessionData(sessionId);
      window.location.replace('access.html?expired=1&source=download');
      return;
    }

    // 'paid'       — payment confirmed, ready for first generation
    // 'ready'      — a previous generation succeeded; another can be triggered
    // 'generating' — generation already in progress (retry after failure)
    if (status === 'paid' || status === 'ready' || status === 'generating') {
      await handlePaidSession(data, sessionId);
    } else if (status === 'exhausted') {
      // All credits consumed — fetch the last result directly instead of waiting.
      // This surfaces the CV immediately on page reload rather than a confusing 404.
      clearTimeout(pollTimer);
      try {
        const resultRes = await fetch(WORKER_URL + '/get-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (resultRes.ok) {
          const resultData = await resultRes.json();
          await showExhaustedResult(resultData);
          return;
        }
      } catch (_) {}
      // No stored result — unlikely but show a graceful message
      showSessionError(
        'Kredit Habis',
        'Semua kredit kamu sudah digunakan. Cek email kamu untuk CV yang sudah digenerate, ' +
        'atau hubungi support@gaslamar.com.',
        false
      );
    } else if (status === 'pending' || status === 'pending_payment') {
      // Awaiting payment confirmation from Mayar webhook — keep polling with backoff
      scheduleNextPoll(sessionId);
    } else {
      // Unknown status — keep polling with backoff
      scheduleNextPoll(sessionId);
    }
  } catch (_) {
    scheduleNextPoll(sessionId);
  }
}

// ── scheduleNextPoll ──────────────────────────────────────────────────────────
// Schedules the next poll using exponential backoff (doubles each call, capped
// at POLL_MAX_DELAY). Pass retryAfterMs to override with a server-supplied delay.
function scheduleNextPoll(sessionId, retryAfterMs) {
  const elapsed = Date.now() - pollStartTime;
  if (elapsed >= POLL_TIMEOUT_MS) {
    showPollTimeout();
    return;
  }
  const delay = retryAfterMs != null
    ? Math.min(retryAfterMs, POLL_MAX_DELAY)
    : pollCurrentDelay;
  // Advance backoff for next tick (only when we're not using a server-supplied delay)
  if (retryAfterMs == null) {
    pollCurrentDelay = Math.min(pollCurrentDelay * 2, POLL_MAX_DELAY);
  }
  pollTimer = setTimeout(function() { poll(sessionId); }, delay);
}

// ── showPollTimeout ───────────────────────────────────────────────────────────
function showPollTimeout() {
  if (window.Analytics) Analytics.track('payment_timeout', { poll_attempts: pollCount });
  const el = document.getElementById('poll-count-text');
  if (el) {
    el.textContent = 'Konfirmasi pembayaran memakan waktu lebih lama. Kami akan memberitahu Anda melalui email.';
  }
  const checkBtn = document.getElementById('check-btn');
  if (checkBtn) checkBtn.classList.remove('hidden');
  setTimeout(function() {
    const contactBtn = document.getElementById('contact-btn');
    if (contactBtn) contactBtn.classList.remove('hidden');
  }, 60000);
}

// ── startSessionHeartbeat ─────────────────────────────────────────────────────
// Pings /session/ping every HEARTBEAT_INTERVAL ms to refresh the KV TTL
// while the user remains on the page. No-ops if already running.
function startSessionHeartbeat(sessionId) {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async function() {
    try {
      const res = await fetch(WORKER_URL + '/session/ping', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (res.status === 404) {
        stopSessionHeartbeat();
        clearClientSessionData(sessionId);
        window.location.replace('access.html?expired=1&source=download');
      }
    } catch (_) { /* ignore transient network errors */ }
  }, HEARTBEAT_INTERVAL);
}

// ── stopSessionHeartbeat ──────────────────────────────────────────────────────
function stopSessionHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ── updatePollUI ──────────────────────────────────────────────────────────────
// Updates #poll-count-text with contextual feedback during polling.
function updatePollUI() {
  const el = document.getElementById('poll-count-text');
  if (!el) return;
  el.textContent = notFoundCount > 0
    ? 'Sesi belum ditemukan, mencoba lagi... (' + notFoundCount + '/4)'
    : 'Memeriksa status pembayaran...';
}
