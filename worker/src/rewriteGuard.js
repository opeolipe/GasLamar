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
const EDUCATION_START_RE = /^(?:PENDIDIKAN|EDUCATION)\s*$/i;
const EDUCATION_END_RE = /^(?:KEAHLIAN|SKILLS|TECHNICAL\s+SKILLS|SERTIFIKASI|CERTIFICATIONS|PENGALAMAN\s+KERJA|WORK\s+EXPERIENCE)\s*$/i;

// Phrases that must never appear in final CV output — stripped as a last defence.
// SYNC: Must stay identical to shared/rewriteRules.js BANNED_OUTPUT_PHRASES.
const BANNED_OUTPUT_PHRASES = [
  // Indonesian — placeholder artifacts
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
  // Indonesian — AI corporate filler
  'rekam jejak yang solid',
  'rekam jejak solid',
  'hasil yang terukur dan berkelanjutan',
  'secara terstruktur dan efisien',
  'dalam lingkungan yang dinamis',
  'komitmen terhadap profesionalisme',
  'berorientasi pada hasil',
  'untuk mendukung pertumbuhan bisnis perusahaan',
  'untuk memastikan kelancaran operasional',
  'untuk mendukung operasional perusahaan',
  'secara proaktif dan terstruktur',
  // English — placeholder artifacts
  'with clearer and more structured results',
  'relevant to the target position',
  '[add specific number]',
  '[actual number]',
  'mention specific tools',
  'insert specific number',
  'add specific tools',
  // English — passive voice openers (always wrong in CV bullets)
  'was responsible for',
  'was tasked with',
  'was assigned to',
  'was involved in',
  'was dedicated to',
  'was focused on',
  'was expected to',
  'was required to',
  // English — AI corporate filler
  'proven track record of delivering results',
  'results-driven professional',
  'highly motivated individual',
  'in a fast-paced and dynamic environment',
  'commitment to professionalism',
  'to support business growth objectives',
  'to ensure smooth operational continuity',
  'to demonstrate concrete and measurable work impact',
  // Anti-AI repetitive suffixes (kept from before)
  'untuk menunjukkan dampak kerja yang konkret dan terukur',
  'dengan fokus pada peran dan hasil yang spesifik',
  'dengan konteks skill yang dibutuhkan untuk role ini',
  'with focus on specific roles and outcomes',
  'with the skill context needed for this role',
];

// Pre-escaped at module load — avoids re-escaping on every postProcessCV() call.
const BANNED_OUTPUT_REGEXES = BANNED_OUTPUT_PHRASES.map(
  phrase => new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
);

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

function isWeakGenericBullet(after, language = 'id') {
  const clean = cleanLine(after);
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  const weakId = /\b(membantu|menangani|mengelola|melakukan)\b.*\b(tugas|pekerjaan|operasional|aktivitas)\b/i;
  const weakEn = /\b(handled|managed|assisted|supported)\b.*\b(tasks?|operations|activities|duties)\b/i;
  return language === 'en' ? weakEn.test(clean) : weakId.test(clean);
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
  // For recruiter-readability, keep factual original wording rather than
  // appending generic AI-sounding suffixes when validation fails.
  return original;
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

function stripMarkdownHeadingPrefix(text) {
  return String(text || '').replace(/^\s{0,3}#{1,6}\s*/, '').trimEnd();
}

function normalizeLanguageLine(text, language = 'id') {
  if (language !== 'id') return text;
  return String(text || '')
    .replace(/\bEast Java\b/gi, 'Jawa Timur')
    .replace(/\bWest Java\b/gi, 'Jawa Barat')
    .replace(/\bCentral Java\b/gi, 'Jawa Tengah')
    .replace(/\bNorth Sulawesi\b/gi, 'Sulawesi Utara')
    .replace(/\bSouth Sulawesi\b/gi, 'Sulawesi Selatan')
    .replace(/\bPresent\b/gi, 'Sekarang')
    .replace(/\bCurrent\b/gi, 'Sekarang');
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

function findClosestCandidate(line, candidates) {
  let best = null, bestScore = -1;
  for (const c of candidates) {
    const score = wordOverlap(line, c);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
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

function cleanSummarySentences(text, language = 'id') {
  const summaryRe = /((?:RINGKASAN\s+(?:PROFESIONAL|EKSEKUTIF|SINGKAT)|PROFESSIONAL\s+SUMMARY|SUMMARY|PROFILE)\s*\n)([\s\S]*?)(?=\n(?:PENGALAMAN\s+KERJA|WORK\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|PENDIDIKAN|EDUCATION|KEAHLIAN|SKILLS|TECHNICAL\s+SKILLS|SERTIFIKASI|CERTIFICATIONS)(?:\s|$))/i;
  return text.replace(summaryRe, (_, heading, body) => {
    let cleaned = String(body || '').replace(/\s+/g, ' ').trim();
    const corporateNoise = language === 'en'
      ? /\b(fast-paced|stakeholder|operational excellence|high professionalism|multitask coordination|proven track record|results-driven)\b/gi
      : /\b(fast-paced|stakeholder|profesionalisme tinggi|rekam jejak solid|koordinasi multitask|efisiensi operasional)\b/gi;
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    const hasVerb = sentence => {
      const s = String(sentence || '');
      if (language === 'en') return /\b(manage|managed|handling|handled|support|supported|coordinate|coordinated|sell|sold|serve|served|build|built|develop|developed|maintain|maintained|work|worked)\b/i.test(s);
      return /\b(me\w+|ber\w+|di\w+kan|di\w+i|menangani|melayani|mengelola|mendukung|mengembangkan|menjalankan|menyusun|berkoordinasi)\b/i.test(s);
    };
    const filtered = sentences
      .map(s => s.replace(corporateNoise, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim())
      .filter(s => s.length >= 24 && hasVerb(s));
    cleaned = filtered.slice(0, 2).join(' ').trim();
    if (!cleaned) cleaned = language === 'en'
      ? 'Professional with relevant experience aligned to the target position.'
      : 'Profesional dengan pengalaman relevan yang selaras dengan posisi yang dituju.';
    return `${heading}${cleaned}\n\n`;
  });
}

function removeBasicEducationEntries(text, language = 'id') {
  const lines = text.split('\n');
  const out = [];
  let inEdu = false;
  for (const line of lines) {
    const t = line.trim();
    if (EDUCATION_START_RE.test(t)) {
      inEdu = true;
      out.push(line);
      continue;
    }
    if (inEdu && EDUCATION_END_RE.test(t)) inEdu = false;
    if (!inEdu) {
      out.push(line);
      continue;
    }
    const basicEdu = language === 'en'
      ? /\b(elementary|primary school|junior high|middle school|senior high|high school)\b/i
      : /\b(sd|smp|sma|smk|sekolah dasar|sekolah menengah pertama|sekolah menengah atas)\b/i;
    if (basicEdu.test(t)) continue;
    out.push(line);
  }
  return out.join('\n');
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
    if (title)          return `Experienced ${title} prepared to contribute to the target position.`;
    if (years)          return `Professional with ${years} years of experience.`;
    return 'Experienced professional prepared to contribute to the target position.';
  }
  if (title && years) return `${title} dengan ${years} tahun pengalaman profesional.`;
  if (title)          return `Profesional berpengalaman di bidang ${title} yang siap berkontribusi sesuai kebutuhan posisi.`;
  if (years)          return `Profesional dengan ${years} tahun pengalaman.`;
  return 'Profesional berpengalaman yang siap berkontribusi sesuai kebutuhan posisi yang dituju.';
}

function isLogicalBulletSentence(text, language = 'id') {
  const t = cleanLine(String(text || '').trim());
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  // Fragment-like endings often produced by over-compressed AI rewriting.
  if (/\b(dengan|untuk|agar|sehingga|yang|dan|to|for|with|while|by)\s*$/i.test(t)) return false;
  const hasVerb = language === 'en'
    ? /\b(manage|managed|handling|handled|support|supported|coordinate|coordinated|sell|sold|serve|served|build|built|develop|developed|maintain|maintained|prepare|prepared|follow[- ]?up|negotiate|negotiated|communicate|communicated)\b/i.test(t)
    : /\b(me\w+|ber\w+|di\w+kan|di\w+i|menangani|melayani|mengelola|mendukung|mengembangkan|menjalankan|menyusun|berkoordinasi|menjual|negosiasi)\b/i.test(t);
  return hasVerb;
}

// ── Purpose-suffix repetition guard ──────────────────────────────────────────

// Detects bullets ending with a vague "untuk [generic-verb]..." purpose clause
// — a common AI generation artifact. Strips the suffix from the 3rd+ occurrence
// so the first two (which may be legitimate) are kept intact.
const PURPOSE_CLAUSE_ID = /\s+untuk\s+(?:meningkatkan|memastikan|mendukung|menunjukkan|mengoptimalkan|memperkuat|membantu|mencapai|mewujudkan|mempertahankan|memperbaiki)\b[^.\n]*$/i;
const PURPOSE_CLAUSE_EN = /\s+to\s+(?:improve|ensure|support|demonstrate|optimize|strengthen|help|achieve|maintain|enhance|facilitate|drive)\b[^.\n]*$/i;

function stripRepeatedPurposeSuffixes(text, language = 'id') {
  const PURPOSE_RE = language === 'en' ? PURPOSE_CLAUSE_EN : PURPOSE_CLAUSE_ID;
  const lines = text.split('\n');
  let purposeCount = 0;
  let trimmedCount = 0;
  const result = lines.map(line => {
    const t = line.trim();
    if (!isBulletLine(t)) return line;
    if (PURPOSE_RE.test(t)) {
      purposeCount++;
      if (purposeCount > 2) {
        const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
        const clean = cleanLine(t);
        const stripped = clean.replace(PURPOSE_RE, '').trim();
        // Only strip if the remaining bullet is still meaningful (≥4 words)
        if (stripped.split(/\s+/).filter(w => w.length > 0).length >= 4) {
          trimmedCount++;
          return prefix + stripped;
        }
      }
    }
    return line;
  });
  return { text: result.join('\n'), trimmedCount };
}

// ── Safe fallback ─────────────────────────────────────────────────────────────

function safeRewriteLine(original, issue, lang = 'id') {
  return original;
}

// ── Main post-processor ───────────────────────────────────────────────────────

/**
 * Post-process LLM CV output:
 * 1. Validate each bullet against original CV — fall back if hallucination detected
 * 2. Force preview line consistency (if previewSample + previewAfter provided)
 * 3. Keep output clean for final recruiter-facing exports (no coaching hints)
 *
 * @param {string}        llmText        - Raw LLM output
 * @param {string}        originalCVText - User's original CV (for reference matching)
 * @param {string|null}   issue          - Primary issue key for issue-aware fallback
 * @param {string}        mode           - output flavor ('pdf' or 'docx'), both clean
 * @param {object}        opts
 * @param {string}        [opts.previewSample]  - Original line shown as "before" in Hasil
 * @param {string}        [opts.previewAfter]   - Rewrite shown as "after" in Hasil
 * @param {string[]|null} [opts.entitasKlaim]   - Whitelist of claims already in user's CV
 * @param {string}        [opts.language]       - 'id' (default) | 'en'
 * @returns {{ text: string, isTrusted: boolean }}
 */
export function postProcessCV(llmText, originalCVText, issue = null, mode = 'pdf', opts = {}) {
  const { previewSample, previewAfter, entitasKlaim = null, language = 'id' } = opts;
  const originalLines      = extractBulletLines(originalCVText);
  const shortOriginalLines = extractShortOriginalLines(originalCVText);

  let fallbackCount  = 0;
  let downgradeCount = 0;
  let totalBullets   = 0;
  let weakGenericReverts = 0;

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
    const normalizedLine = stripMarkdownHeadingPrefix(line);
    const localizedLine = normalizeLanguageLine(normalizedLine, language);
    const trimmed = localizedLine.trim();
    if (!trimmed)                               return line;
    if (SECTION_HEADING_PATTERN.test(trimmed))  return localizedLine;
    if (META_LINE_PATTERN.test(trimmed))        return localizedLine;
    if (isNonBulletCVLine(trimmed))             return localizedLine;
    if (!isBulletLine(trimmed))                 return localizedLine;

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
      if (isWeakGenericBullet(clean, language)) {
        const closest = findClosestCandidate(clean, originalLines);
        if (closest) {
          const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
          weakGenericReverts++;
          return prefix + closest;
        }
      }
      const shortOriginal = findExpandedShortLine(clean, shortOriginalLines);
      if (shortOriginal) {
        logHallucination({ stage: 'bullet', severity: 'high', reason: 'expanded_short' });
        fallbackCount++;
        const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
        return prefix + shortOriginal;
      }
      return localizedLine;
    }

    const { valid, severity } = validateWithSeverity(original, clean, entitasKlaim);
    if (!valid) {
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      logHallucination({ stage: 'bullet', severity });
      if (severity === 'high') fallbackCount++;
      else downgradeCount++;
      return prefix + applyValidationResult(severity, original, issue, language);
    }

    if (isWeakGenericBullet(clean, language)) {
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      weakGenericReverts++;
      return prefix + original;
    }

    if (!isLogicalBulletSentence(clean, language)) {
      const prefix = line.match(/^(\s*[-•*]\s*)/)?.[1] ?? '';
      logHallucination({ stage: 'bullet', severity: 'low', reason: 'illogical_fragment' });
      downgradeCount++;
      return prefix + original;
    }

    return localizedLine;
  });

  result = validated.join('\n');

  // Step 1b: strip any remaining LLM placeholder brackets from ALL lines
  result = result.replace(/\[[^\]]{1,60}\]/g, '').replace(/[ \t]{2,}/g, ' ');

  // Step 1c: strip overused purpose-ending suffixes (AI repetition pattern)
  const purposeResult = stripRepeatedPurposeSuffixes(result, language);
  result = purposeResult.text;

  // Step 1d: strip banned output phrases (AI artifacts) — regexes pre-compiled at module load
  for (const re of BANNED_OUTPUT_REGEXES) {
    result = result.replace(re, '');
  }
  result = result.replace(/[ \t]{2,}/g, ' ');
  result = cleanSummarySentences(result, language);
  result = removeBasicEducationEntries(result, language);

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

  // isTrusted: true if high-severity fallback rate < 20% (medium downgrades are acceptable)
  const fallbackRate = totalBullets > 0 ? fallbackCount / totalBullets : 0;
  const isTrusted    = fallbackRate < 0.2;

  // Deterministic 20% sampling for quality metrics logging to limit log volume.
  const summaryText = extractSummarySection(result) || '';
  const sampleSeed = `${language}|${summaryText.length}|${originalCVText.length}|${totalBullets}`;
  const sampleBucket = Array.from(sampleSeed).reduce((n, ch) => (n + ch.charCodeAt(0)) % 10, 0);
  if (sampleBucket < 2) {
    console.log(JSON.stringify({
      event: 'rewrite_quality_metrics',
      language,
      trimmed_purpose: purposeResult.trimmedCount,
      weak_generic_reverts: weakGenericReverts,
      summary_chars: summaryText.length,
      fallback_rate: Number(fallbackRate.toFixed(3)),
    }));
  }

  return { text: result, isTrusted };
}
