/**
 * Server-side rewrite validation guard.
 *
 * Constants are inlined (not imported from shared/) so the Worker bundle has
 * zero file-system dependencies at runtime.  Keep in sync with
 * shared/rewriteRules.js — the comment "SYNC" marks every block that must
 * match its shared counterpart.
 */

// SYNC: shared/rewriteRules.js
const MIN_LINE_LENGTH = 15;
const MIN_WORD_COUNT  = 3;
const MATCH_THRESHOLD = 0.6;

// SYNC: shared/rewriteRules.js METRIC_PATTERN_SRC
const METRIC_PATTERN_SRC    = String.raw`\b\d+(\.\d+)?\s*(%|x|k|m)?\b|\b\d+\s*(bulan|tahun|minggu|hari)\b`;
// SYNC: shared/rewriteRules.js TOOL_TERM_PATTERN_SRC
const TOOL_TERM_PATTERN_SRC = String.raw`\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]\w*)\b`;

// SYNC: shared/rewriteRules.js INFLATION_RULES
const INFLATED_CLAIM_PATTERNS = [
  // Indonesian
  { pattern: /\bmemimpin\s+tim\b/i,           impliedBy: /\b(mengelola|memimpin|koordinir|kepala|lead|manager|supervisi)\b/i },
  { pattern: /\bmeningkatkan\s+revenue\b/i,    impliedBy: /\b(revenue|pendapatan|penjualan|omzet|sales)\b/i },
  { pattern: /\bmengoptimalkan\s+biaya\b/i,    impliedBy: /\b(biaya|anggaran|budget|cost)\b/i },
  { pattern: /\btim\s+\d+\s*(orang|anggota)\b/i },
  { pattern: /\bmempercepat\s+pertumbuhan\b/i, impliedBy: /\b(pertumbuhan|growth|kembang)\b/i },
  // English equivalents
  { pattern: /\bled\s+a\s+team\b/i,            impliedBy: /\b(manage|lead|supervise|head|director|coordinator)\b/i },
  { pattern: /\bteam\s+of\s+\d+\b/i },
  { pattern: /\bincreased\s+revenue\b/i,        impliedBy: /\b(revenue|sales|income|profit)\b/i },
  { pattern: /\boptimized\s+costs?\b/i,         impliedBy: /\b(cost|budget|expense|saving)\b/i },
  { pattern: /\baccelerated\s+growth\b/i,       impliedBy: /\b(growth|expand|scale|grow)\b/i },
  { pattern: /\bled\s+(cross[- ]functional|global|international)\b/i,
    impliedBy: /\b(cross[- ]functional|global|international|regional)\b/i },
];

// SYNC: shared/rewriteRules.js WEAK_FILLER
const WEAK_FILLER = [
  // Indonesian
  'lebih baik', 'lebih efektif', 'lebih optimal',
  'lebih maksimal', 'dengan baik', 'secara efektif',
  // English
  'more effectively', 'more efficiently', 'better results',
  'in a better way', 'more optimally',
];

// SYNC: shared/rewriteRules.js ISSUE_FALLBACK_SUFFIX
const ISSUE_FALLBACK = {
  portfolio:        ' untuk menunjukkan dampak kerja secara lebih jelas',
  recruiter_signal: ' dengan fokus yang lebih spesifik pada peran dan hasil',
  north_star:       ' yang relevan dengan posisi yang ditargetkan',
  effort:           ' dengan konteks skill yang dibutuhkan untuk role ini',
  risk:             ' menggunakan pendekatan yang masih relevan saat ini',
};
const GENERIC_FALLBACK_SUFFIX = ' dengan hasil yang lebih jelas dan terstruktur';

// DOCX guidance notes — bilingual, capped at DOCX_MAX_HINTS bullets per CV
const DOCX_GUIDANCE_ID = '(catatan: tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)';
const DOCX_GUIDANCE_EN = '(note: add concrete results if available, e.g., time ↓ or output ↑)';
const DOCX_MAX_HINTS   = 3;

// Section headings — structure lines, never rewrite
const SECTION_HEADING_PATTERN =
  /^(RINGKASAN PROFESIONAL|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN|SERTIFIKASI|PROFESSIONAL SUMMARY|WORK EXPERIENCE|EDUCATION|SKILLS|CERTIFICATIONS)$/i;

// Date/company header lines — preserve verbatim
const META_LINE_PATTERN = /^\d{4}|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

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

/**
 * Returns true if `after` introduces tool terms or inflated claims not in `before`.
 * @param {string}        before
 * @param {string}        after
 * @param {string[]|null} entitasKlaim - whitelist of claims already present in user's CV
 */
export function addsNewClaims(before, after, entitasKlaim = null) {
  const allowedTerms = entitasKlaim
    ? new Set(entitasKlaim.map(k => k.trim().toLowerCase()).filter(k => k.length > 2))
    : null;

  const beforeTools = extractToolTerms(before);
  for (const term of extractToolTerms(after)) {
    if (beforeTools.has(term)) continue;
    if (allowedTerms && allowedTerms.has(term)) continue;
    return true;
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

/**
 * @param {string}        before
 * @param {string}        after
 * @param {string[]|null} entitasKlaim
 */
export function validateRewrite(before, after, entitasKlaim = null) {
  if (!before || !after) return false;
  if (before.trim() === after.trim()) return false;
  if (addsNewNumbers(before, after)) return false;
  if (addsNewClaims(before, after, entitasKlaim)) return false;
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

// Short original lines (< MIN_LINE_LENGTH) are excluded from fuzzy matching
// but still need guarding — the LLM may expand them into longer hallucinations.
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

// Returns the short original if the LLM line starts with it (expansion detected).
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
  const suffix = (issue && ISSUE_FALLBACK[issue]) ?? GENERIC_FALLBACK_SUFFIX;
  return original + suffix;
}

// ── Main post-processor ───────────────────────────────────────────────────────

/**
 * Post-process LLM CV output:
 * 1. Validate each bullet — fall back to safe rewrite if hallucination detected
 * 2. Inject exact preview rewrite for consistency with Hasil page
 * 3. Append DOCX guidance notes (first DOCX_MAX_HINTS bullets) when mode='docx'
 *
 * @param {string}        llmText
 * @param {string}        originalCVText
 * @param {string|null}   issue          - Primary issue key for fallback suffix
 * @param {string}        mode           - 'pdf' (clean) | 'docx' (with guidance notes)
 * @param {object}        opts
 * @param {string}        [opts.previewSample]  - Original line shown as "before" in Hasil
 * @param {string}        [opts.previewAfter]   - Rewrite shown as "after" in Hasil
 * @param {string[]|null} [opts.entitasKlaim]   - Whitelist of claims already in user's CV
 * @param {string}        [opts.language]       - 'id' (default) | 'en' — DOCX guidance language
 * @returns {{ text: string, isTrusted: boolean }}
 */
export function postProcessCV(llmText, originalCVText, issue = null, mode = 'pdf', opts = {}) {
  const { previewSample, previewAfter, entitasKlaim = null, language = 'id' } = opts;
  const originalLines      = extractBulletLines(originalCVText);
  const shortOriginalLines = extractShortOriginalLines(originalCVText);

  let fallbackCount = 0;
  let totalBullets  = 0;

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

    // Word count guard — matches frontend generateRewrite() behaviour
    const wordCount = clean.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < MIN_WORD_COUNT)             return line;

    totalBullets++;

    const original = findBestMatch(clean, originalLines);
    if (!original) {
      // B4: if the LLM expanded a short original entry (e.g. "Admin" → longer text),
      // revert to the verbatim short original — we cannot verify the expansion.
      const shortOriginal = findExpandedShortLine(clean, shortOriginalLines);
      if (shortOriginal) {
        fallbackCount++;
        const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
        return prefix + shortOriginal;
      }
      return line; // no original found — trust LLM
    }

    if (!validateRewrite(original, clean, entitasKlaim)) {
      fallbackCount++;
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      return prefix + safeRewriteLine(original, issue);
    }

    return line;
  });

  let result = validated.join('\n');

  // Step 2 — inject exact preview rewrite for Hasil→Download consistency.
  // previewAfter was already validated in useAnalysisPolling before being stored,
  // so we trust it here without re-running validateRewrite.
  if (previewSample && previewAfter) {
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

  // Step 3 — DOCX mode: append guidance hint after first DOCX_MAX_HINTS bullets
  if (mode === 'docx') {
    const guidance = language === 'en' ? DOCX_GUIDANCE_EN : DOCX_GUIDANCE_ID;
    let hintsAdded = 0;
    const docxLines = result.split('\n').flatMap(line => {
      if (hintsAdded >= DOCX_MAX_HINTS) return [line];
      if (!line.trim() || !isBulletLine(line.trim())) return [line];
      hintsAdded++;
      return [line, `  ${guidance}`];
    });
    result = docxLines.join('\n');
  }

  // isTrusted: true when fallback rate is below 20% (or no bullets to validate)
  const fallbackRate = totalBullets > 0 ? fallbackCount / totalBullets : 0;
  const isTrusted    = fallbackRate < 0.2;

  return { text: result, isTrusted };
}
