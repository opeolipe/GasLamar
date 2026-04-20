import { cleanLine } from '@/lib/cvUtils';

const DEFAULT_SAMPLE  = 'Bertanggung jawab menjalankan tugas harian';
const MIN_LINE_LENGTH = 15;

// Covers: 30%, 1.5x, 3k, 5m, and time/count units
const METRIC_PATTERN = /\b\d+(\.\d+)?\s*(%|x|k|m)?\b|\b\d+\s*(bulan|tahun|minggu|hari)\b/gi;

// Strong outcome phrases that shouldn't appear unless already in original
const INFLATED_CLAIM_PATTERNS = [
  /\bmemimpin\s+tim\b/i,
  /\bmeningkatkan\s+revenue\b/i,
  /\bmengoptimalkan\s+biaya\b/i,
  /\btim\s+\d+\s*(orang|anggota)\b/i,
  /\bmempercepat\s+pertumbuhan\b/i,
];

// Acronyms (SQL, API) and CamelCase words (TypeScript, VueJs) — likely tech tools
const TOOL_TERM_PATTERN = /\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]\w*)\b/g;

interface RewritePair {
  before: string;
  after:  string;
  note?:  string | null;
}

// ── Metric helpers ───────────────────────────────────────────────────────────

function extractMetrics(text: string): string[] {
  return (text.match(METRIC_PATTERN) || []).map(s => s.toLowerCase().trim());
}

function addsNewNumbers(before: string, after: string): boolean {
  const beforeSet = new Set(extractMetrics(before));
  return extractMetrics(after).some(m => !beforeSet.has(m));
}

// ── Claim guard ──────────────────────────────────────────────────────────────

function extractToolTerms(text: string): Set<string> {
  return new Set((text.match(TOOL_TERM_PATTERN) || []).map(s => s.toLowerCase()));
}

function addsNewClaims(before: string, after: string): boolean {
  const beforeTools = extractToolTerms(before);
  for (const term of extractToolTerms(after)) {
    if (!beforeTools.has(term)) return true;
  }
  for (const pattern of INFLATED_CLAIM_PATTERNS) {
    if (pattern.test(after) && !pattern.test(before)) return true;
  }
  return false;
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validateRewrite(before: string, after: string): boolean {
  if (!before || !after) return false;
  if (before.trim() === after.trim()) return false;
  if (addsNewNumbers(before, after)) return false;
  if (addsNewClaims(before, after)) return false;
  if (after.length <= before.length) return false;
  return true;
}

// ── Issue-aware fallback ─────────────────────────────────────────────────────

const ISSUE_FALLBACK: Record<string, (t: string) => string> = {
  portfolio:        t => t + ' untuk menunjukkan dampak kerja secara lebih jelas',
  recruiter_signal: t => t + ' dengan fokus yang lebih spesifik pada peran dan hasil',
  north_star:       t => t + ' yang relevan dengan posisi yang ditargetkan',
  effort:           t => t + ' dengan konteks skill yang dibutuhkan untuk role ini',
  risk:             t => t + ' menggunakan pendekatan yang masih relevan saat ini',
};

function safeRewrite(original: string, issue: string): RewritePair {
  const fallbackFn = ISSUE_FALLBACK[issue] ?? ((t: string) => t + ' dengan hasil yang lebih jelas dan terstruktur');
  return {
    before: original,
    after:  fallbackFn(original),
    note:   '(tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)',
  };
}

// ── generateRewritePreview (generic templates, no CV text) ───────────────────

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

// ── generateRewrite (personalized, validated) ────────────────────────────────

export function generateRewrite(issue: string, originalLine: string | null): RewritePair | null {
  if (!originalLine) return null;
  const clean = cleanLine(originalLine);
  if (clean.length < MIN_LINE_LENGTH) return null;

  const candidates: Record<string, RewritePair> = {
    portfolio: {
      before: clean,
      after:  clean + ' untuk meningkatkan hasil kerja',
      note:   '(tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)',
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
