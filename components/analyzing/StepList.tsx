import type { AnalysisStep } from '@/hooks/useAnalysisPolling';

interface Props { steps: AnalysisStep[] }

export default function StepList({ steps }: Props) {
  return (
    <div className="mt-5 mb-2 rounded-2xl border border-slate-100 overflow-hidden" style={{ background: 'rgba(248,250,252,0.7)' }}>
      {steps.map((step, i) => (
        <div
          key={step.id}
          className={`flex items-center gap-3 px-4 py-3 text-[0.85rem] ${
            i < steps.length - 1 ? 'border-b border-slate-100' : ''
          } ${step.status === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}
        >
          <span className="w-5 flex-shrink-0 flex items-center justify-center">
            {step.status === 'done'
              ? <span className="text-emerald-500 font-bold text-sm">✓</span>
              : step.status === 'active'
              ? (
                <span
                  className="block w-3.5 h-3.5 rounded-full border-2 border-blue-200 border-t-blue-600"
                  style={{ animation: 'gasStepSpin 0.8s linear infinite' }}
                />
              )
              : <span className="block w-2 h-2 rounded-full bg-slate-200" />
            }
          </span>
          <span className={step.status === 'active' ? 'text-slate-800 font-medium' : ''}>
            {step.icon} {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
