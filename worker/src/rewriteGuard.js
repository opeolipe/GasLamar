/**
 * Server-side rewrite validation guard.
 * Logic is driven by shared/rewriteRules.js constants — the single source
 * of truth shared with the frontend (lib/rewriteUtils.ts).
 */

import {
  MIN_LINE_LENGTH,
  MATCH_THRESHOLD,
  METRIC_PATTERN_SRC,
  TOOL_TERM_PATTERN_SRC,
  WEAK_FILLER,
  INFLATION_RULES,
  ISSUE_FALLBACK_SUFFIX,
  GENERIC_FALLBACK_SUFFIX,
  FALLBACK_NOTE,
  DOCX_GUIDANCE,
} from '../../shared/rewriteRules.js';

// Section headings — structure lines, never rewrite
const SECTION_HEADING_PATTERN =
  /^(RINGKASAN PROFESIONAL|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN|SERTIFIKASI|PROFESSIONAL SUMMARY|WORK EXPERIENCE|EDUCATION|SKILLS|CERTIFICATIONS)$/i;

// Date/company header lines — preserve verbatim
const META_LINE_PATTERN = /^\d{4}|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

// Pre-compile inflation patterns from shared rules
const INFLATION_COMPILED = INFLATION_RULES.map(r => ({
  pattern:   new RegExp(r.patternSrc, r.flags),
  impliedBy: r.impliedBySrc ? new RegExp(r.impliedBySrc, r.impliedFlags ?? 'i') : null,
}));

// ── Metric helpers ────────────────────────────────────────────────────────────

function extractMetrics(text) {
  return (text.match(new RegExp(METRIC_PATTERN_SRC, 'gi')) || [])
    .map(s => s.toLowerCase().trim());
}

export function addsNewNumbers(before, after) {
  const beforeSet = new Set(extractMetrics(before));
  return extractMetrics(after).some(m => !beforeSet.has(m));
}

// ── Claim guard ───────────────────────────────────────────────────────────────

function extractToolTerms(text) {
  return new Set(
    (text.match(new RegExp(TOOL_TERM_PATTERN_SRC, 'g')) || []).map(s => s.toLowerCase()),
  );
}

export function addsNewClaims(before, after) {
  const beforeTools = extractToolTerms(before);
  for (const term of extractToolTerms(after)) {
    if (!beforeTools.has(term)) return true;
  }
  for (const { pattern, impliedBy } of INFLATION_COMPILED) {
    if (pattern.test(after) && !pattern.test(before)) {
      if (impliedBy && impliedBy.test(before)) continue;
      return true;
    }
  }
  return false;
}

// ── Weak improvement ──────────────────────────────────────────────────────────

function isWeakImprovement(before, after) {
  const added = after.slice(before.length).toLowerCase();
  return WEAK_FILLER.some(phrase => added.includes(phrase));
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRewrite(before, after) {
  if (!before || !after) return false;
  if (before.trim() === after.trim()) return false;
  if (addsNewNumbers(before, after)) return false;
  if (addsNewClaims(before, after)) return false;
  if (isWeakImprovement(before, after)) return false;
  if (after.length <= before.length) return false;
  return true;
}

// ── Line utilities ────────────────────────────────────────────────────────────

export function cleanLine(text) {
  return text.replace(/^[\s•\-*]\s*/, '').trim();
}

function isBulletLine(line) {
  const t = line.trim();
  return /^[-•*]\s+/.test(t) ||
    (t.length > MIN_LINE_LENGTH && !SECTION_HEADING_PATTERN.test(t) && !META_LINE_PATTERN.test(t));
}

function extractBulletLines(cvText) {
  return cvText
    .split('\n')
    .map(l => cleanLine(l.trim()))
    .filter(l =>
      l.length >= MIN_LINE_LENGTH &&
      !SECTION_HEADING_PATTERN.test(l) &&
      !META_LINE_PATTERN.test(l),
    );
}

// Short original lines (< MIN_LINE_LENGTH) excluded from fuzzy matching above,
// but still need guarding against LLM expansion.
function extractShortOriginalLines(cvText) {
  return cvText
    .split('\n')
    .map(l => cleanLine(l.trim()))
    .filter(l =>
      l.length > 0 &&
      l.length < MIN_LINE_LENGTH &&
      !SECTION_HEADING_PATTERN.test(l) &&
      !META_LINE_PATTERN.test(l),
    );
}

// Returns the short original if the LLM line appears to be an expansion of it.
function findExpandedShortLine(llmClean, shortOriginals) {
  const lower = llmClean.toLowerCase();
  for (const short of shortOriginals) {
    if (lower.startsWith(short.toLowerCase())) return short;
  }
  return null;
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function wordOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (wordsA.size === 0) return 0;
  let count = 0;
  for (const w of wordsA) if (wordsB.has(w)) count++;
  return count / wordsA.size;
}

function findBestMatch(line, candidates) {
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const score = wordOverlap(line, c);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

// ── Safe fallback ─────────────────────────────────────────────────────────────

function safeRewriteLine(original, issue) {
  const suffix = (issue && ISSUE_FALLBACK_SUFFIX[issue]) ?? GENERIC_FALLBACK_SUFFIX;
  return original + suffix;
}

// ── Main post-processor ───────────────────────────────────────────────────────

/**
 * Post-process LLM CV output.
 *
 * Returns { text, isTrusted } where:
 *   - text:      the final CV string (safe to show to user)
 *   - isTrusted: true when the LLM output passed all validation checks
 *                (no fallbacks were needed); false if any bullet was replaced
 *
 * @param {string}      llmText
 * @param {string}      originalCVText
 * @param {string|null} issue
 * @param {string}      mode            'pdf' | 'docx'
 * @param {object}      opts            { previewSample?, previewAfter? }
 */
export function postProcessCV(llmText, originalCVText, issue = null, mode = 'pdf', opts = {}) {
  const { previewSample, previewAfter } = opts;
  const originalLines      = extractBulletLines(originalCVText);
  const shortOriginalLines = extractShortOriginalLines(originalCVText);
  let usedFallback         = false;

  // Step 1 — validate each bullet; replace hallucinated lines with safe fallback
  const outputLines = llmText.split('\n');
  const validated   = outputLines.map(line => {
    const trimmed = line.trim();
    if (!trimmed)                               return line;
    if (SECTION_HEADING_PATTERN.test(trimmed))  return line;
    if (META_LINE_PATTERN.test(trimmed))        return line;
    if (!isBulletLine(trimmed))                 return line;

    const clean = cleanLine(trimmed);
    if (clean.length < MIN_LINE_LENGTH)         return line;

    const original = findBestMatch(clean, originalLines);
    if (!original) {
      // Check if this line was expanded from a short original entry
      // (short lines are excluded from originalLines but the LLM may have expanded them)
      const shortOriginal = findExpandedShortLine(clean, shortOriginalLines);
      if (shortOriginal) {
        // Preserve the original verbatim — we cannot verify the expansion
        usedFallback = true;
        const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
        return prefix + shortOriginal;
      }
      return line; // no original found — trust LLM
    }

    if (!validateRewrite(original, clean)) {
      usedFallback = true;
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      return prefix + safeRewriteLine(original, issue);
    }

    return line;
  });

  let result = validated.join('\n');

  // Step 2 — preview consistency: inject exact preview.after into matching bullet
  // Only if previewAfter itself passes validation (never blindly trust FE data)
  if (previewSample && previewAfter) {
    const previewValid = validateRewrite(
      cleanLine(previewSample),
      previewAfter,
    );

    if (previewValid) {
      let replaced = false;
      const consistencyLines = result.split('\n').map(line => {
        if (replaced) return line;
        const clean = cleanLine(line.trim());
        if (wordOverlap(clean, previewSample) >= MATCH_THRESHOLD) {
          replaced = true;
          const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
          return prefix + previewAfter;
        }
        return line;
      });
      result = consistencyLines.join('\n');
    }
    // if previewAfter fails validation: silently skip — keep validated LLM line
  }

  // Step 3 — DOCX mode: append guidance hint after each bullet
  if (mode === 'docx') {
    const docxLines = result.split('\n').flatMap(line => {
      if (!line.trim() || !isBulletLine(line.trim())) return [line];
      return [line, `  ${DOCX_GUIDANCE}`];
    });
    result = docxLines.join('\n');
  }

  return { text: result, isTrusted: !usedFallback };
}
