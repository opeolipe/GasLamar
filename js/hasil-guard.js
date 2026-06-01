// Session guard — runs synchronously in <head> before body renders.
// Expired sessions redirect to /access so the user can recover their paid CV link.
// Missing/never-analyzed sessions redirect to upload.html.
//
// The cv_key is now an HttpOnly cookie set by /analyze — it cannot be read by JS.
// This guard checks only gaslamar_analyze_time for freshness. Actual auth is
// enforced server-side: /get-scoring returns 400/404 if no valid cv_key cookie exists.
(function() {
  var CLEAR_KEYS = ['gaslamar_cv_key', 'gaslamar_analyze_time'];

  function redirect(reason) {
    CLEAR_KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
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

  // Check analyze_time is present and not stale (24h TTL matches cv_key cookie and cvtext_ KV TTL).
  var analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  var SESSION_SECS = 86400;

  if (!analyzeTime) { redirect('no_session'); return; }

  var isExpired = (Date.now() - analyzeTime) / 1000 > SESSION_SECS;
  if (isExpired) {
    CLEAR_KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.location.replace('access.html?expired=1&source=hasil');
    return;
  }

  // All checks passed — scoring.js fetches from /get-scoring using the HttpOnly cv_key cookie.
})();
