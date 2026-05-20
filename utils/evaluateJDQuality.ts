import { MIN_JD_LENGTH } from '@/lib/uploadValidation';

/**
 * Returns 'high' when the JD has enough content for targeted scoring and rewriting,
 * or 'low' when the system should fall back to inferred-mode (role-guided) output.
 *
 * Mirrors the JS version in worker/src/pipeline/roleInference.js — keep in sync.
 */
export function classifyJDQuality(text: string): 'high' | 'low' {
  const clean = (text ?? '').trim().toLowerCase();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  const hasStructure =
    /requirement|qualification|skill|responsibilit|duties/.test(clean) ||
    /kualifikasi|syarat|kemampuan|tanggung jawab|tugas|jobdesk/.test(clean);
  return wordCount >= 80 && hasStructure ? 'high' : 'low';
}

export function evaluateJDQuality(text: string): { isValid: boolean; message: string | null } {
  const clean = text.trim().toLowerCase();

  if (!clean) return { isValid: false, message: null };

  // MIN_JD_LENGTH matches the backend /analyze validation threshold exactly.
  if (clean.length < MIN_JD_LENGTH)
    return { isValid: false, message: `Tambahkan sedikit detail agar analisis lebih akurat (minimal ${MIN_JD_LENGTH} karakter)` };

  const hasStructure =
    /requirement|qualification|skill|responsibilit|duties/.test(clean) ||
    /kualifikasi|syarat|kemampuan|tanggung jawab|tugas|jobdesk/.test(clean);

  // Structure check is advisory only — don't block submission. Many valid JDs
  // omit these keywords while still providing enough context for analysis.
  if (!hasStructure)
    return { isValid: true, message: 'Tambahkan bagian kualifikasi atau tanggung jawab agar analisis lebih akurat' };

  return { isValid: true, message: null };
}
