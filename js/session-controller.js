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
 * sessionStorage (tab-scoped, cleared on tab close):
 *   gaslamar_cv_key          cvtext_<token> from /analyze (32-byte random hex)
 *   gaslamar_analyze_time    Unix ms timestamp of last /analyze call
 *   gaslamar_score_summary   { skor, gap[], primary_issue } — passed to /generate email
 *   gaslamar_tier            Server-confirmed tier (corrected on poll response)
 *   gaslamar_filename        CV filename for display purposes only
 *
 * localStorage (persistent across tabs):
 *   gaslamar_session         session_id ('sess_<uuid>') — set by payment.js
 *   gaslamar_delivery        Truthy when email delivery was confirmed (delivery flow)
 *
 * sessionStorage (tab-scoped — cleared on tab close):
 *   gaslamar_secret_<id>     Session secret — sent as X-Session-Secret header.
 *                            Tab-scoped intentionally: limits XSS exposure window.
 *                            After tab close, users re-access via email link (?token=).
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
 * Returns the cvtext_ key + timestamp from sessionStorage if fresh, null otherwise.
 * ANALYSIS_FRESHNESS_MS must match the 2h window in hasil-guard.js and the KV TTL.
 */
const ANALYSIS_FRESHNESS_MS = 7200000; // 2 hours

function getAnalysisSession() {
  try {
    const key  = sessionStorage.getItem('gaslamar_cv_key') || '';
    const time = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0', 10);
    if (!key.startsWith('cvtext_') || !time) return null;
    if (Date.now() - time > ANALYSIS_FRESHNESS_MS) return null;
    return { key, time };
  } catch (_) {
    return null;
  }
}

/** Clears all analysis-phase sessionStorage keys. */
function clearAnalysisSession() {
  try {
    ['gaslamar_cv_key', 'gaslamar_analyze_time', 'gaslamar_score_summary',
     'gaslamar_scoring', 'gaslamar_tier', 'gaslamar_filename'].forEach(function(k) {
      sessionStorage.removeItem(k);
    });
  } catch (_) {}
}

// ── Download session helpers ──────────────────────────────────────────────────

/**
 * Returns the session_id from localStorage if it looks valid, null otherwise.
 * The actual session is verified server-side; this is purely a format check.
 */
function getDownloadSessionId() {
  try {
    var id = localStorage.getItem('gaslamar_session');
    return (id && id.startsWith('sess_')) ? id : null;
  } catch (_) {
    return null;
  }
}

/**
 * Removes all client-side download session data.
 * Call when the server reports the session is gone (expired / exhausted).
 */
function clearDownloadSession(sessionId) {
  try {
    sessionStorage.removeItem('gaslamar_tier');
    sessionStorage.removeItem('gaslamar_score_summary');
    localStorage.removeItem('gaslamar_session');
    localStorage.removeItem('gaslamar_delivery');
    if (sessionId) sessionStorage.removeItem('gaslamar_secret_' + sessionId);
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
