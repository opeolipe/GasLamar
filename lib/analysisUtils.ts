export { WORKER_URL } from '@/lib/uploadValidation';

export const ESTIMATED_MS     = 35000;
export const FETCH_TIMEOUT_MS = 55000;
export const TOTAL_STEPS      = 4;
export const STEP_INTERVAL    = Math.floor(ESTIMATED_MS / (TOTAL_STEPS + 1));

export const TRUST_MESSAGES = [
  '🔒 CV tidak disimpan — aman',
  '🤖 Analisis berbasis pola HR & ATS',
  '🎯 Hasil spesifik untuk job ini',
  '⚡ Rata-rata selesai dalam 30 detik',
] as const;

export interface StepDef { icon: string; label: string }

export const STEP_DEFS: StepDef[] = [
  { icon: '📄', label: 'Membaca & memahami struktur CV'      },
  { icon: '🔍', label: 'Mencocokkan dengan job description'  },
  { icon: '📊', label: 'Menghitung skor & gap'               },
  { icon: '✍️', label: 'Menyusun rekomendasi & rewrite'      },
];

export function getTimerText(elapsed: number): string {
  const remaining = Math.max(0, Math.ceil((ESTIMATED_MS - elapsed) / 1000));
  if (remaining > 0) return `⏱️ Estimasi sisa: ~${remaining} detik`;
  const extra = Math.round((elapsed - ESTIMATED_MS) / 1000);
  return extra >= 15
    ? '⏱️ PDF memerlukan waktu lebih lama — hampir selesai...'
    : '⏱️ Hampir selesai...';
}

export function formatFilename(name: string): string {
  if (!name || name === 'CV Kamu') return 'CV Kamu';
  return name.length > 32 ? name.slice(0, 29) + '...' : name;
}
