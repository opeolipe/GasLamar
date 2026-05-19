/**
 * download-guard.js — GasLamar
 *
 * Synchronous session guard for /download.html.
 * Loaded as a blocking <script> in <head> so it runs before the body renders,
 * preventing any flash of unauthenticated content.
 *
 * Why not check the session_id cookie directly?
 *   The session_id cookie is HttpOnly — JavaScript cannot read it. The Worker
 *   performs the production page gate before serving /download.html, while
 *   download.js bootstraps from either localStorage or the cookie-backed
 *   /check-session endpoint.
 *
 * Valid entry paths — guard allows these through:
 *   1. ?token=<hex>  — email link; download.js will call /exchange-token
 *   2. normal page load — server gate + download.js cookie/localStorage bootstrap
 *
 * Invalid token format → immediate replace-redirect to /
 */
(function () {
  var params = new URLSearchParams(location.search);

  // Path 1: email link — token exchange happens inside download.js.
  // Validate format (32 hex chars = 128-bit token) to prevent content flash
  // from a garbage token that would pass the guard but fail server-side.
  var token = params.get('token');
  if (token && /^[0-9a-f]{32}$/.test(token)) return;
  if (token) window.location.replace('/');
})();
