const DEFAULT_SAMPLE = 'Bertanggung jawab menjalankan tugas harian';

interface RewritePair {
  before: string;
  after:  string;
}

export function generateRewritePreview(issue: string, sampleText?: string): RewritePair | null {
  const text = sampleText || DEFAULT_SAMPLE;

  switch (issue) {
    case 'portfolio':
      return {
        before: text,
        after:  text + ' — meningkatkan efisiensi proses sebesar 30% dalam 2 bulan',
      };
    case 'recruiter_signal':
      return {
        before: text,
        after:  'Memimpin inisiatif [spesifik] yang menghasilkan [dampak terukur] untuk tim',
      };
    case 'north_star':
      return {
        before: text,
        after:  text + ', langsung relevan dengan kebutuhan posisi yang dilamar',
      };
    case 'effort':
      return {
        before: text,
        after:  text + ' — ditambah skill [nama skill dari JD] yang sudah dipelajari',
      };
    case 'risk':
      return {
        before: text,
        after:  text + ' menggunakan tools yang masih aktif dipakai industri saat ini',
      };
    default:
      return null;
  }
}
