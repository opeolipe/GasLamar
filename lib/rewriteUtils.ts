import { cleanLine } from '@/lib/cvUtils';

const DEFAULT_SAMPLE = 'Bertanggung jawab menjalankan tugas harian';

interface RewritePair {
  before: string;
  after:  string;
  note?:  string | null;
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

  switch (issue) {
    case 'portfolio':
      return {
        before: clean,
        after:  clean + ' untuk meningkatkan hasil kerja',
        note:   '(tambahkan hasil konkret jika ada, misalnya: waktu ↓ atau output ↑)',
      };
    case 'recruiter_signal':
      return {
        before: clean,
        after:  clean + ' dengan fokus yang lebih jelas pada peran dan hasil utama',
        note:   null,
      };
    case 'north_star':
      return {
        before: clean,
        after:  clean + ' yang relevan dengan posisi yang ditargetkan',
        note:   null,
      };
    case 'effort':
      return {
        before: clean,
        after:  clean + ' dengan peningkatan skill yang dibutuhkan',
        note:   null,
      };
    case 'risk':
      return {
        before: clean,
        after:  clean + ' menggunakan pendekatan atau tools yang masih relevan',
        note:   null,
      };
    default:
      return null;
  }
}
