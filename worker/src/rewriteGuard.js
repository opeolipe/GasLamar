/**
 * Server-side rewrite validation guard.
 *
 * Constants are inlined (not imported from shared/) so the Worker bundle has
 * zero file-system dependencies at runtime.  Keep in sync with
 * shared/rewriteRules.js — the comment "SYNC" marks every block that must
 * match its shared counterpart.
 */

const MIN_LINE_LENGTH = 20;
const MIN_WORD_COUNT  = 4;
const MATCH_THRESHOLD = 0.6;

// Use source strings to avoid shared lastIndex on global regexes
// SYNC: Must stay identical to shared/rewriteRules.js
const METRIC_PATTERN_SRC    = String.raw`\b\d+(\.\d+)?\s*(%|x|k|m)?\b|\b\d+\s*(bulan|tahun|minggu|hari)\b`;
const TOOL_TERM_PATTERN_SRC = String.raw`\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]\w*)\b`;

// SYNC: Must stay identical to shared/rewriteRules.js INFLATION_RULES.
const INFLATED_CLAIM_PATTERNS = [
  // Indonesian
  { pattern: /\bmemimpin\s+tim\b/i,           impliedBy: /\b(mengelola|memimpin|koordinir|kepala|lead|manager|supervisi)\b/i },
  { pattern: /\bmeningkatkan\s+revenue\b/i,    impliedBy: /\b(revenue|pendapatan|penjualan|omzet|sales)\b/i },
  { pattern: /\bmengoptimalkan\s+biaya\b/i,    impliedBy: /\b(biaya|anggaran|budget|cost)\b/i },
  { pattern: /\btim\s+\d+\s*(orang|anggota)\b/i },
  { pattern: /\bmempercepat\s+pertumbuhan\b/i, impliedBy: /\b(pertumbuhan|growth|kembang)\b/i },
  // English equivalents
  { pattern: /\bled\s+a\s+team\b/i,            impliedBy: /\b(manage|lead|supervise|head|director|coordinator)\b/i },
  { pattern: /\bincreased\s+revenue\b/i,        impliedBy: /\b(revenue|sales|income|profit)\b/i },
  { pattern: /\boptimized\s+costs?\b/i,         impliedBy: /\b(cost|budget|expense|saving)\b/i },
  { pattern: /\bteam\s+of\s+\d+\b/i },
  { pattern: /\baccelerated\s+growth\b/i,       impliedBy: /\b(growth|expand|scale|grow)\b/i },
  { pattern: /\bled\s+(cross[- ]functional|global|international)\b/i,
    impliedBy: /\b(cross[- ]functional|global|international|regional)\b/i },
];

// SYNC: Must stay identical to shared/rewriteRules.js WEAK_FILLER.
const WEAK_FILLER = [
  // Indonesian
  'lebih baik', 'lebih efektif', 'lebih optimal',
  'lebih maksimal', 'dengan baik', 'secara efektif',
  // English
  'more effectively', 'more efficiently', 'better results',
  'in a better way', 'more optimally',
];

// Placeholder pattern — LLM template artifacts that must never appear in final CV
const PLACEHOLDER_PATTERN = /\[[^\]]{1,60}\]/;

// Section headings — never rewrite these
const SECTION_HEADING_PATTERN =
  /^(RINGKASAN PROFESIONAL|RINGKASAN|PENGALAMAN KERJA|PENGALAMAN|PENDIDIKAN|KEAHLIAN|KEMAMPUAN|SERTIFIKASI|SERTIFIKAT|PENCAPAIAN|PROYEK|BAHASA|REFERENSI|KEPEMIMPINAN|PROFESSIONAL SUMMARY|SUMMARY|WORK EXPERIENCE|EXPERIENCE|EDUCATION|SKILLS|TECHNICAL SKILLS|CERTIFICATIONS|ACHIEVEMENTS|PROJECTS|LANGUAGES|REFERENCES|LEADERSHIP|ACTIVITIES)$/i;

// Date/company header lines starting with year or month — preserve verbatim
const META_LINE_PATTERN = /^\d{4}|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

// Lines that must never be treated as experience bullets:
// 1. Contact info: contains @ (email) or phone-number pattern
const CONTACT_LINE_PATTERN = /@|(?:^\+|^08|^62)\d{6,}/;
// 2. Role/company header separators: pipes or em-dashes used as column separators
const SEPARATOR_LINE_PATTERN = /\||—|–|—|–/;
// 3. Lines ending with a 4-digit year or year-range (dates in role headers)
const YEAR_ENDING_PATTERN = /\b(19|20)\d{2}\s*(-|–|—|s\/d|to)?\s*(present|sekarang|(19|20)\d{2})?\s*$/i;
// 4. Education indicators (degree keywords, GPA/IPK)
const EDUCATION_LINE_PATTERN = /^(S[123]|D[123]|SMA|SMK|SD|Bachelor|Master|PhD|Sarjana|Magister|Doktor|Diploma)\b|IPK|GPA|\b(Universitas|Institut|Sekolah|College|University|Institute)\b/i;

const DOCX_GUIDANCE_ID  = '(catatan: tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)';
const DOCX_GUIDANCE_EN  = '(note: add concrete results if available, e.g., time ↓ or output ↑)';
const DOCX_MAX_HINTS    = 3;

// SYNC: Must stay identical to shared/rewriteRules.js ISSUE_FALLBACK_SUFFIX.
const ISSUE_FALLBACK = {
  portfolio:        ' untuk menunjukkan dampak kerja secara lebih jelas',
  recruiter_signal: ' dengan fokus yang lebih spesifik pada peran dan hasil',
  north_star:       ' yang relevan dengan posisi yang ditargetkan',
  effort:           ' dengan konteks skill yang dibutuhkan untuk role ini',
  risk:             ' menggunakan pendekatan yang masih relevan saat ini',
};
const GENERIC_FALLBACK_SUFFIX = ' dengan hasil yang lebih jelas dan terstruktur';

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
 * Returns true if `after` introduces tool terms or inflated claims not present in `before`.
 * @param {string}        before
 * @param {string}        after
 * @param {string[]|null} entitasKlaim - normalized whitelist from user's own CV (may be null)
 */
export function addsNewClaims(before, after, entitasKlaim = null) {
  // Normalize whitelist once: lowercase, trim, drop single-char tokens
  const allowedTerms = entitasKlaim
    ? new Set(entitasKlaim.map(k => k.trim().toLowerCase()).filter(k => k.length > 2))
    : null;

  const beforeTools = extractToolTerms(before);
  for (const term of extractToolTerms(after)) {
    if (beforeTools.has(term)) continue;
    if (allowedTerms && allowedTerms.has(term)) continue; // explicitly in CV whitelist
    return true; // new tool/tech term not in original
  }

  for (const { pattern, impliedBy } of INFLATED_CLAIM_PATTERNS) {
    if (pattern.test(after) && !pattern.test(before)) {
      if (impliedBy && impliedBy.test(before)) continue; // implied by existing context
      return true;
    }
  }

  return false;
}

// ── Weak improvement ──────────────────────────────────────────────────────────

function isWeakImprovement(before, after) {
  const lowerAfter  = after.toLowerCase();
  const lowerBefore = before.toLowerCase();
  return WEAK_FILLER.some(phrase => lowerAfter.includes(phrase) && !lowerBefore.includes(phrase));
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
  // Only lines with an explicit bullet marker are experience bullets.
  // Proper-noun lines (company names, job titles, education, contact info)
  // never start with these markers, so they are never rewritten.
  return /^[-•*]\s+/.test(t);
}

// Returns true for lines that carry CV metadata (headers, contact, education)
// and must never receive a fallback suffix regardless of how they are classified.
function isNonBulletCVLine(t) {
  if (CONTACT_LINE_PATTERN.test(t))   return true;
  if (SEPARATOR_LINE_PATTERN.test(t)) return true;
  if (YEAR_ENDING_PATTERN.test(t))    return true;
  if (EDUCATION_LINE_PATTERN.test(t)) return true;
  // Short lines (names, single-word entries) must not be rewritten
  if (t.split(/\s+/).length <= 2)     return true;
  return false;
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
 * 1. Validate each bullet against original CV — fall back if hallucination detected
 * 2. Force preview line consistency (if previewSample + previewAfter provided)
 * 3. Append DOCX guidance notes (first DOCX_MAX_HINTS bullets only) if mode === 'docx'
 *
 * @param {string}        llmText        - Raw LLM output
 * @param {string}        originalCVText - User's original CV (for reference matching)
 * @param {string|null}   issue          - Primary issue key for issue-aware fallback
 * @param {string}        mode           - 'pdf' (clean) | 'docx' (with guidance notes)
 * @param {object}        opts
 * @param {string}        [opts.previewSample]  - Original line shown as "before" in Hasil
 * @param {string}        [opts.previewAfter]   - Rewrite shown as "after" in Hasil
 * @param {string[]|null} [opts.entitasKlaim]   - Whitelist of claims already in user's CV
 * @param {string}        [opts.language]       - 'id' (default) | 'en' — controls DOCX guidance language
 * @returns {{ text: string, isTrusted: boolean }}
 */
export function postProcessCV(llmText, originalCVText, issue = null, mode = 'pdf', opts = {}) {
  const { previewSample, previewAfter, entitasKlaim = null, language = 'id' } = opts;
  const originalLines      = extractBulletLines(originalCVText);
  const shortOriginalLines = extractShortOriginalLines(originalCVText);

  let fallbackCount = 0;
  let totalBullets  = 0;

  // Step 1: validate each bullet line
  const outputLines = llmText.split('\n');
  const validated   = outputLines.map(line => {
    const trimmed = line.trim();
    if (!trimmed)                               return line;
    if (SECTION_HEADING_PATTERN.test(trimmed))  return line;
    if (META_LINE_PATTERN.test(trimmed))        return line;
    if (isNonBulletCVLine(trimmed))             return line; // names, companies, education, contact
    if (!isBulletLine(trimmed))                 return line;

    const clean = cleanLine(trimmed);
    if (clean.length < MIN_LINE_LENGTH)         return line;

    // Word count guard — matches frontend generateRewrite() behaviour
    const wordCount = clean.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < MIN_WORD_COUNT)             return line;

    totalBullets++;

    // Reject any line that still contains template placeholders like [NAME] or [POSITION]
    if (PLACEHOLDER_PATTERN.test(clean)) {
      const original = findBestMatch(clean, originalLines);
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      fallbackCount++;
      return prefix + (original ? safeRewriteLine(original, issue) : clean.replace(PLACEHOLDER_PATTERN, '').trim());
    }

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
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      fallbackCount++;
      return prefix + safeRewriteLine(original, issue);
    }

    return line;
  });

  let result = validated.join('\n');

  // Step 1b: strip any remaining LLM placeholder brackets from ALL lines
  // (covers non-bulleted lines that are not processed by the per-bullet loop above)
  result = result.replace(/\[[^\]]{1,60}\]/g, '').replace(/[ \t]{2,}/g, ' ');

  // Step 2: force preview consistency — raise threshold to 0.6 to avoid wrong mapping
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

  // Step 3: DOCX mode — append guidance hint after the first DOCX_MAX_HINTS
  // experience bullet lines only. Reset counter on each new section so guidance
  // stays within the PENGALAMAN KERJA / WORK EXPERIENCE section.
  if (mode === 'docx') {
    const guidance = language === 'en' ? DOCX_GUIDANCE_EN : DOCX_GUIDANCE_ID;
    let hintsAdded   = 0;
    let inExpSection = false;
    const EXP_HEADING = /^(PENGALAMAN KERJA|PENGALAMAN|WORK EXPERIENCE|EXPERIENCE|EMPLOYMENT HISTORY)$/i;
    const ANY_HEADING = SECTION_HEADING_PATTERN;
    const docxLines = result.split('\n').flatMap(line => {
      const t = line.trim();
      if (ANY_HEADING.test(t)) {
        inExpSection = EXP_HEADING.test(t);
        hintsAdded   = 0; // reset on every section boundary
        return [line];
      }
      if (!inExpSection)                         return [line];
      if (hintsAdded >= DOCX_MAX_HINTS)          return [line];
      if (!t || !isBulletLine(t))                return [line];
      hintsAdded++;
      return [line, `  ${guidance}`];
    });
    result = docxLines.join('\n');
  }

  // isTrusted: true if fallback rate is below 20% (or no bullets to validate)
  const fallbackRate = totalBullets > 0 ? fallbackCount / totalBullets : 0;
  const isTrusted    = fallbackRate < 0.2;

  return { text: result, isTrusted };
}
