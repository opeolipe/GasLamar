export function evaluateJDQuality(text: string): { isValid: boolean; missing: string[] } {
  const clean = text.trim().toLowerCase();

  if (!clean) return { isValid: false, missing: [] };

  const missing: string[] = [];

  if (clean.length < 80) {
    missing.push('detail job description');
  }

  const hasStructure =
    /requirement|qualification|skill|responsibilit|duties/.test(clean) ||
    /kualifikasi|syarat|kemampuan|tanggung jawab|tugas|jobdesk/.test(clean);

  if (!hasStructure) {
    missing.push('kualifikasi / tanggung jawab');
  }

  const hasCompany =
    /pt |cv |inc|ltd|llc|company|perusahaan|yayasan|firm/.test(clean);

  if (!hasCompany) {
    missing.push('nama perusahaan');
  }

  return { isValid: missing.length === 0, missing };
}
