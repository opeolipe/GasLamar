export { WORKER_URL } from '@/lib/uploadValidation';

export const ESTIMATED_MS     = 45000;
export const FETCH_TIMEOUT_MS = 55000;
export const TOTAL_STEPS      = 4;
export const STEP_INTERVAL    = Math.floor(ESTIMATED_MS / (TOTAL_STEPS + 1));

export const TRUST_MESSAGES = [
  '🔒 CV tidak disimpan — data kamu aman',
  '🎯 Membandingkan CV kamu dengan standar HR untuk posisi ini',
  '📊 Menghitung 5 dimensi yang paling dilihat recruiter',
  '✨ Hampir selesai — kami pastikan hasilnya tetap presisi',
] as const;

export interface StepDef { icon: string; label: string; activeDesc: string }

export const STEP_DEFS: StepDef[] = [
  {
    icon:       '📄',
    label:      'Membaca & memahami struktur CV',
    activeDesc: 'Mengekstrak pengalaman, skill, dan pencapaian dari CV kamu…',
  },
  {
    icon:       '🔍',
    label:      'Mencocokkan dengan job description',
    activeDesc: 'Mengidentifikasi skill yang diminta dan membandingkan dengan profil kamu…',
  },
  {
    icon:       '📊',
    label:      'Menghitung skor & gap',
    activeDesc: 'Menilai 5 dimensi: bukti nyata, daya tarik, kesesuaian, effort, dan relevansi…',
  },
  {
    icon:       '✍️',
    label:      'Menyusun rekomendasi & rewrite',
    activeDesc: 'Membuat contoh perbaikan CV berdasarkan gap yang ditemukan…',
  },
];

export function getTimerText(elapsed: number): string {
  const remaining = Math.max(0, Math.ceil((ESTIMATED_MS - elapsed) / 1000));
  if (remaining > 0) return `⏱️ Estimasi sisa: sekitar ${remaining} detik`;
  const extra = Math.round((elapsed - ESTIMATED_MS) / 1000);
  return extra >= 15
    ? '⏱️ Beberapa CV butuh waktu lebih lama — proses masih berjalan...'
    : '⏱️ Menyelesaikan analisis akhir...';
}

export function formatFilename(name: string): string {
  if (!name || name === 'CV Kamu') return 'CV Kamu';
  return name.length > 32 ? name.slice(0, 29) + '...' : name;
}

// Extracts the candidate's name from raw CV text for display in the analyzing UI.
// For plain-text CVs (paste/DOCX), reads the first non-blank, non-heading line.
// For PDF uploads (stored as JSON `{type:'pdf',...}`), falls back to the
// uploaded filename stripped of its extension.
export function extractCandidateDisplayName(cvData: string, fallbackFilename: string): string {
  if (!cvData) return fallbackFilename || 'CV Kamu';

  // PDF path: cvData is a JSON envelope — no readable text available client-side.
  try {
    const parsed = JSON.parse(cvData) as { type?: string };
    if (parsed?.type === 'pdf') {
      const stripped = fallbackFilename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      return stripped || 'CV Kamu';
    }
  } catch (_) { /* not JSON — treat as plain text */ }

  // Plain-text path: take the first non-blank line that looks like a name
  // (not all-uppercase, not too long — avoids section headings).
  const nameLine = cvData.split('\n').map(l => l.trim().replace(/^#+\s*/, ''))
    .find(l => l.length > 1 && l.length < 60 && !/^[A-Z\s]{4,}$/.test(l));

  return nameLine || fallbackFilename || 'CV Kamu';
}
