/**
 * Input sanitization for user-supplied text.
 *
 * Three threat models addressed here:
 *
 * 1. Prompt injection — CV or JD text containing instruction-override phrases
 *    designed to make the LLM ignore its system prompt.  Two-tier defence:
 *      a) hasPromptInjection() → hard REJECT at the API boundary (high-confidence
 *         patterns that never appear in a legitimate CV/JD).
 *      b) stripPromptInjection() → strip residual low-confidence patterns before
 *         the text reaches any LLM call (defence-in-depth).
 *
 * 2. Control-character injection — null bytes, BEL, DEL, and other non-printable
 *    chars that can confuse downstream parsers or appear invisible in log viewers.
 *    Tabs (\t), newlines (\n), and carriage returns (\r) are preserved because
 *    CVs legitimately use them for layout.
 *
 * 3. Log injection — user-supplied values written to structured logs should be
 *    capped in length and stripped of control characters so they cannot corrupt
 *    JSON log lines.
 */

// Control characters: 0x00–0x08, 0x0B (VT), 0x0C (FF), 0x0E–0x1F, 0x7F (DEL).
// \t (0x09), \n (0x0A), \r (0x0D) are intentionally kept.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// ── Tier-1: Hard-reject patterns ──────────────────────────────────────────────
//
// High-confidence patterns that would never appear in a legitimate CV or job
// description.  hasPromptInjection() tests these and callers REJECT the request.
//
// Deliberately narrow: a false positive blocks a real user's CV.
// "jailbreak", "DAN mode" etc. stay in the strip-only tier because a security
// professional's CV might legitimately mention them.
const REJECTION_PATTERNS = [
  // LLM framework injection tokens (no legitimate document contains these)
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|system\|>/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /<\|eot_id\|>/i,
  /<\|start_header_id\|>/i,
  /<\|end_header_id\|>/i,
  // Classic LLM instruction-override phrases
  /\bignore\s+(all\s+)?(?:previous|above|prior)\s+instructions?\b/i,
  /\bforget\s+(all\s+)?(?:previous|above|prior)\s+instructions?\b/i,
  /\bdisregard\s+(all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?)\b/i,
  /\boverride\s+(?:all\s+)?system\s+(?:instructions?|prompts?)\b/i,
  /\bdo\s+not\s+follow\s+(?:the\s+)?(?:previous|above|prior|system)\s+instructions?\b/i,
  // Meta-instruction openers that begin context-switch attacks
  /\bfrom\s+now\s+on[,\s]+(?:you\s+(?:are|will|must|should)|act\s+as|ignore|forget|disregard)\b/i,
  // Role-hijacking with LLM-specific framing
  /\byou\s+are\s+now\s+(?:a|an|the)\s+(?:different|unrestricted|free|uncensored|unfiltered)\s+(?:AI|assistant|model|bot|language model)\b/i,
  /\bact\s+as\s+(?:a|an)\s+(?:unrestricted|free|uncensored|evil|unfiltered|DAN)\s+(?:AI|assistant|model|version)\b/i,
];

// ── Tier-2: Strip-only patterns ───────────────────────────────────────────────
//
// Lower-confidence patterns stripped silently before any LLM call.
// Includes everything in tier-1 plus broader phrasing that has some false-
// positive risk (e.g. "jailbreak" in a security-engineer's CV).
const STRIP_PATTERNS = [
  // All tier-1 patterns (re-declared so stripPromptInjection is self-contained)
  /\bignore\s+(all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|directives?|constraints?|rules?)\b/gi,
  /\bforget\s+(all\s+)?(?:previous|above|prior)\s+(?:instructions?|context|constraints?|rules?)\b/gi,
  /\bdisregard\s+(all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|constraints?|rules?)\b/gi,
  /\boverride\s+(?:all\s+)?(?:system\s+)?(?:instructions?|prompts?|constraints?|rules?)\b/gi,
  /\bdo\s+not\s+follow\s+(?:previous|above|prior|the\s+)?instructions?\b/gi,
  /\bfrom\s+now\s+on[,\s]+(?:you\s+(?:are|will|must|should)|act|ignore|forget|disregard)\b/gi,
  /\bnew\s+(?:task|instruction|directive|system\s+prompt)\s*:/gi,
  /\[SYSTEM\]/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|system\|>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|eot_id\|>/gi,
  /<\|start_header_id\|>/gi,
  /<\|end_header_id\|>/gi,
  /\byou\s+are\s+now\s+(?:a|an|the)\s+(?:different|new|another|unrestricted|free|uncensored|unfiltered)\b/gi,
  /\bact\s+as\s+(?:a|an)\s+(?:different|new|unrestricted|free|uncensored|evil|unfiltered|DAN)\b/gi,
  /\bpretend\s+(?:to\s+be|you\s+are)\s+(?:a|an)\s+(?:different|new|unrestricted|free|uncensored)\b/gi,
  // Broader / lower-confidence (strip only, not reject)
  /\bDAN\s+mode\b/gi,
  /\bjailbreak(?:ed|ing|ed\s+mode)?\b/gi,
  /\bprompt\s+injection\b/gi,
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the text contains high-confidence prompt injection patterns.
 * Callers should REJECT the request immediately when this returns true.
 *
 * Only tests tier-1 patterns (narrow + specific) to avoid false positives that
 * would block legitimate CVs from security professionals.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasPromptInjection(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return REJECTION_PATTERNS.some(p => p.test(text));
}

/**
 * Removes dangerous control characters and normalizes unicode to NFC.
 * Preserves whitespace characters used for CV layout (\t, \n, \r).
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeUserText(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFC').replace(CONTROL_CHAR_RE, '');
}

/**
 * Strips LLM prompt injection patterns from user-supplied text (tier-2, defence-
 * in-depth).  Uses empty-string replacement so surrounding legitimate content is
 * preserved.  Collapses runs of whitespace left by replacements (not line breaks).
 *
 * @param {string} text
 * @returns {string}
 */
export function stripPromptInjection(text) {
  if (typeof text !== 'string') return text;
  let s = text;
  for (const pattern of STRIP_PATTERNS) {
    s = s.replace(pattern, '');
  }
  return s.replace(/[ \t]{2,}/g, ' ');
}

/**
 * Full sanitization pipeline for any text that will be included in an LLM prompt.
 * Combines control-character removal, unicode normalization, and injection stripping.
 * Call hasPromptInjection() BEFORE this to hard-reject if needed.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeForLLM(text) {
  return stripPromptInjection(sanitizeUserText(text));
}

/**
 * Sanitizes a scalar value for safe inclusion in structured log entries.
 * Removes control characters and enforces a maximum length.
 *
 * @param {unknown} value
 * @param {number}  [maxLen=500]
 * @returns {unknown}
 */
export function sanitizeLogValue(value, maxLen = 500) {
  if (typeof value !== 'string') return value;
  return value.replace(CONTROL_CHAR_RE, '').slice(0, maxLen);
}

