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

// M3: Unicode format / invisible characters used to bypass word-boundary regexes.
// Attackers insert these between letters (e.g. "ig​nore") to defeat pattern
// matching while the word visually appears intact.
// Covered ranges (explicit \u escapes — no invisible chars in source):
//   U+00AD  soft hyphen
//   U+200B  zero-width space
//   U+200C  zero-width non-joiner
//   U+200D  zero-width joiner
//   U+200E  left-to-right mark
//   U+200F  right-to-left mark
//   U+202A  left-to-right embedding
//   U+202B  right-to-left embedding
//   U+202C  pop directional formatting
//   U+202D  left-to-right override
//   U+202E  right-to-left override
//   U+2060  word joiner
//   U+2061  function application (invisible)
//   U+2062  invisible times
//   U+2063  invisible separator
//   U+2064  invisible plus
//   U+206A  inhibit symmetric swapping
//   U+206B  activate symmetric swapping
//   U+206C  inhibit Arabic form shaping
//   U+206D  activate Arabic form shaping
//   U+206E  national digit shapes
//   U+206F  nominal digit shapes
//   U+FEFF  byte-order mark / zero-width no-break space
// Regex literal using explicit \u escapes so the source contains only printable ASCII.
// U+00AD soft-hyphen, U+200B-200F zero-width/marks, U+202A-202E bidi controls,
// U+2060-2064 word-joiner/invisible-ops, U+206A-206F deprecated format, U+FEFF BOM.
const UNICODE_FORMAT_RE = /[­​‌‍‎‏‪‫‬‭‮⁠⁡⁢⁣⁤⁪⁫⁬⁭⁮⁯﻿]/g;

// M1: Hard cap before running any regex to prevent ReDoS on adversarial inputs.
// Legitimate CVs and JDs are never longer than this; anything over is already rejected
// upstream by the endpoint body-size limits, but we guard here for defence-in-depth.
const MAX_SANITIZE_INPUT = 100_000;

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
  // Indonesian equivalents — must be narrow to avoid false-positives on legitimate CVs
  /\babaikan\s+(semua\s+)?(?:instruksi|perintah|arahan)\s+(?:sebelumnya|di\s+atas|sebelum\s+ini)\b/i,
  /\blupakan\s+(semua\s+)?(?:instruksi|perintah|arahan|konteks)\s+(?:sebelumnya|di\s+atas|sebelum\s+ini)\b/i,
  /\btidak\s+perlu\s+mengikuti\s+(?:instruksi|perintah|arahan)\s+(?:sebelumnya|sistem)\b/i,
  /\bganti\s+(?:semua\s+)?(?:instruksi|perintah|sistem\s+prompt)\b/i,
  /\bkamu\s+sekarang\s+adalah\s+(?:AI|asisten|model|bot)\s+(?:yang\s+)?(?:berbeda|bebas|tanpa\s+batasan|tidak\s+terkekang)\b/i,
  /\bbertindak\s+sebagai\s+(?:AI|asisten|model)\s+(?:yang\s+)?(?:bebas|tanpa\s+batasan|tidak\s+terkekang|jahat)\b/i,
  /\bsystem\s+prompt\s+baru\s*:/i,
  /\binstruksi\s+baru\s*:/i,
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
  // Indonesian strip patterns (broader phrasing, lower confidence)
  /\babaikan\s+(semua\s+)?(?:instruksi|perintah|arahan)/gi,
  /\blupakan\s+(semua\s+)?(?:instruksi|perintah|arahan|konteks)/gi,
  /\bkamu\s+sekarang\s+adalah\b/gi,
  /\bbertindak\s+sebagai\s+(?:AI|asisten|model)\b/gi,
  /\bberperan\s+sebagai\s+(?:AI|asisten|model)\b/gi,
  /\bpura-pura\s+(?:menjadi|kamu\s+adalah)\b/gi,
  /\bsystem\s+prompt\s+baru/gi,
  /\binstruksi\s+baru\s*:/gi,
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
  // M2: Throw on non-string so callers discover misuse at call-site rather than
  // silently receiving 'false' (no injection detected) for a null/object argument.
  if (typeof text !== 'string') throw new TypeError('hasPromptInjection: text must be a string');
  if (text.length === 0) return false;
  // M1: Cap input length before running alternation-heavy regexes (ReDoS guard).
  const sample = text.length > MAX_SANITIZE_INPUT ? text.slice(0, MAX_SANITIZE_INPUT) : text;
  // M3: Strip Unicode format/invisible characters, then apply NFKC normalization.
  // Attackers insert zero-width chars (U+200B, U+00AD, bidi overrides, etc.) between
  // letters to defeat word-boundary regexes while the word visually appears intact.
  // Stripping these first, then normalizing, produces the canonical plaintext form.
  const normalized = sample.replace(UNICODE_FORMAT_RE, '').normalize('NFKC');
  return REJECTION_PATTERNS.some(p => p.test(normalized));
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
  // M1: Cap before running strip patterns to prevent ReDoS on adversarial inputs.
  let s = text.length > MAX_SANITIZE_INPUT ? text.slice(0, MAX_SANITIZE_INPUT) : text;
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
  // Slice to maxLen first so the three PII regexes run on at most maxLen chars
  // (prevents O(n²) scan on adversarial 8 KB field values). A second slice at
  // the end re-caps the output because replacements may expand the string.
  return value
    .replace(CONTROL_CHAR_RE, '')
    .slice(0, maxLen)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
    .replace(/([?&](?:token|session|session_secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(session_secret|token|secret|password)\s*[:=]\s*['"]?[^'",\s}&]+/gi, '$1=[REDACTED]')
    .replace(/\bsess_[A-Za-z0-9-]{8,64}\b/g, '[SESSION_REDACTED]')
    .slice(0, maxLen);
}
