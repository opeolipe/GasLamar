import { useState, useEffect, useRef } from 'react';

const MESSAGES = {
  id: [
    'Menyiapkan Interview Kit kamu…',
    'Menganalisis job description…',
    'Membuat pertanyaan interview…',
    'Menyusun email lamaran…',
    'Hampir selesai…',
  ],
  en: [
    'Preparing your Interview Kit…',
    'Analyzing job description…',
    'Crafting interview questions…',
    'Writing your cover letter…',
    'Almost there…',
  ],
} as const;

const CYCLE_MS      = 3500;
const FILL_DURATION_S = 28;
const TICK_MS       = 500; // update progress every 500ms, not every frame

function ShimmerRow({ wide = false, height = 'h-[44px]' }: { wide?: boolean; height?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-[14px] ${height} mb-2 overflow-hidden ${wide ? 'w-full' : 'w-4/5'}`}
      style={{
        background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
        backgroundSize: '200% 100%',
        animation: 'ikShimmer 1.6s ease-in-out infinite',
      }}
    />
  );
}

function SectionLabel() {
  return (
    <div
      aria-hidden="true"
      className="h-3 w-24 rounded-full mt-5 mb-3"
      style={{
        background: 'linear-gradient(90deg, #e2e8f0 25%, #cbd5e1 50%, #e2e8f0 75%)',
        backgroundSize: '200% 100%',
        animation: 'ikShimmer 1.6s ease-in-out infinite',
      }}
    />
  );
}

interface InterviewKitSkeletonProps {
  language?: 'id' | 'en';
}

export default function InterviewKitSkeleton({ language = 'id' }: InterviewKitSkeletonProps) {
  const messages    = MESSAGES[language];
  const [msgIndex, setMsgIndex] = useState(0);
  const [fillPct, setFillPct]   = useState(0);
  const startRef    = useRef(Date.now());
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Cycle through status messages
  useEffect(() => {
    const id = setInterval(() => setMsgIndex(i => (i + 1) % messages.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [messages]);

  // Animate progress bar — throttled to TICK_MS, not every RAF frame
  useEffect(() => {
    if (reducedMotion) return; // skip animation if user prefers no motion
    startRef.current = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const pct = Math.min(85, (elapsed / FILL_DURATION_S) * 85);
      setFillPct(pct);
      if (pct >= 85) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <style>{`
        @keyframes ikShimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes ikFadeMsg {
          0%   { opacity: 0; transform: translateY(4px); }
          15%  { opacity: 1; transform: translateY(0); }
          85%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ik-shimmer-row { animation: none !important; }
          .ik-fade-msg    { animation: none !important; }
        }
      `}</style>

      {/* Status bar */}
      <div className="mb-5" role="status">
        <div className="flex items-center justify-between mb-1.5">
          <p
            key={msgIndex}
            aria-live="polite"
            className="ik-fade-msg text-sm text-slate-500"
            style={{ animation: `ikFadeMsg ${CYCLE_MS}ms ease-in-out` }}
          >
            {messages[msgIndex]}
          </p>
          {!reducedMotion && (
            <span className="text-xs text-slate-400 tabular-nums" aria-hidden="true">
              {Math.round(fillPct)}%
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div
          role="progressbar"
          aria-valuenow={Math.round(fillPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={language === 'en' ? 'Generating Interview Kit' : 'Menyiapkan Interview Kit'}
          className="h-1 w-full rounded-full bg-slate-100 overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-blue-500"
            style={{
              width: reducedMotion ? '100%' : `${fillPct}%`,
              transition: reducedMotion ? 'none' : 'width 0.5s ease-out',
            }}
          />
        </div>
      </div>

      {/* Skeleton accordions — aria-hidden so screen readers skip empty placeholders */}
      <div aria-hidden="true">
        <SectionLabel />
        <ShimmerRow />
        <ShimmerRow wide />
        <ShimmerRow />

        <SectionLabel />
        <ShimmerRow wide />

        <SectionLabel />
        <ShimmerRow />
      </div>
    </div>
  );
}
