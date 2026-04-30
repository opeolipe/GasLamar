const ISSUE_COPY: Record<string, { title: string; description: string }> = {
  portfolio: {
    title:       'CV kamu belum menunjukkan hasil kerja yang nyata',
    description: 'HR scan CV dalam 7 detik dan langsung cari angka atau dampak konkret. Tanpa itu, CV terlihat seperti daftar tugas — dan mudah dilewati.',
  },
  recruiter_signal: {
    title:       'CV kamu belum cukup menonjol di 7 detik pertama',
    description: 'HR memutuskan lanjut atau tidak hanya dalam 6–7 detik. Kalau bagian atas CV tidak langsung menunjukkan value-mu, peluang dipanggil turun drastis.',
  },
  north_star: {
    title:       'CV kamu belum terlihat pas untuk posisi ini',
    description: 'Rekruter mencocokkan CV dengan job description secara cepat. Kalau kata kunci dan pengalamanmu tidak nyambung, CV mudah dilewati.',
  },
  effort: {
    title:       'Masih ada gap skill yang perlu ditutup lebih dulu',
    description: 'HR menilai seberapa siap kamu dari hari pertama kerja. Semakin banyak skill yang belum ada di CV, semakin kecil kemungkinan dipanggil interview.',
  },
  risk: {
    title:       'Beberapa skill di CV kamu mulai kurang relevan',
    description: 'Rekruter memprioritaskan kandidat dengan skill yang dibutuhkan sekarang dan ke depan. Skill yang jarang dicari bisa bikin CV kamu terlihat ketinggalan.',
  },
};

interface Props {
  issueKey: string;
}

export default function PrimaryHighlight({ issueKey }: Props) {
  const copy = ISSUE_COPY[issueKey];
  if (!copy) return null;

  return (
    <div className="mb-5">
      <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-1">
        Masalah utama kamu
      </p>
      <h3 className="text-[1.05rem] font-semibold text-slate-900 leading-snug">
        {copy.title}
      </h3>
      <p className="text-sm text-slate-500 mt-1 leading-relaxed">
        {copy.description}
      </p>
    </div>
  );
}
