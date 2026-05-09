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

// Placeholder pattern — LLM template artifacts that must never appear in final CV.
// Catches both [bracketed placeholders] and bare single-letter variable tokens
// used as stand-ins (e.g. "sebesar X%", "selama Y tahun", "meningkat N persen").
const PLACEHOLDER_PATTERN = /\[[^\]]{1,60}\]|\b[XYN]%|\b[XYN]\s+(tahun|bulan|minggu|hari|persen|kali|x)\b/i;

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

// Summary section boundaries — used to extract and validate the professional summary block
const SUMMARY_START_RE = /^(?:RINGKASAN\s+(?:PROFESIONAL|EKSEKUTIF|SINGKAT)|PROFESSIONAL\s+SUMMARY|SUMMARY|PROFILE|PROFESSIONAL\s+PROFILE)\s*$/i;
const SUMMARY_END_RE   = /^(?:PENGALAMAN\s+KERJA|WORK\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|PENDIDIKAN|EDUCATION|KEAHLIAN|SKILLS|TECHNICAL\s+SKILLS|SERTIFIKASI|CERTIFICATIONS)\s*$/i;

const DOCX_GUIDANCE_ID  = '(catatan: tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)';
const DOCX_GUIDANCE_EN  = '(note: add concrete results if available, e.g., time ↓ or output ↑)';
const DOCX_MAX_HINTS    = 3;

// SYNC: Must stay identical to shared/rewriteRules.js ISSUE_FALLBACK_SUFFIX.
const ISSUE_FALLBACK = {
  portfolio:        ' untuk menunjukkan dampak kerja yang konkret dan terukur',
  recruiter_signal: ' dengan fokus pada peran dan hasil yang spesifik',
  north_star:       ' yang sesuai dengan kebutuhan posisi ini',
  effort:           ' dengan konteks skill yang dibutuhkan untuk role ini',
  risk:             ' menggunakan pendekatan yang masih relevan saat ini',
};
const GENERIC_FALLBACK_SUFFIX = ' dengan hasil yang lebih konkret dan terukur';

const ISSUE_FALLBACK_EN = {
  portfolio:        ' to demonstrate concrete and measurable work impact',
  recruiter_signal: ' with focus on specific roles and outcomes',
  north_star:       ' aligned with the requirements of this position',
  effort:           ' with the skill context needed for this role',
  risk:             ' using an approach that remains relevant today',
};
const GENERIC_FALLBACK_SUFFIX_EN = ' with more concrete and measurable results';

// Phrases that must never appear in final CV output — stripped as a last defence.
const BANNED_OUTPUT_PHRASES = [
  // Indonesian
  'dengan hasil yang lebih jelas dan terstruktur',
  'yang relevan dengan posisi yang ditargetkan',
  '[sebutkan angka nyata]',
  '[angka nyata]',
  'sebutkan tools spesifik',
  'sebutkan tool spesifik',
  'sebutkan angka',
  'masukkan angka',
  'tambahkan angka',
  'isi dengan angka',
  // English
  'with clearer and more structured results',
  'relevant to the target position',
  '[add specific number]',
  '[actual number]',
  'mention specific tools',
  'insert specific number',
  'add specific tools',
];

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
  // M9: Keep short tokens (C#, Go, R) in the whitelist — drop only empty strings.
  // The previous > 2 filter silently excluded legitimate 1-2 char language names.
  const allowedTerms = entitasKlaim
    ? new Set(entitasKlaim.map(k => k.trim().toLowerCase()).filter(k => k.length >= 1))
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

// ── Graded claim guards ───────────────────────────────────────────────────────

// Checks only inflated claims (not tool terms) — used to distinguish high vs medium severity
function hasInflatedClaims(before, after) {
  for (const { pattern, impliedBy } of INFLATED_CLAIM_PATTERNS) {
    if (pattern.test(after) && !pattern.test(before)) {
      if (impliedBy && impliedBy.test(before)) continue;
      return true;
    }
  }
  return false;
}

// Checks only new tool terms (not inflated claims) — medium severity
function hasNewToolTerms(before, after, entitasKlaim) {
  // M9: Same fix as addsNewClaims — keep short tokens in the whitelist.
  const allowedTerms = entitasKlaim
    ? new Set(entitasKlaim.map(k => k.trim().toLowerCase()).filter(k => k.length >= 1))
    : null;
  const beforeTools = extractToolTerms(before);
  for (const term of extractToolTerms(after)) {
    if (beforeTools.has(term)) continue;
    if (allowedTerms && allowedTerms.has(term)) continue;
    return true;
  }
  return false;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Graded validation: returns { valid, severity } instead of a binary boolean.
 * severity: 'high' (full fallback) | 'medium' (light fix) | 'low' (revert with suffix)
 */
export function validateWithSeverity(before, after, entitasKlaim = null) {
  if (!before || !after) return { valid: false, severity: 'high' };
  if (before.trim() === after.trim()) return { valid: false, severity: 'low' };
  // Reject if after is a truncation (fewer than MIN_WORD_COUNT meaningful words).
  // This allows concise rewrites while blocking LLM cut-offs.
  if (after.trim().split(/\s+/).filter(w => w.length > 0).length < MIN_WORD_COUNT) return { valid: false, severity: 'low' };

  if (addsNewNumbers(before, after))                return { valid: false, severity: 'high' };
  if (hasInflatedClaims(before, after))             return { valid: false, severity: 'high' };
  if (hasNewToolTerms(before, after, entitasKlaim)) return { valid: false, severity: 'medium' };
  if (isWeakImprovement(before, after))             return { valid: false, severity: 'low' };

  return { valid: true };
}

/** Backwards-compatible shim — delegates to validateWithSeverity. */
export function validateRewrite(before, after, entitasKlaim = null) {
  return validateWithSeverity(before, after, entitasKlaim).valid;
}

function applyValidationResult(severity, original, issue, lang = 'id') {
  if (severity === 'medium') {
    const fallbackMap = lang === 'en' ? ISSUE_FALLBACK_EN : ISSUE_FALLBACK;
    const defaultSuffix = lang === 'en' ? GENERIC_FALLBACK_SUFFIX_EN : GENERIC_FALLBACK_SUFFIX;
    return original + (fallbackMap[issue] ?? defaultSuffix);
  }
  return safeRewriteLine(original, issue, lang);
}

// ── Logging ───────────────────────────────────────────────────────────────────

function logHallucination(event) {
  console.log(JSON.stringify({
    event: 'hallucination_blocked',
    timestamp: new Date().toISOString(),
    ...event,
  }));
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
  // M10: Lower threshold from > 3 to >= 2 so short action verbs (led, ran, own)
  // are included in fuzzy matching. The previous > 3 threshold excluded 3-char
  // words, causing valid rewrites to fail the similarity check.
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length >= 2));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length >= 2));
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

// ── Summary validation ────────────────────────────────────────────────────────

function extractSummarySection(cvText) {
  const lines = cvText.split('\n');
  let inSummary = false;
  const summaryLines = [];
  for (const line of lines) {
    const t = line.trim();
    if (SUMMARY_START_RE.test(t)) { inSummary = true; continue; }
    if (inSummary) {
      if (SECTION_HEADING_PATTERN.test(t)) break;
      if (t) summaryLines.push(t);
    }
  }
  return summaryLines.length > 0 ? summaryLines.join(' ') : null;
}

function validateSummaryBlock(summaryText, originalCVText, entitasKlaim) {
  // Use the full original CV as "before" — any number or tool already in the CV is allowed
  return addsNewNumbers(originalCVText, summaryText) ||
         addsNewClaims(originalCVText, summaryText, entitasKlaim);
}

function buildSafeSummary(cvText, lang = 'id') {
  const yearsM = cvText.match(/(\d+)\s*(?:\+\s*)?(?:tahun|years?)\s+(?:pengalaman|experience)/i);
  const years  = yearsM ? yearsM[1] : null;
  const titleM = cvText.match(/(?:—|–)\s*(.+?)(?:\s*\||\s*$)/m);
  const title  = titleM ? titleM[1].trim().slice(0, 60) : null;

  if (lang === 'en') {
    if (title && years) return `${title} with ${years} years of professional experience.`;
    if (title)          return `Experienced ${title} seeking to contribute to the target role.`;
    if (years)          return `Professional with ${years} years of experience.`;
    return 'Experienced professional seeking to contribute to the target role.';
  }
  if (title && years) return `${title} dengan ${years} tahun pengalaman profesional.`;
  if (title)          return `Profesional berpengalaman di bidang ${title}.`;
  if (years)          return `Profesional dengan ${years} tahun pengalaman.`;
  return 'Profesional berpengalaman yang siap berkontribusi untuk posisi yang ditargetkan.';
}

// ── Safe fallback ─────────────────────────────────────────────────────────────

function safeRewriteLine(original, issue, lang = 'id') {
  const fallbackMap = lang === 'en' ? ISSUE_FALLBACK_EN : ISSUE_FALLBACK;
  const defaultSuffix = lang === 'en' ? GENERIC_FALLBACK_SUFFIX_EN : GENERIC_FALLBACK_SUFFIX;
  const suffix = (issue && fallbackMap[issue]) ?? defaultSuffix;
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

  let fallbackCount  = 0;
  let downgradeCount = 0;
  let totalBullets   = 0;

  let result = llmText;

  // Step 1a: validate professional summary — not covered by the per-bullet loop because
  // summary sentences carry no bullet marker. Replaces with original or a safe fallback.
  const llmSummary  = extractSummarySection(result);
  const origSummary = extractSummarySection(originalCVText);
  if (llmSummary && validateSummaryBlock(llmSummary, originalCVText, entitasKlaim)) {
    logHallucination({ stage: 'summary', language });
    const safeSummary = origSummary ?? buildSafeSummary(originalCVText, language);
    result = result.replace(
      /((?:RINGKASAN\s+(?:PROFESIONAL|EKSEKUTIF|SINGKAT)|PROFESSIONAL\s+SUMMARY|SUMMARY|PROFILE)\s*\n)([\s\S]*?)(?=\n(?:PENGALAMAN\s+KERJA|WORK\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|PENDIDIKAN|EDUCATION|KEAHLIAN|SKILLS|TECHNICAL\s+SKILLS|SERTIFIKASI|CERTIFICATIONS)(?:\s|$))/i,
      (_, heading, _body) => heading + safeSummary + '\n\n',
    );
    fallbackCount++;
  }

  // Step 1: validate each bullet line (graded severity)
  const outputLines = result.split('\n');
  const validated   = outputLines.map(line => {
    const trimmed = line.trim();
    if (!trimmed)                               return line;
    if (SECTION_HEADING_PATTERN.test(trimmed))  return line;
    if (META_LINE_PATTERN.test(trimmed))        return line;
    if (isNonBulletCVLine(trimmed))             return line;
    if (!isBulletLine(trimmed))                 return line;

    const clean = cleanLine(trimmed);
    if (clean.length < MIN_LINE_LENGTH)         return line;

    const wordCount = clean.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < MIN_WORD_COUNT)             return line;

    totalBullets++;

    if (PLACEHOLDER_PATTERN.test(clean)) {
      const original = findBestMatch(clean, originalLines);
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      logHallucination({ stage: 'bullet', severity: 'high', reason: 'placeholder' });
      fallbackCount++;
      return prefix + (original ? safeRewriteLine(original, issue, language) : clean.replace(PLACEHOLDER_PATTERN, '').trim());
    }

    const original = findBestMatch(clean, originalLines);
    if (!original) {
      const shortOriginal = findExpandedShortLine(clean, shortOriginalLines);
      if (shortOriginal) {
        logHallucination({ stage: 'bullet', severity: 'high', reason: 'expanded_short' });
        fallbackCount++;
        const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
        return prefix + shortOriginal;
      }
      return line;
    }

    const { valid, severity } = validateWithSeverity(original, clean, entitasKlaim);
    if (!valid) {
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      logHallucination({ stage: 'bullet', severity });
      if (severity === 'high') fallbackCount++;
      else downgradeCount++;
      return prefix + applyValidationResult(severity, original, issue, language);
    }

    return line;
  });

  result = validated.join('\n');

  // Step 1b: strip any remaining LLM placeholder brackets from ALL lines
  result = result.replace(/\[[^\]]{1,60}\]/g, '').replace(/[ \t]{2,}/g, ' ');

  // Step 1c: strip banned output phrases (AI artifacts)
  for (const phrase of BANNED_OUTPUT_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '');
  }
  result = result.replace(/[ \t]{2,}/g, ' ');

  // Step 2: force preview consistency
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

  // Step 3: DOCX mode — append guidance hint after first DOCX_MAX_HINTS experience bullets
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
        hintsAdded   = 0;
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

  // isTrusted: true if high-severity fallback rate < 20% (medium downgrades are acceptable)
  const fallbackRate = totalBullets > 0 ? fallbackCount / totalBullets : 0;
  const isTrusted    = fallbackRate < 0.2;

  return { text: result, isTrusted };
}
