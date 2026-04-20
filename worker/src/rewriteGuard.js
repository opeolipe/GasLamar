/**
 * Server-side rewrite validation guard.
 * Mirrors lib/rewriteUtils.ts logic for use in the Cloudflare Worker
 * (which cannot import TypeScript frontend modules).
 */

const MIN_LINE_LENGTH = 15;

const METRIC_PATTERN = /\b\d+(\.\d+)?\s*(%|x|k|m)?\b|\b\d+\s*(bulan|tahun|minggu|hari)\b/gi;

const INFLATED_CLAIM_PATTERNS = [
  { pattern: /\bmemimpin\s+tim\b/i,           impliedBy: /\b(mengelola|memimpin|koordinir|kepala|lead|manager|supervisi)\b/i },
  { pattern: /\bmeningkatkan\s+revenue\b/i,    impliedBy: /\b(revenue|pendapatan|penjualan|omzet|sales)\b/i },
  { pattern: /\bmengoptimalkan\s+biaya\b/i,    impliedBy: /\b(biaya|anggaran|budget|cost)\b/i },
  { pattern: /\btim\s+\d+\s*(orang|anggota)\b/i },   // always reject — specific count
  { pattern: /\bmempercepat\s+pertumbuhan\b/i, impliedBy: /\b(pertumbuhan|growth|kembang)\b/i },
];

const TOOL_TERM_PATTERN = /\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]\w*)\b/g;

const WEAK_FILLER = [
  'lebih baik', 'lebih efektif', 'lebih optimal',
  'lebih maksimal', 'dengan baik', 'secara efektif',
];

// Section headings — never rewrite these
const SECTION_HEADING_PATTERN =
  /^(RINGKASAN PROFESIONAL|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN|SERTIFIKASI|PROFESSIONAL SUMMARY|WORK EXPERIENCE|EDUCATION|SKILLS|CERTIFICATIONS)$/i;

// Date/company header lines — never rewrite these
const META_LINE_PATTERN = /^\d{4}|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

const DOCX_GUIDANCE = '(catatan: tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)';

const ISSUE_FALLBACK = {
  portfolio:        t => t + ' untuk menunjukkan dampak kerja secara lebih jelas',
  recruiter_signal: t => t + ' dengan fokus yang lebih spesifik pada peran dan hasil',
  north_star:       t => t + ' yang relevan dengan posisi yang ditargetkan',
  effort:           t => t + ' dengan konteks skill yang dibutuhkan untuk role ini',
  risk:             t => t + ' menggunakan pendekatan yang masih relevan saat ini',
};

// ── Metric helpers ────────────────────────────────────────────────────────────

function extractMetrics(text) {
  return (text.match(METRIC_PATTERN) || []).map(s => s.toLowerCase().trim());
}

export function addsNewNumbers(before, after) {
  const beforeSet = new Set(extractMetrics(before));
  return extractMetrics(after).some(m => !beforeSet.has(m));
}

// ── Claim guard ───────────────────────────────────────────────────────────────

function extractToolTerms(text) {
  return new Set((text.match(TOOL_TERM_PATTERN) || []).map(s => s.toLowerCase()));
}

export function addsNewClaims(before, after) {
  const beforeTools = extractToolTerms(before);
  for (const term of extractToolTerms(after)) {
    if (!beforeTools.has(term)) return true;
  }
  for (const { pattern, impliedBy } of INFLATED_CLAIM_PATTERNS) {
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

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function wordOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (wordsA.size === 0) return 0;
  let count = 0;
  for (const w of wordsA) if (wordsB.has(w)) count++;
  return count / wordsA.size;
}

function findBestMatch(line, candidates, threshold = 0.4) {
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const score = wordOverlap(line, c);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= threshold ? best : null;
}

// ── Safe fallback ─────────────────────────────────────────────────────────────

function safeRewriteLine(original, issue) {
  const fn = (issue && ISSUE_FALLBACK[issue]) ||
    (t => t + ' dengan hasil yang lebih jelas dan terstruktur');
  return fn(original);
}

// ── Main post-processor ───────────────────────────────────────────────────────

/**
 * Post-process LLM CV output:
 * 1. Validate each bullet against the original CV — fall back if hallucination detected
 * 2. Force preview line consistency (if previewSample + previewAfter provided)
 * 3. Append docx guidance notes if mode === 'docx'
 *
 * @param {string}      llmText         - Raw LLM output
 * @param {string}      originalCVText  - User's original CV (for reference matching)
 * @param {string|null} issue           - Primary issue key for issue-aware fallback
 * @param {string}      mode            - 'pdf' (clean) | 'docx' (with guidance notes)
 * @param {object}      opts            - { previewSample?, previewAfter? }
 * @returns {string}
 */
export function postProcessCV(llmText, originalCVText, issue = null, mode = 'pdf', opts = {}) {
  const { previewSample, previewAfter } = opts;
  const originalLines = extractBulletLines(originalCVText);

  // Step 1: validate each bullet line
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
    if (!original) return line; // no reference match — keep LLM output

    if (!validateRewrite(original, clean)) {
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      return prefix + safeRewriteLine(original, issue);
    }

    return line;
  });

  let result = validated.join('\n');

  // Step 2: force preview consistency — replace the matching line with exact preview.after
  if (previewSample && previewAfter) {
    let replaced = false;
    const consistencyLines = result.split('\n').map(line => {
      if (replaced) return line;
      const clean = cleanLine(line.trim());
      if (wordOverlap(clean, previewSample) >= 0.5) {
        replaced = true;
        const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
        return prefix + previewAfter;
      }
      return line;
    });
    result = consistencyLines.join('\n');
  }

  // Step 3: DOCX mode — append guidance hint after each bullet
  if (mode === 'docx') {
    const docxLines = result.split('\n').flatMap(line => {
      if (!line.trim() || !isBulletLine(line.trim())) return [line];
      return [line, `  ${DOCX_GUIDANCE}`];
    });
    result = docxLines.join('\n');
  }

  return result;
}
