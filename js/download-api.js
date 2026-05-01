// ── Module: download-api.js ───────────────────────────────────────────────────
// Session polling, heartbeat keep-alive, and poll UI.
// Depends on: all shared state vars + helpers from download-state.js,
// showState/showSessionError/showCreditsDashboard from download-ui.js,
// startCountdown from download-countdown.js,
// fetchAndGenerateCV from download-generation.js (hoisted — defined later).

// ── startPolling ──────────────────────────────────────────────────────────────
// Resets counters and fires the first poll after a 2-second delay.
// The delay absorbs Cloudflare KV eventual-consistency lag after /create-payment.
function startPolling(sessionId) {
  pollCount    = 0;
  notFoundCount = 0;
  setTimeout(function() { poll(sessionId); }, 2000);
}

// ── restartPolling ────────────────────────────────────────────────────────────
// Called by the "Check Again" button after auto-polling has exhausted MAX_POLLS.
function restartPolling() {
  const sessionId = sessionIdCache || localStorage.getItem('gaslamar_session');
  if (!sessionId) {
    showSessionError('Sesi tidak ditemukan', 'Link download tidak valid.');
    return;
  }
  document.getElementById('check-btn').classList.add('hidden');
  document.getElementById('contact-btn').classList.add('hidden');
  startPolling(sessionId);
}

// ── handlePaidSession ─────────────────────────────────────────────────────────
// Handles the paid/generating branch of a poll response.
// Extracted from poll() to keep that function at a single level of branching.
async function handlePaidSession(data, sessionId) {
  clearTimeout(pollTimer);

  const creditsForHeartbeat = data.total_credits != null ? data.total_credits : 1;
  startSessionHeartbeat(sessionId, creditsForHeartbeat);
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
    // Session ID travels via the HttpOnly cookie set by /create-payment.
    // credentials:'include' sends it cross-origin.
    const res = await fetch(WORKER_URL + '/check-session', { credentials: 'include' });

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
      clearClientSessionData(sessionId);
      showSessionError(
        'Sesi Tidak Ditemukan',
        'Sesi pembayaran tidak ditemukan. Jika kamu baru saja membayar, coba refresh halaman ini \u2014 ' +
        'kadang butuh 1\u20132 menit. Jika masalah berlanjut, hubungi support@gaslamar.com dengan bukti pembayaran.',
        false
      );
      return;
    }
    notFoundCount = 0; // reset on any non-404 response

    if (!res.ok) {
      scheduleNextPoll(sessionId);
      return;
    }

    const data     = await res.json();
    const { status } = data;

    if (status === 'paid' || status === 'generating') {
      await handlePaidSession(data, sessionId);
    } else if (status === 'pending') {
      if (pollCount >= MAX_POLLS) {
        if (window.Analytics) Analytics.track('payment_timeout', { poll_attempts: pollCount });
        document.getElementById('check-btn').classList.remove('hidden');
        document.getElementById('poll-count-text').textContent = 'Klik tombol di bawah untuk cek ulang.';
        setTimeout(function() {
          document.getElementById('contact-btn').classList.remove('hidden');
        }, 60000); // show contact support link 1 min after polling stops
      } else {
        scheduleNextPoll(sessionId);
      }
    } else {
      // Unknown status — keep polling up to MAX_POLLS, then show manual check
      if (pollCount < MAX_POLLS) {
        scheduleNextPoll(sessionId);
      } else {
        document.getElementById('check-btn').classList.remove('hidden');
        document.getElementById('poll-count-text').textContent = 'Klik tombol di bawah untuk cek ulang.';
      }
    }
  } catch (_) {
    if (pollCount < MAX_POLLS) scheduleNextPoll(sessionId);
  }
}

// ── scheduleNextPoll ──────────────────────────────────────────────────────────
function scheduleNextPoll(sessionId) {
  pollTimer = setTimeout(function() { poll(sessionId); }, POLL_INTERVAL);
}

// ── startSessionHeartbeat ─────────────────────────────────────────────────────
// Pings /session/ping every HEARTBEAT_INTERVAL ms to refresh the KV TTL
// while the user remains on the page. No-ops if already running.
function startSessionHeartbeat(sessionId, totalCredits) {
  if (heartbeatTimer) return;
  const isMulti       = (totalCredits || 1) > 1;
  const validityLabel = isMulti ? '30 hari' : '7 hari';
  heartbeatTimer = setInterval(async function() {
    try {
      const res = await fetch(WORKER_URL + '/session/ping', {
        method:      'POST',
        headers:     Object.assign({ 'Content-Type': 'application/json' }, getSecretHeaders()),
        credentials: 'include',
      });
      if (res.status === 404) {
        stopSessionHeartbeat();
        clearClientSessionData(sessionId);
        showSessionError(
          'Sesi Kedaluwarsa',
          '\uD83D\uDCC5 Sesi download kamu sudah berakhir (berlaku ' + validityLabel + '). ' +
          'Upload ulang CV untuk memulai analisis baru, atau hubungi support@gaslamar.com ' +
          'jika kamu masih punya kredit tersisa.',
          false
        );
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
