/**
 * Canonical session state machine for GasLamar paid sessions.
 *
 * States
 * ------
 * pending_payment  Session created, awaiting Mayar webhook confirmation.
 *                  Previously called 'pending' — old KV entries may still carry that value.
 * paid             Payment confirmed, no generation started yet.
 * generating       CV tailoring in progress (lock_<id> is held).
 * ready            Generation succeeded; cv_result_ is stored; credits remain.
 * exhausted        All credits consumed; session preserved for audit / recovery.
 *                  cv_result_ is still accessible via /get-result.
 *
 * Transitions
 * -----------
 * pending_payment → paid        POST /webhook/mayar (payment confirmed)
 * paid            → generating  POST /get-session   (first generation)
 * ready           → generating  POST /get-session   (subsequent generation, multi-credit)
 * generating      → paid        POST /generate      (failed — rollback for retry, no cv_result_ yet)
 * generating      → ready       POST /generate      (succeeded, credits_remaining > 0)
 * generating      → exhausted   POST /generate      (succeeded, last credit consumed)
 *
 * Terminal states
 * ---------------
 * exhausted — no further transitions; session expires by KV TTL.
 */

export const SESSION_STATES = {
  PENDING_PAYMENT: 'pending_payment',
  PAID:            'paid',
  GENERATING:      'generating',
  READY:           'ready',
  EXHAUSTED:       'exhausted',
};

// Backward-compat alias: sessions created before the rename still carry 'pending'.
// Any code that checks for PENDING_PAYMENT must also accept PENDING_LEGACY.
export const PENDING_LEGACY = 'pending';

/**
 * Returns true if the session is in a state that allows starting a new generation.
 * Accepted by /get-session.
 */
export function canStartGeneration(status) {
  return (
    status === SESSION_STATES.PAID ||
    status === SESSION_STATES.READY ||
    status === SESSION_STATES.GENERATING // retry after failed generate
  );
}

/**
 * Returns true if the session has reached a terminal state (no further writes expected).
 */
export function isTerminal(status) {
  return status === SESSION_STATES.EXHAUSTED;
}
