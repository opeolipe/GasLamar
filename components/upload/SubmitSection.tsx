import { useEffect, useRef, useState } from 'react';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

const PROGRESS_STEPS = [
  { pct: 25, delay: 2000  },
  { pct: 45, delay: 8000  },
  { pct: 65, delay: 15000 },
  { pct: 80, delay: 25000 },
  { pct: 85, delay: 35000 },
];

interface Props {
  isValid:   boolean;
  isLoading: boolean;
  hint:      string | null;
  onSubmit:  () => void;
}

export default function SubmitSection({ isValid, isLoading, hint, onSubmit }: Props) {
  const [progress,     setProgress]     = useState(0);
  const [loadingText,  setLoadingText]  = useState('Menyiapkan analisis...');
  const [scrollHidden, setScrollHidden] = useState(false);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const timers   = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Hide scroll hint when button enters viewport
  useEffect(() => {
    const btn = btnRef.current;
    if (!btn || !('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setScrollHidden(true); obs.disconnect(); }
    }, { threshold: 0.5 });
    obs.observe(btn);
    return () => obs.disconnect();
  }, []);

  // Simulate progress while loading
  useEffect(() => {
    if (!isLoading) {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setProgress(0);
      return;
    }
    setProgress(5);
    setLoadingText('Menyiapkan analisis...');
    PROGRESS_STEPS.forEach(({ pct, delay }) => {
      timers.current.push(setTimeout(() => setProgress(pct), delay));
    });
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [isLoading]);

  return (
    <div className="mt-6">
      {!scrollHidden && (
        <div className="text-center text-slate-400 text-xs mb-3 animate-bounce" aria-hidden="true">
          <svg className="block mx-auto mb-1" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Scroll untuk tombol analisis
        </div>
      )}

      <button
        ref={btnRef}
        type="button"
        id="submit-btn"
        onClick={onSubmit}
        disabled={!isValid || isLoading}
        className="min-h-[56px] w-full rounded-[16px] px-6 py-4 text-white font-bold text-base border-0 transition-all hover:-translate-y-[1px] disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0 flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: SHADOW }}
        aria-label="Mulai analisis CV kamu"
      >
        {isLoading ? (
          <>
            <span className="inline-block w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
            {loadingText}
          </>
        ) : '👉 Analisis CV Saya'}
      </button>

      {hint && !isLoading && (
        <p className="text-center text-xs text-slate-400 mt-2">{hint}</p>
      )}

      {isLoading && (
        <div className="mt-3 text-center">
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden w-3/5 mx-auto">
            <div
              className="h-full bg-blue-600 rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">{progress}%</p>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 mt-5 text-xs text-slate-400">
        <span>🔒 CV tidak disimpan</span>
        <span>⚡ Proses ±30 detik</span>
        <span>❌ Tidak perlu daftar</span>
        <span>⏰ Preview gratis 2 jam</span>
        <span>💳 Link download 7–30 hari</span>
      </div>
    </div>
  );
}
