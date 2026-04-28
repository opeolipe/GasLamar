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

  if (clean.length < 80)
    return { isValid: false, message: 'Tambahkan sedikit detail agar analisis lebih akurat' };

  const hasStructure =
    /requirement|qualification|skill|responsibilit|duties/.test(clean) ||
    /kualifikasi|syarat|kemampuan|tanggung jawab|tugas|jobdesk/.test(clean);

  if (!hasStructure)
    return { isValid: false, message: 'Tambahkan bagian kualifikasi atau tanggung jawab' };

  return { isValid: true, message: null };
}
