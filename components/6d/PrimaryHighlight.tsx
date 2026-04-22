const ISSUE_COPY: Record<string, { title: string; description: string }> = {
  portfolio: {
    title:       'Belum ada bukti hasil kerja yang jelas',
    description: 'CV kamu masih terlihat seperti daftar tugas, bukan hasil kerja. HR lebih tertarik pada dampak nyata.',
  },
  recruiter_signal: {
    title:       'CV belum menarik di 7 detik pertama',
    description: 'HR kemungkinan langsung skip karena CV belum menunjukkan value dengan cepat.',
  },
  north_star: {
    title:       'CV belum cukup relevan dengan job ini',
    description: 'Rekruter tidak bisa langsung melihat kecocokan kamu dengan posisi ini — CV yang tidak relevan biasanya di-skip dalam 7 detik pertama.',
  },
  effort: {
    title:       'Masih butuh waktu untuk siap interview',
    description: 'Ada skill gap yang belum tertutup. HR yang melihatnya akan meragukan kesiapan kamu — dan memilih kandidat lain yang lebih siap.',
  },
  risk: {
    title:       'Skill mulai kurang relevan ke depan',
    description: 'Beberapa skill di CV kamu mulai ditinggalkan industri — HR yang melihatnya akan meragukan current relevance kamu untuk posisi ini.',
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
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
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
