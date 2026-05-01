// ── Module: download-state.js ─────────────────────────────────────────────────
// Shared constants, mutable session state, and two low-level state helpers.
//
// All identifiers declared here live in the concatenated bundle's global scope
// and are read/written freely by every other download-*.js module.
// There is no encapsulation — this is intentional for the concat-based build.
//
// cvDataCache shape:
//   { cv_id: string, cv_en: string, tier: string,
//     total_credits: number, job_title: string|null, company: string|null }

// ── Polling configuration ─────────────────────────────────────────────────────
const POLL_INTERVAL      = 3000;            // ms between poll ticks
const MAX_POLLS          = 40;              // stop auto-polling after this many attempts (40×3s = 2 min for webhook propagation)
const HEARTBEAT_INTERVAL = 3 * 60 * 1000;  // ms between session keep-alive pings

// ── Mutable session state ─────────────────────────────────────────────────────
let pollCount         = 0;
let notFoundCount     = 0;     // consecutive 404s — tracked separately for fast invalid-session detection
let pollTimer         = null;
let heartbeatTimer    = null;
let countdownInterval = null;
let cvDataCache       = null;
let sessionIdCache    = null;
let sessionSecretCache = null;

// ── clearClientSessionData ────────────────────────────────────────────────────
// Call whenever the server reports the session is gone (expired / invalid).
// Removes display-only tier/credit values so stale data is never shown.
// NOTE: these keys are UI-only; the backend never trusts client-side storage.
function clearClientSessionData(sessionId) {
  sessionStorage.removeItem('gaslamar_tier');
  sessionStorage.removeItem('gaslamar_credits');       // defensive — key unused but cleared for hygiene
  sessionStorage.removeItem('gaslamar_score_summary'); // set by scoring.js, consumed by download-generation.js
  localStorage.removeItem('gaslamar_session');
  localStorage.removeItem('gaslamar_tier');            // legacy belt-and-suspenders
  if (sessionId) localStorage.removeItem('gaslamar_secret_' + sessionId);
}

// ── getSecretHeaders ──────────────────────────────────────────────────────────
// Returns the X-Session-Secret header object (or {}) for credentialed requests.
// Centralises the four identical inline constructions from the original file.
function getSecretHeaders() {
  return sessionSecretCache ? { 'X-Session-Secret': sessionSecretCache } : {};
}

// ── syncTierFromServer ────────────────────────────────────────────────────────
// Overwrites the client-stored tier with the server-confirmed value.
// Logs a warning and corrects the generating-screen label if a client/server
// mismatch is detected. The backend always enforces the correct tier —
// this is a UI correction only, not a security gate.
const _TIER_LABELS = {
  coba:    'Coba Dulu',
  single:  'Single',
  '3pack': '3-Pack',
  jobhunt: 'Job Hunt Pack',
};

function syncTierFromServer(tier) {
  if (!tier) return;
  const stored = sessionStorage.getItem('gaslamar_tier');
  if (stored && stored !== tier) {
    console.warn(
      '[GasLamar] sessionStorage.gaslamar_tier tamper detected (' +
      stored + ' \u2192 ' + tier + '). Backend enforces correct tier; UI corrected.'
    );
    const genTierEl = document.getElementById('gen-tier');
    if (genTierEl) genTierEl.textContent = 'Paket: ' + (_TIER_LABELS[tier] || tier);
  }
  sessionStorage.setItem('gaslamar_tier', tier);
}
