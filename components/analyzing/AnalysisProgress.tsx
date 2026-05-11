import { formatFilename } from '@/lib/analysisUtils';

interface Props {
  progress:  number;
  timerText: string;
  filename:  string;
}

export default function AnalysisProgress({ progress, timerText, filename }: Props) {
  return (
    <>
      <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-[0.78rem] text-slate-600 font-medium mb-6">
        <span aria-hidden="true">📄</span> <span className="font-semibold text-slate-800">{formatFilename(filename)}</span>
      </div>

      <div className="text-center my-4">
        <span
          className="text-5xl leading-none"
          style={{ display: 'inline-block', animation: 'gasAnalysisPulse 1.2s infinite ease-in-out' }}
          aria-hidden="true"
        >
          🧠✨
        </span>
        <h2
          className="mt-3 text-xl font-semibold text-slate-900 leading-tight"
          style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}
        >
          Menganalisis CV kamu…
        </h2>
        <p className="text-[0.82rem] text-slate-500 mt-1.5">
          Membandingkan dengan job dan pola screening recruiter
        </p>
      </div>

      <div className="w-full bg-slate-100 rounded-full h-3 mt-5 mb-2 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${progress}%`,
            transition: 'width 0.5s ease-out',
            background: 'linear-gradient(90deg,#3b82f6,#1d4ed8)',
          }}
        />
      </div>

      <p className="text-[0.78rem] text-slate-400 text-center font-medium py-1 tabular-nums">
        {progress}% &nbsp;·&nbsp; {timerText}
      </p>
    </>
  );
}
