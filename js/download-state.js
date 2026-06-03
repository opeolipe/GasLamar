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
const POLL_INITIAL_DELAY = 2000;            // ms for first poll tick
const POLL_MAX_DELAY     = 60000;           // ms cap for exponential backoff
const POLL_TIMEOUT_MS    = 10 * 60 * 1000; // stop polling after 10 minutes
const HEARTBEAT_INTERVAL = 3 * 60 * 1000;  // ms between session keep-alive pings

// ── Mutable session state ─────────────────────────────────────────────────────
let pollCount         = 0;
let notFoundCount     = 0;     // consecutive 404s — tracked separately for fast invalid-session detection
let pollCurrentDelay  = POLL_INITIAL_DELAY; // current backoff delay (doubles each attempt)
let pollStartTime     = 0;                  // epoch ms when polling started (for 10-min timeout)
let pollTimer         = null;
let heartbeatTimer    = null;
let countdownInterval = null;
let cvDataCache       = null;
let sessionIdCache    = null;

// ── clearClientSessionData ────────────────────────────────────────────────────
// Call whenever the server reports the session is gone (expired / invalid).
// Removes display-only credit values so stale data is never shown.
function clearClientSessionData(sessionId) {
  sessionStorage.removeItem('gaslamar_credits');       // defensive — key unused but cleared for hygiene
  sessionStorage.removeItem('gaslamar_score_summary'); // set by scoring.js, consumed by download-generation.js
  sessionStorage.removeItem('gaslamar_session');       // defensive — cleared for hygiene (sessionStorage variant)
  localStorage.removeItem('gaslamar_session');         // legacy: was set by payment.js before this fix
  localStorage.removeItem('gaslamar_has_session');     // presence flag set by payment.js; cleared here on session end
  localStorage.removeItem('gaslamar_tier');            // legacy belt-and-suspenders
  localStorage.removeItem('gaslamar_delivery');        // set by ResendEmail on resend success; holds {sessionId,email,sentAt}
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
  const genTierEl = document.getElementById('gen-tier');
  if (genTierEl) genTierEl.textContent = 'Paket: ' + (_TIER_LABELS[tier] || tier);
}
