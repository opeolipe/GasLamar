// ── download.js — thin orchestrator ──────────────────────────────────────────
// Entry point and public API surface for the download page.
// All implementation lives in the download-*.js modules concatenated before
// this file in scripts/build.js. Functions from those modules are available
// here because all files share the same concatenated bundle scope.
//
// Load order (BUNDLES.download in scripts/build.js):
//   download-state.js       constants + mutable state + clearClientSessionData
//                           + getSecretHeaders + syncTierFromServer
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
(async function init() {
  const params     = new URLSearchParams(location.search);
  const emailToken = params.get('token');

  // ── Path 1: email link with ?token= ────────────────────────────────────────
  // The link contains a single-use, 1-hour token instead of the raw session_id.
  // Exchange it for the session cookie, store session_id in localStorage, then
  // strip the token from the URL so it isn't cached in browser history.
  if (emailToken) {
    showState('waiting-payment');
    try {
      const res = await fetch(WORKER_URL + '/exchange-token', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ email_token: emailToken }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.session_id) {
          localStorage.setItem('gaslamar_session', data.session_id);
          sessionIdCache     = data.session_id;
          sessionSecretCache = localStorage.getItem('gaslamar_secret_' + data.session_id);
        }
        history.replaceState(null, '', location.pathname);
        startPolling(sessionIdCache);
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

  // ── Path 2: cookie + localStorage (normal post-payment flow) ───────────────
  // After /create-payment the browser holds a session_id cookie for the Worker
  // origin, and payment.js stored the session_id in localStorage. Both are used:
  // the cookie is sent automatically with credentialed fetches; localStorage
  // keeps the ID accessible for client-side credit management.
  const sessionId = localStorage.getItem('gaslamar_session');
  if (!sessionId || !sessionId.startsWith('sess_')) {
    showSessionError('Sesi tidak ditemukan', 'Link download tidak valid. Coba lagi dari awal.');
    return;
  }

  sessionIdCache     = sessionId;
  sessionSecretCache = localStorage.getItem('gaslamar_secret_' + sessionId);

  showState('waiting-payment');
  startPolling(sessionId);
})();
