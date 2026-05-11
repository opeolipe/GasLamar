// Session guard — runs synchronously in <head> before body renders.
// Expired sessions redirect to /access so the user can recover their paid CV link.
// Missing/forged sessions redirect to upload.html for re-upload.
//
// Scoring is now server-side (GET /get-scoring) so the guard no longer validates
// the sessionStorage blob — it only checks the cv_text_key format and analyze_time.
// scoring.js handles the async server fetch and its own expiry/error paths.
(function() {
  var KEYS = ['gaslamar_cv_key', 'gaslamar_analyze_time'];

  function redirect(reason) {
    KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.location.replace('upload.html?reason=' + reason);
  }

  // --- Security: reject any URL-level session parameter that doesn't match our format ---
  // hasil.html is a server-fetch page; a foreign sessionId in the URL means
  // someone is sharing/forging a link.
  var params = new URLSearchParams(location.search);
  var urlSession = params.get('session') || params.get('sessionId');
  if (urlSession !== null && !urlSession.startsWith('cvtext_')) {
    redirect('session_expired'); return;
  }

  var cvKey       = sessionStorage.getItem('gaslamar_cv_key') || '';
  var analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  var SESSION_SECS = 7200;

  // cv_key must have the expected format (cvtext_<token>) — required for server fetch
  if (!cvKey || !cvKey.startsWith('cvtext_')) { redirect('no_session'); return; }

  // Session must not be older than 2 hours — send to /access so returning
  // paid users can recover their CV download link without re-uploading.
  var isExpired = analyzeTime > 0 && (Date.now() - analyzeTime) / 1000 > SESSION_SECS;
  if (isExpired) {
    KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.location.replace('access.html?expired=1&source=hasil');
    return;
  }

  // analyze_time must be present (guards against manually injected keys)
  if (!analyzeTime) { redirect('no_session'); return; }

  // If a valid cvtext_ key is in the URL, it must match what's in sessionStorage
  if (urlSession && urlSession !== cvKey) { redirect('session_expired'); return; }

  // All checks passed — scoring.js will fetch from /get-scoring.
})();
