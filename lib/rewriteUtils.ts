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

const DEFAULT_SAMPLE = 'Bertanggung jawab menjalankan tugas harian';

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
  const lowerAfter  = after.toLowerCase();
  const lowerBefore = before.toLowerCase();
  return WEAK_FILLER.some(phrase => lowerAfter.includes(phrase) && !lowerBefore.includes(phrase));
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
      after:  clean + ' yang sesuai dengan kebutuhan posisi ini',
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
