// Session guard — runs synchronously in <head> before body renders.
// Auth is enforced server-side via the HttpOnly cv_key cookie:
//   - Production: router.js gates /hasil.html before serving it
//   - All environments: /check-session validates the cookie asynchronously in the page component
//
// This guard only rejects URL-level session parameters that don't match our format,
// preventing link-sharing and URL-forging attacks. It sets window.__hasilSessionError
// so the React app can render contextual error states without a hard redirect.
(function() {
  var params = new URLSearchParams(location.search);
  var urlSession = params.get('session') || params.get('sessionId');
  if (urlSession !== null && !urlSession.startsWith('cvtext_')) {
    sessionStorage.removeItem('gaslamar_cv_key');
    window.__hasilSessionError = 'expired';
  }
})();
