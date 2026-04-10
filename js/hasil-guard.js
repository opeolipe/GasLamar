// Session guard — runs synchronously in <head> before body renders.
// SECURITY path  → clears data and redirects immediately (forged/mismatched URL params).
// USER-FACING path → sets window.__gaslamarNoSession so scoring.js can render an inline
//                   message instead of bouncing the user to upload.html with no explanation.
(function() {
  var KEYS = ['gaslamar_scoring','gaslamar_cv_key','gaslamar_analyze_time'];

  // Hard redirect — used only for security violations (forged/mismatched URL params).
  function securityRedirect() {
    KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.location.replace('upload.html');
  }

  // Soft fail — used for missing/expired/invalid session data.
  // Lets scoring.js render an informative message on hasil.html rather than
  // silently teleporting the user back to upload.html with no context.
  function setNoSession(reason) {
    KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.__gaslamarNoSession = reason || 'missing';
  }

  // --- Security: reject any URL-level session parameter that doesn't match our format ---
  // hasil.html is a sessionStorage-only page; a foreign sessionId in the URL means
  // someone is sharing/forging a link.
  var params = new URLSearchParams(location.search);
  var urlSession = params.get('session') || params.get('sessionId');
  if (urlSession !== null && !urlSession.startsWith('cvtext_')) {
    securityRedirect(); return;
  }

  var rawScoring  = sessionStorage.getItem('gaslamar_scoring');
  var cvKey       = sessionStorage.getItem('gaslamar_cv_key') || '';
  var analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  var SESSION_SECS = 7200;

  // cv_key must have the expected format if present — anything else is suspect
  if (cvKey && !cvKey.startsWith('cvtext_')) { securityRedirect(); return; }

  // If a valid cvtext_ key is in the URL, it must match what's in sessionStorage
  if (urlSession && urlSession !== cvKey) { securityRedirect(); return; }

  // --- User-facing: missing scoring data (direct navigation, page refresh, failed analysis) ---
  if (!rawScoring) { setNoSession('missing'); return; }

  // --- User-facing: JSON parse failure (corrupted storage, browser bug) ---
  var parsed;
  try { parsed = JSON.parse(rawScoring); } catch(e) { setNoSession('invalid'); return; }

  // --- User-facing: score out of valid range ---
  var skor = parseInt(parsed && parsed.skor);
  if (isNaN(skor) || skor < 0 || skor > 100) { setNoSession('invalid'); return; }

  // --- User-facing: session expired (>2 hours old) ---
  var isExpired = analyzeTime > 0 && (Date.now() - analyzeTime) / 1000 > SESSION_SECS;
  if (isExpired) { setNoSession('expired'); return; }

  // analyze_time must be present (guards against manually injected scoring data without metadata)
  if (!analyzeTime) { setNoSession('missing'); return; }

  // All checks passed — session is valid, scoring.js can render.
})();
