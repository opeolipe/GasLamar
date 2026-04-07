// Session guard — runs synchronously in <head> before body renders.
// Clears stale/invalid sessionStorage data and redirects to upload.html.
(function() {
  var KEYS = ['gaslamar_scoring','gaslamar_cv_key','gaslamar_analyze_time'];
  function clearAndRedirect() {
    KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.location.replace('upload.html');
  }

  // Reject any URL-level session parameter that doesn't match our format.
  // hasil.html is a sessionStorage-only page; a foreign sessionId in the URL
  // means someone is sharing/forging a link — clear local data and redirect.
  var params = new URLSearchParams(location.search);
  var urlSession = params.get('session') || params.get('sessionId');
  if (urlSession !== null && !urlSession.startsWith('cvtext_')) {
    clearAndRedirect(); return;
  }

  var rawScoring = sessionStorage.getItem('gaslamar_scoring');
  var cvKey = sessionStorage.getItem('gaslamar_cv_key') || '';
  var analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  var SESSION_SECS = 7200;

  // Must have scoring data
  if (!rawScoring) { clearAndRedirect(); return; }

  // Scoring must be valid JSON with a numeric skor
  var parsed;
  try { parsed = JSON.parse(rawScoring); } catch(e) { clearAndRedirect(); return; }
  var skor = parseInt(parsed && parsed.skor);
  if (isNaN(skor) || skor < 0 || skor > 100) { clearAndRedirect(); return; }

  // cv_key must have the expected format (cvtext_<uuid>) if present
  if (cvKey && !cvKey.startsWith('cvtext_')) { clearAndRedirect(); return; }

  // Session must not be older than 2 hours
  var isExpired = analyzeTime > 0 && (Date.now() - analyzeTime) / 1000 > SESSION_SECS;
  if (isExpired) { clearAndRedirect(); return; }

  // analyze_time must be present (guards against manually injected data)
  if (!analyzeTime) { clearAndRedirect(); return; }

  // If a valid cvtext_ key is in the URL, it must match what's in sessionStorage
  if (urlSession && urlSession !== cvKey) { clearAndRedirect(); return; }
})();
