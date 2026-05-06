/**
 * Input sanitization for user-supplied text.
 *
 * Three threat models addressed here:
 *
 * 1. Prompt injection — CV or JD text that contains instruction-override phrases
 *    designed to make the LLM ignore its system prompt ("ignore previous
 *    instructions", role-hijacking tokens, etc.).  Patterns are stripped rather
 *    than rejected so that surrounding legitimate content is preserved.
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

// ── Prompt injection patterns ─────────────────────────────────────────────────
//
// Each pattern targets a specific category of LLM jailbreak / instruction-override
// technique.  Matches are replaced with '' (empty) so surrounding text is undisturbed.
//
// Design principles:
// - Require enough context to avoid false-positives against legitimate CV content.
//   ("previous experience" must not match; "previous instructions" must.)
// - Use word-boundary anchors (\b) where available.
// - All patterns are case-insensitive (gi flags).
const INJECTION_PATTERNS = [
  // Classic instruction-override phrases
  /\bignore\s+(all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|directives?|constraints?|rules?)\b/gi,
  /\bforget\s+(all\s+)?(?:previous|above|prior)\s+(?:instructions?|context|constraints?|rules?)\b/gi,
  /\bdisregard\s+(all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|constraints?|rules?)\b/gi,
  /\boverride\s+(?:all\s+)?(?:system\s+)?(?:instructions?|prompts?|constraints?|rules?)\b/gi,
  /\bdo\s+not\s+follow\s+(?:previous|above|prior|the\s+)?instructions?\b/gi,
  // "From now on, act/ignore/forget/disregard ..."
  /\bfrom\s+now\s+on[,\s]+(?:you\s+(?:are|will|must|should)|act|ignore|forget|disregard)\b/gi,
  // "New task:", "New directive:", "New system prompt:" as instruction overrides
  /\bnew\s+(?:task|instruction|directive|system\s+prompt)\s*:/gi,
  // System-message injection tokens used by various LLM frameworks
  /\[SYSTEM\]/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|system\|>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|eot_id\|>/gi,
  /<\|start_header_id\|>/gi,
  /<\|end_header_id\|>/gi,
  // Role hijacking — "you are now a different/unrestricted AI"
  /\byou\s+are\s+now\s+(?:a|an|the)\s+(?:different|new|another|unrestricted|free|uncensored|unfiltered)\b/gi,
  /\bact\s+as\s+(?:a|an)\s+(?:different|new|unrestricted|free|uncensored|evil|unfiltered|DAN)\b/gi,
  /\bpretend\s+(?:to\s+be|you\s+are)\s+(?:a|an)\s+(?:different|new|unrestricted|free|uncensored)\b/gi,
  // DAN-mode and jailbreak keywords
  /\bDAN\s+mode\b/gi,
  /\bjailbreak(?:ed|ing|ed\s+mode)?\b/gi,
  /\bprompt\s+injection\b/gi,
];

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
 * Strips LLM prompt injection patterns from user-supplied text.
 * Uses empty-string replacement so surrounding legitimate content is preserved.
 * Collapses runs of whitespace left by replacements (excluding line breaks).
 *
 * @param {string} text
 * @returns {string}
 */
export function stripPromptInjection(text) {
  if (typeof text !== 'string') return text;
  let s = text;
  for (const pattern of INJECTION_PATTERNS) {
    s = s.replace(pattern, '');
  }
  // Collapse horizontal whitespace runs left by removals, preserving line breaks
  return s.replace(/[ \t]{2,}/g, ' ');
}

/**
 * Full sanitization pipeline for any text that will be included in an LLM prompt.
 * Combines control-character removal, unicode normalization, and injection stripping.
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
