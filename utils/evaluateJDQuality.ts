import { MIN_JD_LENGTH } from '@/lib/uploadValidation';

const QUALITY_KEYWORDS = [
  // Indonesian
  'pengalaman', 'kualifikasi', 'persyaratan', 'tanggung jawab', 'diutamakan',
  'minimal', 'tahun', 'kemampuan', 'keahlian', 'posisi', 'syarat', 'wajib',
  // English
  'experience', 'requirements', 'qualifications', 'responsibilities',
  'skills', 'minimum', 'years', 'preferred', 'required',
];

export function evaluateJDQuality(text: string): { isValid: boolean; message: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { isValid: false, message: null };
  if (trimmed.length < MIN_JD_LENGTH)
    return { isValid: false, message: 'Tambahkan sedikit detail agar analisis lebih akurat' };
  const lower = trimmed.toLowerCase();
  const hasKeyword = QUALITY_KEYWORDS.some(k => lower.includes(k));
  if (!hasKeyword)
    return { isValid: false, message: 'Pastikan ada kualifikasi atau tanggung jawab dari lowongan' };
  return { isValid: true, message: null };
}
