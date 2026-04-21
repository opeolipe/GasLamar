import { cleanLine } from '@/lib/cvUtils';
import {
  MIN_LINE_LENGTH,
  MIN_WORD_COUNT,
  METRIC_PATTERN_SRC,
  TOOL_TERM_PATTERN_SRC,
  WEAK_FILLER,
  INFLATION_RULES,
  ISSUE_FALLBACK_SUFFIX,
  GENERIC_FALLBACK_SUFFIX,
  FALLBACK_NOTE,
} from '@/shared/rewriteRules.js';

const DEFAULT_SAMPLE  = 'Bertanggung jawab menjalankan tugas harian';
const MIN_LINE_LENGTH = 15;
const MIN_WORD_COUNT  = 3;

// Covers: 30%, 1.5x, 3k, 5m, time units, plain counts
const METRIC_PATTERN = /\b\d+(\.\d+)?\s*(%|x|k|m)?\b|\b\d+\s*(bulan|tahun|minggu|hari)\b/gi;

// SYNC: Must stay identical to worker/src/rewriteGuard.js INFLATED_CLAIM_PATTERNS.
// If you change one, change the other.
// Inflated phrases with optional implication bypass:
// if `before` matches `impliedBy`, the phrase was already implied → don't flag it
const INFLATED_CLAIM_PATTERNS: Array<{ pattern: RegExp; impliedBy?: RegExp }> = [
  // Indonesian
  {
    pattern:   /\bmemimpin\s+tim\b/i,
    impliedBy: /\b(mengelola|memimpin|koordinir|kepala|lead|manager|supervisi)\b/i,
  },
  {
    pattern:   /\bmeningkatkan\s+revenue\b/i,
    impliedBy: /\b(revenue|pendapatan|penjualan|omzet|sales)\b/i,
  },
  {
    pattern:   /\bmengoptimalkan\s+biaya\b/i,
    impliedBy: /\b(biaya|anggaran|budget|cost)\b/i,
  },
  {
    // always reject — specific count is always a new invented claim
    pattern: /\btim\s+\d+\s*(orang|anggota)\b/i,
  },
  {
    pattern:   /\bmempercepat\s+pertumbuhan\b/i,
    impliedBy: /\b(pertumbuhan|growth|kembang)\b/i,
  },
  // English equivalents
  {
    pattern:   /\bled\s+a\s+team\b/i,
    impliedBy: /\b(manage|lead|supervise|head|director|coordinator)\b/i,
  },
  {
    pattern:   /\bincreased\s+revenue\b/i,
    impliedBy: /\b(revenue|sales|income|profit)\b/i,
  },
  {
    pattern:   /\boptimized\s+costs?\b/i,
    impliedBy: /\b(cost|budget|expense|saving)\b/i,
  },
  {
    // always reject — fabricated team size
    pattern: /\bteam\s+of\s+\d+\b/i,
  },
  {
    pattern:   /\baccelerated\s+growth\b/i,
    impliedBy: /\b(growth|expand|scale|grow)\b/i,
  },
];

// ALL-CAPS acronyms (SQL, API) or CamelCase (TypeScript, VueJs) — likely tool names
const TOOL_TERM_PATTERN = /\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]\w*)\b/g;

// SYNC: Must stay identical to worker/src/rewriteGuard.js WEAK_FILLER.
const WEAK_FILLER = [
  'lebih baik',
  'lebih efektif',
  'lebih optimal',
  'lebih maksimal',
  'dengan baik',
  'secara efektif',
];

interface RewritePair {
  before: string;
  after:  string;
  note?:  string | null;
}

// ── Compiled patterns (built once from shared sources) ───────────────────────

// Re-created per call via text.match() which handles stateful lastIndex correctly
const INFLATION_COMPILED = INFLATION_RULES.map(r => ({
  pattern:   new RegExp(r.patternSrc, r.flags),
  impliedBy: r.impliedBySrc ? new RegExp(r.impliedBySrc, r.impliedFlags ?? 'i') : null,
}));

// ── Metric helpers ───────────────────────────────────────────────────────────

function extractMetrics(text: string): string[] {
  return (text.match(new RegExp(METRIC_PATTERN_SRC, 'gi')) || [])
    .map(s => s.toLowerCase().trim());
}

function addsNewNumbers(before: string, after: string): boolean {
  const beforeSet = new Set(extractMetrics(before));
  return extractMetrics(after).some(m => !beforeSet.has(m));
}

// ── Claim guard ──────────────────────────────────────────────────────────────

function extractToolTerms(text: string): Set<string> {
  return new Set(
    (text.match(new RegExp(TOOL_TERM_PATTERN_SRC, 'g')) || []).map(s => s.toLowerCase()),
  );
}

function addsNewClaims(before: string, after: string): boolean {
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

function isWeakImprovement(before: string, after: string): boolean {
  const added = after.slice(before.length).toLowerCase();
  return WEAK_FILLER.some(phrase => added.includes(phrase));
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRewrite(before: string, after: string): boolean {
  if (!before || !after) return false;
  if (before.trim() === after.trim()) return false;
  if (addsNewNumbers(before, after)) return false;
  if (addsNewClaims(before, after)) return false;
  if (isWeakImprovement(before, after)) return false;
  if (after.length <= before.length) return false;
  return true;
}

// ── Issue-aware fallback ─────────────────────────────────────────────────────

// SYNC: Must stay identical to worker/src/rewriteGuard.js ISSUE_FALLBACK.
// If you change one, change the other.
const ISSUE_FALLBACK: Record<string, (t: string) => string> = {
  portfolio:        t => t + ' untuk menunjukkan dampak kerja secara lebih jelas',
  recruiter_signal: t => t + ' dengan fokus yang lebih spesifik pada peran dan hasil',
  north_star:       t => t + ' yang relevan dengan posisi yang ditargetkan',
  effort:           t => t + ' dengan konteks skill yang dibutuhkan untuk role ini',
  risk:             t => t + ' menggunakan pendekatan yang masih relevan saat ini',
};

function safeRewrite(original: string, issue: string): RewritePair {
  const suffix = (ISSUE_FALLBACK_SUFFIX as Record<string, string>)[issue] ?? GENERIC_FALLBACK_SUFFIX;
  return {
    before: original,
    after:  original + suffix,
    note:   FALLBACK_NOTE,
  };
}

// ── generateRewritePreview (generic templates, no CV text) ────────────────────

export function generateRewritePreview(issue: string, sampleText?: string): RewritePair | null {
  const text = sampleText || DEFAULT_SAMPLE;

  switch (issue) {
    case 'portfolio':
      return {
        before: text,
        after:  text + ' — [tambahkan hasil konkret: output ↑, waktu ↓, atau target tercapai]',
      };
    case 'recruiter_signal':
      return {
        before: text,
        after:  '[Role kamu] yang [fokus spesifik] — pencapaian utama: [hasil terkuat kamu]',
      };
    case 'north_star':
      return {
        before: text,
        after:  text + ', relevan langsung dengan kebutuhan [posisi yang dilamar]',
      };
    case 'effort':
      return {
        before: text,
        after:  text + ' — termasuk penggunaan [skill yang diminta di JD]',
      };
    case 'risk':
      return {
        before: text,
        after:  text + ' menggunakan [tools/metode yang masih aktif dipakai industri]',
      };
    default:
      return null;
  }
}

// ── generateRewrite (personalized, validated) ─────────────────────────────────

export function generateRewrite(issue: string, originalLine: string | null): RewritePair | null {
  if (!originalLine) return null;
  const clean     = cleanLine(originalLine);
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  if (clean.length < MIN_LINE_LENGTH || wordCount < MIN_WORD_COUNT) return null;

  const candidates: Record<string, RewritePair> = {
    portfolio: {
      before: clean,
      after:  clean + ' untuk meningkatkan hasil kerja',
      note:   FALLBACK_NOTE,
    },
    recruiter_signal: {
      before: clean,
      after:  clean + ' dengan fokus yang lebih jelas pada peran dan hasil utama',
      note:   null,
    },
    north_star: {
      before: clean,
      after:  clean + ' yang relevan dengan posisi yang ditargetkan',
      note:   null,
    },
    effort: {
      before: clean,
      after:  clean + ' dengan peningkatan skill yang dibutuhkan',
      note:   null,
    },
    risk: {
      before: clean,
      after:  clean + ' menggunakan pendekatan atau tools yang masih relevan',
      note:   null,
    },
  };

  const candidate = candidates[issue];
  if (!candidate) return null;

  return validateRewrite(candidate.before, candidate.after) ? candidate : safeRewrite(clean, issue);
}
