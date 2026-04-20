import { cleanLine } from '@/lib/cvUtils';

const DEFAULT_SAMPLE = 'Bertanggung jawab menjalankan tugas harian';

const FAKE_NUM_PATTERN = /\d+%|\d+\s*(bulan|tahun)/gi;

interface RewritePair {
  before: string;
  after:  string;
  note?:  string | null;
}

// Returns false only when the rewrite adds NEW metric-style numbers not present in the original.
// Numbers already in `before` are preserved in `after` (since we append), so we must not penalise them.
function addsNewNumbers(before: string, after: string): boolean {
  const beforeNums = new Set((before.match(FAKE_NUM_PATTERN) || []).map(s => s.toLowerCase()));
  const afterNums  = (after.match(FAKE_NUM_PATTERN) || []).map(s => s.toLowerCase());
  return afterNums.some(n => !beforeNums.has(n));
}

export function validateRewrite(before: string, after: string): boolean {
  if (!before || !after) return false;
  if (before.trim() === after.trim()) return false;
  if (addsNewNumbers(before, after)) return false;
  if (after.length <= before.length) return false;
  return true;
}

function safeRewrite(original: string): RewritePair {
  return {
    before: original,
    after:  original + ' dengan hasil yang lebih jelas dan terstruktur',
    note:   '(tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)',
  };
}

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

export function generateRewrite(issue: string, originalLine: string | null): RewritePair | null {
  if (!originalLine) return null;
  const clean = cleanLine(originalLine);

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

  return validateRewrite(candidate.before, candidate.after) ? candidate : safeRewrite(clean);
}
