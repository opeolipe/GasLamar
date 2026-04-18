import type { AnalysisStep } from '@/hooks/useAnalysisPolling';

interface Props { steps: AnalysisStep[] }

export default function StepList({ steps }: Props) {
  return (
    <div className="mt-5 mb-2 bg-[#FAFCFE] rounded-2xl border border-[#EDF2F7] overflow-hidden">
      {steps.map((step, i) => (
        <div
          key={step.id}
          className={`flex items-center gap-3 px-4 py-3 text-[0.9rem] ${
            i < steps.length - 1 ? 'border-b border-[#F0F4F9]' : ''
          } ${step.status === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}
        >
          <span className="w-6 text-center text-base flex-shrink-0 leading-none">
            {step.status === 'done'
              ? <span className="text-emerald-500 font-bold">✓</span>
              : step.status === 'active'
              ? <span style={{ display: 'inline-block', animation: 'gasStepSpin 1s linear infinite' }}>⟳</span>
              : <span className="text-slate-300">○</span>
            }
          </span>
          <span>{step.icon} {step.label}</span>
        </div>
      ))}
    </div>
  );
}
