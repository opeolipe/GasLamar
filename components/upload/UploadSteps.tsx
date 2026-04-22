const STEPS = [
  { n: 1 as const, label: '1. Upload CV', desc: 'PDF / DOCX / TXT · maks 5MB' },
  { n: 2 as const, label: '2. Job Desc',  desc: 'wajib · naikkan akurasi 3×'  },
  { n: 3 as const, label: '3. Analisis',  desc: '±30 detik'                   },
];

interface Props { currentStep: 1 | 2 | 3 }

export default function UploadSteps({ currentStep }: Props) {
  return (
    <div className="relative flex justify-between mb-8">
      <div className="absolute top-[11px] left-0 right-0 h-px bg-slate-200 z-0" />
      {STEPS.map(({ n, label, desc }) => {
        const done   = n < currentStep;
        const active = n === currentStep;
        return (
          <div key={n} className="relative z-10 flex flex-col items-center text-center flex-1 gap-0.5"
               aria-label={`Langkah ${n}: ${label} — ${done ? 'selesai' : active ? 'aktif' : 'belum dimulai'}`}
          >
            <span aria-hidden="true" className={`block text-[0.7rem] font-bold leading-none mb-1 ${done ? 'text-emerald-500' : active ? 'text-slate-900' : 'text-slate-300'}`}>
              {done ? '✓' : active ? '●' : '○'}
            </span>
            <span className={`text-[0.82rem] leading-tight ${done ? 'text-emerald-600 font-semibold' : active ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'}`}>
              {label}
            </span>
            <span className={`text-[0.68rem] hidden sm:block mt-0.5 ${done ? 'text-emerald-400' : active ? 'text-slate-400' : 'text-slate-300'}`}>
              {desc}
            </span>
          </div>
        );
      })}
    </div>
  );
}
