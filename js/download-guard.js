/**
 * download-guard.js — GasLamar
 *
 * Synchronous session guard for /download.html.
 * Loaded as a blocking <script> in <head> so it runs before the body renders,
 * preventing any flash of unauthenticated content.
 *
 * Why not check the session_id cookie directly?
 *   The session_id cookie is HttpOnly — JavaScript cannot read it. In production
 *   the Worker performs a server-side gate before proxying /download.html. This
 *   JS guard handles the fallback for staging and direct-Pages access where the
 *   server-side gate does not run.
 *
 * Valid entry paths — guard allows these through:
 *   1. ?token=<hex>      — email link; download.js will call /exchange-token
 *   2. gaslamar_session  — normal post-payment flow set by payment.js
 *   3. gaslamar_delivery — email delivery confirmed; React handles session state
 *
 * All other cases → immediate replace-redirect to /
 * (window.location.replace so the download page is not added to browser history).
 */
(function () {
  var params = new URLSearchParams(location.search);

  // Path 1: email link — token exchange happens inside download.js.
  // Validate format (32 hex chars = 128-bit token) to prevent content flash
  // from a garbage token that would pass the guard but fail server-side.
  var token = params.get('token');
  if (token && /^[0-9a-f]{32}$/.test(token)) return;
  if (token) { window.location.replace('/'); return; }

  // Path 2: normal flow — session_id stored by payment.js after /create-payment.
  // In production the server-side Worker gate already verified the session cookie,
  // but this check also guards staging and direct-Pages access.
  try {
    var sessionId = localStorage.getItem('gaslamar_session');
    if (sessionId && sessionId.startsWith('sess_')) return;
  } catch (_) {
    // localStorage blocked (e.g. Safari strict private mode) — fail closed.
    window.location.replace('/');
    return;
  }

  // Path 3: delivery flow — email was sent; React renders the delivery section.
  try {
    if (localStorage.getItem('gaslamar_delivery')) return;
  } catch (_) {
    // localStorage blocked — fail closed.
    window.location.replace('/');
    return;
  }

  // No valid entry — redirect before body renders.
  window.location.replace('/');
})();
