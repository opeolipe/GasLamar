import { formatFilename } from '@/lib/analysisUtils';

interface Props {
  progress:  number;
  timerText: string;
  filename:  string;
}

export default function AnalysisProgress({ progress, timerText, filename }: Props) {
  return (
    <>
      <div className="inline-flex items-center gap-2 bg-slate-100 rounded-full px-4 py-2 text-[0.8rem] text-slate-700 font-medium mb-6">
        📄 <span className="font-semibold">{formatFilename(filename)}</span>
      </div>

      <div className="text-center my-4">
        <span
          className="text-5xl leading-none"
          style={{ display: 'inline-block', animation: 'gasAnalysisPulse 1.2s infinite ease-in-out' }}
        >
          🧠✨
        </span>
        <h2 className="mt-3 text-xl font-bold text-slate-900 leading-tight">
          Kami sedang menganalisis CV kamu…
        </h2>
        <p className="text-[0.85rem] text-slate-500 mt-1.5">
          Membandingkan dengan job dan pola screening recruiter
        </p>
      </div>

      <div className="w-full bg-slate-200 rounded-full h-2 mt-5 mb-2 overflow-hidden">
        <div
          className="h-full bg-slate-900 rounded-full"
          style={{ width: `${progress}%`, transition: 'width 0.5s ease-out' }}
        />
      </div>

      <p className="text-[0.8rem] text-[#5B6E8C] text-center font-medium py-1">
        {timerText}
      </p>
    </>
  );
}
