// Session guard — runs synchronously in <head> before body renders.
// Sets window.__hasilSessionError so the React app can render contextual error states
// without redirecting. Actual auth is enforced server-side: /get-scoring returns
// 400/404 if no valid cv_key cookie exists.
(function() {
  var CLEAR_KEYS = ['gaslamar_cv_key', 'gaslamar_analyze_time'];

  // --- Security: reject any URL-level session parameter that doesn't match our format ---
  var params = new URLSearchParams(location.search);
  var urlSession = params.get('session') || params.get('sessionId');
  if (urlSession !== null && !urlSession.startsWith('cvtext_')) {
    CLEAR_KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.__hasilSessionError = 'expired';
    return;
  }

  // Check analyze_time is present and not stale (24h TTL matches cv_key cookie and cvtext_ KV TTL).
  var analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  var SESSION_SECS = 86400;

  if (!analyzeTime) {
    window.__hasilSessionError = 'no_session';
    return;
  }

  var isExpired = (Date.now() - analyzeTime) / 1000 > SESSION_SECS;
  if (isExpired) {
    CLEAR_KEYS.forEach(function(k) { sessionStorage.removeItem(k); });
    window.__hasilSessionError = 'expired';
    return;
  }

  // All checks passed — React app fetches from /get-scoring using the HttpOnly cv_key cookie.
})();
