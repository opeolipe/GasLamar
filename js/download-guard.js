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
 *   1. ?token=<hex>           — email link; download.js will call /exchange-token
 *   2. gaslamar_has_session=1 — non-sensitive routing flag set by payment.js (session_id itself is never stored client-side)
 *   3. gaslamar_session       — legacy routing hint for users who paid before cookie-only auth
 *   4. gaslamar_delivery      — email delivery confirmed; React handles session state
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
  if (token) { window.location.replace('/?reason=no_session'); return; }

  // Path 2: normal flow — presence flag written by payment.js after /create-payment.
  // The actual session_id is never stored client-side; the HttpOnly cookie is the
  // authoritative credential. This flag is only a routing hint for this guard.
  // gaslamar_session (legacy key) is also accepted for backward compatibility with
  // sessions established before the presence-flag refactor.
  try {
    if (localStorage.getItem('gaslamar_has_session') === '1') return;
    if (localStorage.getItem('gaslamar_session')) return;
  } catch (_) {
    // localStorage blocked (e.g. Safari strict private mode) — fail closed.
    window.location.replace('/?reason=no_session');
    return;
  }

  // Path 3: legacy normal flow. Do not send this ID to the Worker; it is only
  // a routing hint so pre-cookie sessions reach React and fail/recover cleanly.
  try {
    var legacySession = localStorage.getItem('gaslamar_session') || sessionStorage.getItem('gaslamar_session');
    if (/^sess_[A-Za-z0-9-]{8,64}$/.test(legacySession || '')) return;
  } catch (_) {
    window.location.replace('/?reason=no_session');
    return;
  }

  // Path 4: delivery flow — email was sent; React renders the delivery section.
  try {
    if (localStorage.getItem('gaslamar_delivery')) return;
  } catch (_) {
    // localStorage blocked — fail closed.
    window.location.replace('/?reason=no_session');
    return;
  }

  // No valid entry — redirect before body renders.
  window.location.replace('/?reason=no_session');
})();
