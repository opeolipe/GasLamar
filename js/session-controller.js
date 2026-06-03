/**
 * session-controller.js — GasLamar
 *
 * Single source of truth for session state names and recovery helpers shared
 * across the frontend. Pages (download, hasil, analyzing) import utilities here
 * rather than duplicating state names and storage keys.
 *
 * Session state machine (mirrors worker/src/sessionStates.js):
 *
 *   pending_payment  Payment not yet confirmed by Mayar webhook.
 *                    Legacy sessions created before the rename may carry 'pending'.
 *   paid             Payment confirmed, first generation not yet started.
 *   generating       CV tailoring in progress.
 *   ready            Generation succeeded, cv_result_ stored, more credits remain.
 *   exhausted        All credits consumed; cv_result_ is still accessible.
 *
 * Transitions:
 *   pending_payment → paid        POST /webhook/mayar
 *   paid            → generating  POST /get-session
 *   ready           → generating  POST /get-session (next use, multi-credit)
 *   generating      → paid        POST /generate  (failed — rollback)
 *   generating      → ready       POST /generate  (succeeded, credits > 0)
 *   generating      → exhausted   POST /generate  (succeeded, last credit)
 *
 * Storage keys
 * ─────────────────────────────────────────────────────────────────────────────
 * Cookies (HttpOnly — not readable by JS):
 *   cv_key           cvtext_<64-hex> — analysis-session token from /analyze. Set by server.
 *   session_id       sess_<uuid> — download/generation session. Set by /create-payment.
 *
 * sessionStorage (tab-scoped, cleared on tab close):
 *   gaslamar_analyze_time    Unix ms timestamp of last /analyze call
 *   gaslamar_score_summary   { skor, gap[], primary_issue } — passed to /generate email
 *   gaslamar_filename        CV filename for display purposes only
 *   gaslamar_cv_key          LEGACY: cvtext_<token> still present in old sessions
 *                            (analyzed before the HttpOnly cookie migration). Absent for
 *                            new sessions; the cv_key cookie is authoritative.
 *
 * payment.js writes a non-sensitive presence flag (gaslamar_has_session=1) so
 * download-guard.js can pass the user through on Mayar's post-payment redirect.
 * The actual session_id is never written to client storage. Download pages verify
 * the session via /check-session using the HttpOnly cookie.
 */

// ── State name constants ──────────────────────────────────────────────────────
// Keep in sync with worker/src/sessionStates.js.
const SESSION_STATES = {
  PENDING_PAYMENT: 'pending_payment',
  PENDING_LEGACY:  'pending',         // backward-compat alias
  PAID:            'paid',
  GENERATING:      'generating',
  READY:           'ready',
  EXHAUSTED:       'exhausted',
};

/**
 * Returns true if the given status indicates the session is awaiting payment.
 * Handles both new ('pending_payment') and legacy ('pending') values.
 */
function isAwaitingPayment(status) {
  return status === SESSION_STATES.PENDING_PAYMENT ||
         status === SESSION_STATES.PENDING_LEGACY;
}

/**
 * Returns true if the session is in a state where a generation can be triggered.
 * Used by download-api.js to decide whether to proceed or keep polling.
 */
function canTriggerGeneration(status) {
  return (
    status === SESSION_STATES.PAID ||
    status === SESSION_STATES.READY ||
    status === SESSION_STATES.GENERATING
  );
}

/**
 * Returns true if the session has been fully consumed (all credits used).
 * /check-session returns this state instead of 404 so the client knows why.
 */
function isExhausted(status) {
  return status === SESSION_STATES.EXHAUSTED;
}

// ── Analysis session helpers ──────────────────────────────────────────────────

/**
 * Returns the analyze_time (+ legacy cv_key if present) if the analysis session is fresh.
 * ANALYSIS_FRESHNESS_MS must match SESSION_SECS in hasil-guard.js / hasil-page.js
 * and the expirationTtl in worker/src/handlers/analyze.js (86400 s = 24 h).
 *
 * Note: cv_key is now an HttpOnly cookie for new sessions — not in sessionStorage.
 * This function returns { time } for new sessions and { key, time } for old sessions
 * that still carry the legacy key in storage.
 */
const ANALYSIS_FRESHNESS_MS = 86400000; // 24 hours

function getAnalysisSession() {
  try {
    const time = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0', 10);
    if (!time) return null;
    if (Date.now() - time > ANALYSIS_FRESHNESS_MS) return null;
    // Legacy: old sessions still have the key in storage. New sessions use the HttpOnly cookie.
    const key = sessionStorage.getItem('gaslamar_cv_key') || '';
    return key ? { key, time } : { time };
  } catch (_) {
    return null;
  }
}

/** Clears all analysis-phase sessionStorage keys. */
function clearAnalysisSession() {
  try {
    ['gaslamar_cv_key', 'gaslamar_analyze_time', 'gaslamar_score_summary',
     'gaslamar_scoring', 'gaslamar_filename'].forEach(function(k) {
      sessionStorage.removeItem(k);
    });
  } catch (_) {}
}

// ── Download session helpers ──────────────────────────────────────────────────

/**
 * Legacy no-op retained for older inline scripts. The session_id is HttpOnly
 * cookie-backed and is no longer readable from client storage.
 */
function getDownloadSessionId() {
  return null;
}

/**
 * Removes all client-side download session data.
 * Call when the server reports the session is gone (expired / exhausted).
 */
function clearDownloadSession(sessionId) {
  try {
    sessionStorage.removeItem('gaslamar_tier');
    sessionStorage.removeItem('gaslamar_score_summary');
    sessionStorage.removeItem('gaslamar_session');
    localStorage.removeItem('gaslamar_session');
    localStorage.removeItem('gaslamar_has_session');
  } catch (_) {}
}

// ── Exports ───────────────────────────────────────────────────────────────────
// Exposed on window so pages loaded via <script src="..."> can access them.
window.GasLamarSession = {
  STATES:                SESSION_STATES,
  ANALYSIS_FRESHNESS_MS: ANALYSIS_FRESHNESS_MS,
  isAwaitingPayment:     isAwaitingPayment,
  canTriggerGeneration:  canTriggerGeneration,
  isExhausted:           isExhausted,
  getAnalysisSession:    getAnalysisSession,
  clearAnalysisSession:  clearAnalysisSession,
  getDownloadSessionId:  getDownloadSessionId,
  clearDownloadSession:  clearDownloadSession,
};
