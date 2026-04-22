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
