import { useState, useEffect, useRef } from 'react';
import { TIER_LABELS } from '@/lib/downloadUtils';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

const TRUST_MSGS = [
  '🔒 CV tidak disimpan — data aman',
  '🎯 Setiap bullet disesuaikan dengan lowonganmu',
  '📧 Link download akan dikirim ke email kamu',
];

const STEP_DEFS = [
  { label: 'Menyesuaikan dengan job description & CV asli' },
  { label: 'Menulis ulang bullet points (bilingual ID + EN)' },
  { label: 'Menambahkan metrik & kata kunci HR' },
  { label: 'Menyusun CV akhir siap download' },
];

// Thresholds: [activeAt, doneAt]
const STEP_THRESHOLDS: [number, number][] = [
  [10, 30],
  [40, 60],
  [70, 90],
  [90, 110], // step 4 never "done" until status=done
];

type StepStatus = 'pending' | 'active' | 'done';

function getStepStatus(pct: number, idx: number, allDone: boolean): StepStatus {
  if (allDone) return 'done';
  const [activeAt, doneAt] = STEP_THRESHOLDS[idx];
  if (pct >= doneAt)   return 'done';
  if (pct >= activeAt) return 'active';
  return 'pending';
}

interface Props {
  progress:  number;
  status:    'running' | 'done';
  filename:  string;
  tier:      string | null;
  onCancel:  () => void;
}

export default function GeneratingCV({ progress, status, filename, tier, onCancel }: Props) {
  const [trustIdx,   setTrustIdx]   = useState(0);
  const [trustFade,  setTrustFade]  = useState(false);
  const [timerText,  setTimerText]  = useState('⏱️ Estimasi sisa: ~22 detik');
  const startRef     = useRef(Date.now());
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const trustRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const allDone      = status === 'done';
  const tierLabel    = tier ? (TIER_LABELS[tier] ?? tier) : 'Single';

  // Countdown timer
  useEffect(() => {
    const EST = 22;
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const rem     = Math.max(0, Math.ceil(EST - elapsed));
      if (rem <= 0) {
        setTimerText('✅ CV siap! Memuat file...');
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setTimerText(`⏱️ Estimasi sisa: ~${rem} detik`);
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Trust rotator
  useEffect(() => {
    trustRef.current = setInterval(() => {
      setTrustFade(true);
      setTimeout(() => {
        setTrustIdx(i => (i + 1) % TRUST_MSGS.length);
        setTrustFade(false);
      }, 150);
    }, 5000);
    return () => { if (trustRef.current) clearInterval(trustRef.current); };
  }, []);

  return (
    <div
      className="rounded-[24px] p-6 sm:p-8"
      style={{
        background:     'rgba(255,255,255,0.88)',
        border:         '1px solid rgba(148,163,184,0.14)',
        boxShadow:      SHADOW,
        backdropFilter: 'blur(14px)',
      }}
    >
      {/* Progress steps */}
      <DownloadSteps />

      {/* File badge */}
      <div
        className="inline-flex items-center gap-2 text-xs font-medium rounded-full px-4 py-2 mb-7"
        style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.18)', color: '#1D4ED8' }}
      >
        📄 <strong>{filename}</strong> · Paket: {tierLabel}
      </div>

      {/* Pulse icon + headline */}
      <div className="text-center mb-4">
        <div className="text-5xl mb-3" style={{ animation: 'gasDownloadPulse 1.2s infinite ease-in-out', display: 'inline-block' }}>
          ✍️✨
        </div>
        <h3 className="font-semibold text-lg text-slate-900" style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>AI sedang menulis CV tailored untuk kamu…</h3>
        <p className="text-sm text-slate-500 mt-1">Biasanya 15–25 detik · Jangan tutup halaman</p>
      </div>

      {/* Progress bar */}
      <div className="rounded-full overflow-hidden my-5" style={{ background: 'rgba(148,163,184,0.18)', height: 6 }}>
        <div
          className="h-full rounded-full"
          style={{
            width:      `${progress}%`,
            background: 'linear-gradient(90deg,#60a5fa,#2563eb)',
            transition: 'width 0.3s ease',
          }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress generate CV"
        />
      </div>

      {/* Step list */}
      <div
        className="rounded-[20px] p-4 my-4"
        style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}
      >
        {STEP_DEFS.map((step, i) => {
          const s = getStepStatus(progress, i, allDone);
          return (
            <div
              key={i}
              className="flex items-center gap-3 py-3 text-sm text-slate-600"
              style={{ borderBottom: i < STEP_DEFS.length - 1 ? '1px solid rgba(226,232,240,0.6)' : 'none' }}
            >
              <span className="w-5 flex-shrink-0 flex items-center justify-center" aria-hidden="true">
                {s === 'done'
                  ? <span className="text-emerald-500 font-bold text-sm">✓</span>
                  : s === 'active'
                  ? <span className="block w-3.5 h-3.5 rounded-full border-2 border-blue-200 border-t-blue-600" style={{ animation: 'gasDownloadSpin 0.8s linear infinite' }} />
                  : <span className="block w-2 h-2 rounded-full bg-slate-200" />
                }
              </span>
              <span className={s === 'active' ? 'text-slate-800 font-medium' : ''}>{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Timer */}
      <p className="text-center text-[0.78rem] text-slate-400 tabular-nums my-2">{timerText}</p>

      {/* Trust rotator */}
      <p
        className="text-center text-[0.78rem] text-slate-400 my-4 transition-opacity duration-150"
        style={{ opacity: trustFade ? 0 : 1 }}
        aria-live="polite"
      >
        {TRUST_MSGS[trustIdx]}
      </p>

      {/* Cancel link */}
      <div className="text-center mt-3">
        <button
          onClick={() => {
            if (window.confirm('Batalkan proses penulisan?')) onCancel();
          }}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-none cursor-pointer font-[inherit] min-h-[44px] px-3"
        >
          ← Batalkan &amp; kembali ke hasil analisis
        </button>
      </div>
    </div>
  );
}

// ── DownloadSteps ─────────────────────────────────────────────────────────────

function DownloadSteps() {
  const steps = [
    { label: '1. Upload', done: true  },
    { label: '2. Hasil',  done: true  },
    { label: '3. Download', done: false, active: true },
  ];

  return (
    <div className="relative flex justify-between mb-8">
      <div className="absolute top-[11px] left-0 right-0 h-px bg-slate-200 z-0" />
      {steps.map((s, i) => (
        <div key={i} className="relative z-10 flex flex-col items-center text-center flex-1">
          <span className={`block text-[0.7rem] font-bold leading-none mb-1 ${s.done ? 'text-emerald-500' : s.active ? 'text-slate-900' : 'text-slate-300'}`}>
            {s.done ? '✓' : s.active ? '●' : '○'}
          </span>
          <span className={`text-[0.82rem] leading-tight ${s.done ? 'text-emerald-600 font-semibold' : s.active ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
