// ── download.js — thin orchestrator ──────────────────────────────────────────
// Entry point and public API surface for the download page.
// All implementation lives in the download-*.js modules concatenated before
// this file in scripts/build.js. Functions from those modules are available
// here because all files share the same concatenated bundle scope.
//
// Load order (BUNDLES.download in scripts/build.js):
//   download-state.js       constants + mutable state + clearClientSessionData
//                           + syncTierFromServer
//   download-ui.js          showState, showSessionError, setProgress …
//   download-file-utils.js  triggerDownload, buildCVFilename …
//   download-docx-pdf.js    parseLines, generateDOCX, generatePDF
//   download-countdown.js   startCountdown
//   download-post-download.js  showPostDownloadActions, tips modal
//   download-api.js         startPolling, poll, heartbeat …
//   download-generation.js  fetchAndGenerateCV, generateCVContent …
//   download.js             ← this file (downloadFile + init IIFE)
//   download-page.js        page-specific UI event bindings (unchanged)

// ── downloadFile ──────────────────────────────────────────────────────────────
// Public handler wired to every .btn-download element in download-page.js.
// Reads cvDataCache populated by generateCVContent.
function downloadFile(lang, format) {
  if (!cvDataCache) return;
  const { cv_id, cv_en, tier } = cvDataCache;
  if (window.Analytics) Analytics.track('cv_downloaded', { tier: tier, language: lang, format: format });
  const cvText = lang === 'id' ? cv_id : cv_en;
  if (!cvText) {
    alert(lang === 'en' ? 'CV English tidak tersedia di paket ini.' : 'CV tidak tersedia.');
    return;
  }
  if (format === 'docx') generateDOCX(cvText, lang, tier);
  else if (format === 'pdf') generatePDF(cvText, lang, tier);
}

// ── init ──────────────────────────────────────────────────────────────────────
// Runs immediately on page load. Two entry paths:
//   Path 1 — ?token=  Email link with a single-use token → exchange for cookie
//   Path 2 — normal   Cookie + localStorage session set by payment.js
//   Path 3 — cookie   HttpOnly cookie only, after storage was cleared/blocked
(async function init() {
  const params     = new URLSearchParams(location.search);
  const emailToken = params.get('token');

  // ── Path 1: email link with ?token= ────────────────────────────────────────
  // The link contains a single-use, 1-hour token instead of the raw session_id.
  // Exchange it for the session cookie (HttpOnly — never stored in client storage),
  // then strip the token from the URL so it isn't cached in browser history.
  if (emailToken) {
    showState('waiting-payment');
    try {
      const res = await fetch(WORKER_URL + '/exchange-token', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ email_token: emailToken }),
      });
      // Strip the token from the URL regardless of outcome — an expired or invalid
      // token has no value but would otherwise persist in browser history.
      history.replaceState(null, '', location.pathname);
      if (res.ok) {
        await res.json().catch(function() { return {}; });
        startPolling(null);
      } else {
        showSessionError(
          'Link Kedaluwarsa',
          'Link dari email sudah tidak berlaku (maksimal 1 jam). ' +
          'Gunakan link dari email terbaru, atau mulai ulang dari halaman upload jika sudah lebih dari 1 jam.',
          false
        );
      }
    } catch (_) {
      showSessionError('Terjadi Kesalahan', 'Tidak dapat menghubungi server. Coba refresh halaman ini.');
    }
    return;
  }

  // ── Path 2: cookie-only normal flow ───────────────────────────────────────
  // The Worker validates the HttpOnly session cookie without exposing the
  // session_id to JavaScript.
  showState('waiting-payment');
  try {
    const res = await fetch(WORKER_URL + '/check-session', {
      credentials: 'include',
    });
    // no_session (200 + authenticated:false) or legacy 401 = no cookie — hard stop.
    // All other non-ok codes (404 = expired session, 429 = rate-limited,
    // 5xx = transient server error) are handled by the polling loop:
    // poll() retries 404 up to 4 times, then checks /get-result and
    // redirects to access.html; transient errors are retried until MAX_POLLS.
    const initData = res.ok ? await res.json().catch(() => ({})) : null;
    const isNoSession = res.status === 401 || (initData && initData.authenticated === false && initData.reason === 'no_session');
    if (isNoSession) {
      showSessionError('Sesi tidak ditemukan', 'Link download tidak valid. Coba lagi dari awal.');
      return;
    }
    startPolling(null);
  } catch (_) {
    showSessionError('Terjadi Kesalahan', 'Tidak dapat menghubungi server. Coba refresh halaman ini.');
    return;
  }
})();
