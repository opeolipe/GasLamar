export { WORKER_URL } from '@/lib/uploadValidation';
import { extractSampleLine }                        from '@/lib/cvUtils';
import { generateRewrite, generateRewritePreview }  from '@/lib/rewriteUtils';
import type { ResultData, BuildResultInput }         from '@/types/result';

// ── Data shape from /analyze response ──────────────────────────────────────

export interface ScoringData {
  skor:            number;
  alasan_skor?:    string;
  archetype?:      string;
  veredict?:       'DO' | 'DO NOT' | 'TIMED';
  timebox_weeks?:  number;
  kekuatan?:       string[];
  red_flags?:      string[];
  gap?:            string[];
  hr_7_detik?:     { kuat: string[]; diabaikan: string[] };
  rekomendasi?:    string[];
  skor_6d?:        Record<string, number>;
  skor_sesudah?:   number;
  konfidensitas?:  'Tinggi' | 'Sedang' | 'Rendah';
}

// ── Pricing ─────────────────────────────────────────────────────────────────

export interface TierInfo {
  label:     string;
  price:     number;
  bilingual: boolean;
  desc:      string;
  priceStr:  string;
}

export const TIER_CONFIG: Record<string, TierInfo> = {
  coba:    { label: 'Coba Dulu',     price: 29000,  bilingual: false, desc: '1 CV · Bahasa Indonesia',   priceStr: 'Rp 29k'  },
  single:  { label: 'Single',        price: 59000,  bilingual: true,  desc: '1 CV · Bilingual ID + EN',  priceStr: 'Rp 59k'  },
  '3pack': { label: '3-Pack',        price: 149000, bilingual: true,  desc: '3 CV · Bilingual ID + EN',  priceStr: 'Rp 149k' },
  jobhunt: { label: 'Job Hunt Pack', price: 299000, bilingual: true,  desc: '10 CV · Bilingual ID + EN', priceStr: 'Rp 299k' },
};

export function formatPrice(price: number): string {
  return price.toLocaleString('id-ID');
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export const VERDICT_CONFIG = {
  'DO': {
    bg: '#F0FDF4', color: '#15803D', border: '#86EFAC',
    icon: '✅',
    label: 'Layak Dilamar (DO)',
    desc: 'CV kamu cukup kuat untuk posisi ini. Gas lamar sekarang!',
  },
  'DO NOT': {
    bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5',
    icon: '❌',
    label: 'Belum Direkomendasikan (DO NOT)',
    desc: 'Gap terlalu besar untuk posisi ini. Perbaiki dulu atau cari posisi yang lebih sesuai.',
  },
  'TIMED': {
    bg: '#FFFBEB', color: '#92400E', border: '#FCD34D',
    icon: '⏳',
    label: 'Perlu Persiapan (TIMED)',
    desc: '',
  },
} as const;

// ── 6D Dimensions ────────────────────────────────────────────────────────────
//
// opportunity_cost is intentionally excluded here — it is 100% derived from
// effort (opportunity_cost = effort < 5 ? 5 : 10) and therefore carries no
// independent user-facing signal. The backend still computes and includes it
// in the skor total; we simply don't display it as a separate dimension.
//
// Display order is intentional: emotional impact first, planning layer last.
// portfolio → recruiter_signal → north_star → effort → risk
// (biggest "aha" moments up front, future/context at the bottom)

export const DIM_LABELS: Record<string, { label: string; icon: string; desc: string; hint: string }> = {
  portfolio: {
    label: 'Bukti Nyata di CV',
    icon:  '📋',
    desc:  'Seberapa kuat CV kamu menunjukkan hasil nyata — angka, metrik, dan pencapaian konkret.',
    hint:  'Ubah setiap bullet jadi pernyataan berbasis dampak: "Meningkatkan X sebesar Y% dalam Z bulan."',
  },
  recruiter_signal: {
    label: 'Daya Tarik CV',
    icon:  '👁️',
    desc:  'Seberapa cepat CV kamu menarik perhatian HR dalam 7 detik pertama saat CV di-scan.',
    hint:  'Perkuat bagian atas CV dengan headline dan summary yang mencantumkan pencapaian terkuat kamu.',
  },
  north_star: {
    label: 'Kesesuaian Role',
    icon:  '🎯',
    desc:  'Seberapa cocok latar belakang dan pengalaman kamu dengan kebutuhan spesifik posisi yang dilamar.',
    hint:  'Tambahkan kata kunci dari job description ke ringkasan dan bullet point pengalaman kamu.',
  },
  effort: {
    label: 'Kemudahan Perbaiki',
    icon:  '⚡',
    desc:  'Seberapa cepat gap antara CV kamu dan job description ini bisa ditutup — berdasarkan jumlah dan jenis skill yang kurang.',
    hint:  'Semakin banyak skill yang kurang, semakin lama waktu yang dibutuhkan. Prioritaskan skill yang paling sering disebut di JD.',
  },
  risk: {
    label: 'Relevansi Jangka Panjang',
    icon:  '🛡️',
    desc:  'Seberapa aman skill yang diminta posisi ini dari risiko tergantikan teknologi atau perubahan industri dalam 2–3 tahun ke depan.',
    hint:  'Posisi yang mengandalkan skill fundamental (Excel, komunikasi, manajemen) lebih aman jangka panjang dibanding skill yang sangat spesifik.',
  },
};

// ── 6D Primary Issue ─────────────────────────────────────────────────────────

export const HIGHLIGHT_PRIORITY = ['portfolio', 'recruiter_signal', 'north_star', 'effort', 'risk'] as const;
export const HIGHLIGHT_THRESHOLD = 7;

export function getPrimaryIssue(scores: Record<string, number>): string | null {
  for (const key of HIGHLIGHT_PRIORITY) {
    if (typeof scores[key] === 'number' && scores[key] < HIGHLIGHT_THRESHOLD) return key;
  }
  return null;
}

// ── Score utilities ──────────────────────────────────────────────────────────

export type ScoreBucket = 'high' | 'medium' | 'low';

export function scoreBucket(score: number): ScoreBucket {
  if (score > 70)  return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export function scoreBadge(score: number): { text: string; bg: string; textColor: string } {
  const b = scoreBucket(score);
  if (b === 'high')   return { text: '🟢 Peluang Interview Tinggi', bg: '#F0FDF4', textColor: '#15803D' };
  if (b === 'medium') return { text: '🟡 Peluang Interview Sedang', bg: '#FEFCE8', textColor: '#92400E' };
  return                     { text: '🔴 Peluang Interview Rendah', bg: '#FEF2F2', textColor: '#B91C1C' };
}

export function scoreRingColor(score: number): string {
  if (score > 70)  return '#10B981';
  if (score >= 50) return '#F59E0B';
  return '#EF4444';
}

// ── Guiding sentence (based on gap count) ───────────────────────────────────

export function guidingSentence(gapCount: number): string {
  if (gapCount === 1)              return 'Sudah cukup kuat — hanya ada 1 hal kecil yang perlu diperbaiki';
  if (gapCount >= 2 && gapCount <= 3) return `Sudah cukup kuat — masih ada ${gapCount} hal yang bikin HR ragu`;
  if (gapCount > 3)                return 'Masih ada beberapa hal penting yang perlu diperbaiki agar peluang naik';
  return '';
}

// ── Tier recommendation (based on score) ────────────────────────────────────

export function tierRecommendation(score: number): { msg: string; tier: string } {
  if (score < 50) {
    return {
      msg: 'Skor kamu di bawah 50 — ada banyak gap yang perlu diperbaiki. <strong>3-Pack lebih hemat</strong> kalau kamu lagi aktif apply ke banyak loker.',
      tier: '3pack',
    };
  }
  if (score < 75) {
    return {
      msg: 'CV kamu lumayan tapi masih bisa ditingkatkan. <strong>Single</strong> cukup kalau kamu fokus ke satu posisi.',
      tier: 'single',
    };
  }
  return {
    msg: 'CV kamu sudah cukup kuat! <strong>Single</strong> cukup untuk tailoring ke posisi ini.',
    tier: 'single',
  };
}

export function buildResultData({ skor6d, cvText, fullRewrite }: BuildResultInput): ResultData {
  const primaryIssue = getPrimaryIssue(skor6d);
  const sampleLine   = cvText ? (extractSampleLine(cvText) ?? null) : null;

  let rewritePreview = null;
  if (primaryIssue) {
    const personalized = sampleLine ? generateRewrite(primaryIssue, sampleLine) : null;
    if (personalized) {
      rewritePreview = { ...personalized, personalized: true };
    } else {
      // generateRewrite returned null (line too short or no sample) — use generic template
      rewritePreview = generateRewritePreview(primaryIssue) ?? null;
    }
  }

  return {
    scores:         skor6d,
    primaryIssue,
    sampleLine,
    rewritePreview,
    fullRewrite:    fullRewrite ?? null,
  };
}

export function getUrgencyMessage(issueKey: string | null | undefined, score: number): string | null {
  if (!issueKey || score >= 6) return null;
  if (issueKey === 'portfolio' || issueKey === 'recruiter_signal' || issueKey === 'north_star') {
    return 'Peluang kamu bisa meningkat signifikan setelah perbaikan ini';
  }
  return null;
}

// ── Email ────────────────────────────────────────────────────────────────────

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
