/**
 * Shared rewrite validation constants.
 * Single source of truth for both the frontend (lib/rewriteUtils.ts)
 * and the Worker (worker/src/rewriteGuard.js).
 * Pure data — no functions, no runtime dependencies.
 */

export const MIN_LINE_LENGTH = 15;
export const MIN_WORD_COUNT  = 3;

/** Minimum word-overlap ratio to consider two lines a match. */
export const MATCH_THRESHOLD = 0.6;

/**
 * Regex source string for metric patterns.
 * Covers: 30%, 1.5x, 3k, 5m, and time units (bulan/tahun/minggu/hari).
 * Re-create with `new RegExp(METRIC_PATTERN_SRC, 'gi')` in each consumer
 * so stateful `lastIndex` is never shared.
 */
export const METRIC_PATTERN_SRC =
  String.raw`\b\d+(\.\d+)?\s*(%|x|k|m)?\b|\b\d+\s*(bulan|tahun|minggu|hari)\b`;

/**
 * Regex source string for capitalized tech-tool terms (ALL_CAPS acronyms,
 * CamelCase words like TypeScript, VueJs).
 */
export const TOOL_TERM_PATTERN_SRC =
  String.raw`\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]\w*)\b`;

/**
 * Filler phrases that signal a weak (non-informative) improvement.
 * If the appended portion of `after` contains any of these, the rewrite
 * is considered weak and falls back to the issue-aware safe rewrite.
 */
export const WEAK_FILLER = [
  // Indonesian
  'lebih baik',
  'lebih efektif',
  'lebih optimal',
  'lebih maksimal',
  'dengan baik',
  'secara efektif',
  // English
  'more effectively',
  'more efficiently',
  'better results',
  'in a better way',
  'more optimally',
];

/**
 * Scope-inflation claims with optional implication bypass.
 * Each entry: { patternSrc, flags, impliedBySrc?, impliedByFlags? }
 *
 * If `before` matches `impliedBy`, the phrase is considered already-implied
 * and is NOT flagged as a new claim.
 * Entries without `impliedBySrc` are always rejected when appearing in `after`.
 */
export const INFLATION_RULES = [
  {
    patternSrc:    String.raw`\bmemimpin\s+tim\b`,
    flags:         'i',
    impliedBySrc:  String.raw`\b(mengelola|memimpin|koordinir|kepala|lead|manager|supervisi)\b`,
    impliedFlags:  'i',
  },
  {
    patternSrc:    String.raw`\bmeningkatkan\s+revenue\b`,
    flags:         'i',
    impliedBySrc:  String.raw`\b(revenue|pendapatan|penjualan|omzet|sales)\b`,
    impliedFlags:  'i',
  },
  {
    patternSrc:    String.raw`\bmengoptimalkan\s+biaya\b`,
    flags:         'i',
    impliedBySrc:  String.raw`\b(biaya|anggaran|budget|cost)\b`,
    impliedFlags:  'i',
  },
  {
    // always reject — specific count is always an invented claim
    patternSrc:   String.raw`\btim\s+\d+\s*(orang|anggota)\b`,
    flags:        'i',
  },
  {
    patternSrc:   String.raw`\bmempercepat\s+pertumbuhan\b`,
    flags:        'i',
    impliedBySrc: String.raw`\b(pertumbuhan|growth|kembang)\b`,
    impliedFlags: 'i',
  },
  // English equivalents — SYNC: also in worker/src/rewriteGuard.js INFLATED_CLAIM_PATTERNS
  {
    // "led a team" allowed if user already manages/leads; without context always rejected
    patternSrc:   String.raw`\bled\s+a\s+team\b`,
    flags:        'i',
    impliedBySrc: String.raw`\b(manage|lead|supervise|head|director|coordinator)\b`,
    impliedFlags: 'i',
  },
  {
    // always reject — "team of N" fabricates a specific headcount
    patternSrc:   String.raw`\bteam\s+of\s+\d+\b`,
    flags:        'i',
  },
  {
    patternSrc:   String.raw`\bincreased\s+revenue\b`,
    flags:        'i',
    impliedBySrc: String.raw`\b(revenue|sales|income|profit)\b`,
    impliedFlags: 'i',
  },
  {
    patternSrc:   String.raw`\boptimized\s+costs?\b`,
    flags:        'i',
    impliedBySrc: String.raw`\b(cost|budget|expense|saving)\b`,
    impliedFlags: 'i',
  },
  {
    patternSrc:   String.raw`\baccelerated\s+growth\b`,
    flags:        'i',
    impliedBySrc: String.raw`\b(growth|expand|scale|grow)\b`,
    impliedFlags: 'i',
  },
  {
    patternSrc:   String.raw`\bled\s+(cross[- ]functional|global|international)\b`,
    flags:        'i',
    impliedBySrc: String.raw`\b(cross[- ]functional|global|international|regional)\b`,
    impliedFlags: 'i',
  },
];

/**
 * Issue-aware safe fallback suffixes.
 * Append to the original clean line when a generated rewrite fails validation.
 */
export const ISSUE_FALLBACK_SUFFIX = {
  portfolio:        ' untuk menunjukkan dampak kerja secara lebih jelas',
  recruiter_signal: ' dengan fokus yang lebih spesifik pada peran dan hasil',
  north_star:       ' yang relevan dengan posisi yang ditargetkan',
  effort:           ' dengan konteks skill yang dibutuhkan untuk role ini',
  risk:             ' menggunakan pendekatan yang masih relevan saat ini',
};

export const GENERIC_FALLBACK_SUFFIX = ' dengan hasil yang lebih jelas dan terstruktur';

export const FALLBACK_NOTE =
  '(tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)';

export const DOCX_GUIDANCE =
  '(catatan: tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)';
