import React, { useState, useEffect, useRef } from 'react';
import { TIER_LABELS } from '@/lib/sessionUtils';
import ResendEmail from '@/components/download/ResendEmail';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

const ACTIVITY_MSGS: React.ReactNode[] = [
  <>Lagi nyesuaiin keyword ATS biar CV kamu makin nyambung...</>,
  <>Sedang menulis ulang pengalaman kerja kamu biar lebih relevan...</>,
  <>Lagi rapihin format final PDF dan DOCX...</>,
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
  deliveryEmail?: string | null;
  sessionSecret?: string | null;
  onCancel:  () => void;
}

export default function GeneratingCV({ progress, status, filename, tier, deliveryEmail, sessionSecret, onCancel }: Props) {
  const [activityIdx,  setActivityIdx]  = useState(0);
  const [activityFade, setActivityFade] = useState(false);
  const [timerText,    setTimerText]    = useState('Biasanya CV selesai dalam 30-60 detik');
  const startRef     = useRef(Date.now());
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const allDone      = status === 'done';
  const tierLabel    = tier ? (TIER_LABELS[tier] ?? tier) : 'Bilingual';

  // Countdown timer
  useEffect(() => {
      const EST = 50;
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startRef.current) / 1000;
        const rem     = Math.max(0, Math.ceil(EST - elapsed));
        if (rem <= 0) {
        setTimerText('Hampir jadi. Sedang nyelesaiin tahap terakhir...');
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setTimerText(`Biasanya kurang dari 1 menit · sekitar ${rem} detik lagi`);
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Activity rotator
  useEffect(() => {
    activityRef.current = setInterval(() => {
      setActivityFade(true);
      setTimeout(() => {
        setActivityIdx(i => (i + 1) % ACTIVITY_MSGS.length);
        setActivityFade(false);
      }, 150);
    }, 2800);
    return () => { if (activityRef.current) clearInterval(activityRef.current); };
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

      <div className="mb-6 rounded-2xl p-4 sm:p-5" style={{ background: 'rgba(248,250,252,0.9)', border: '1px solid rgba(148,163,184,0.18)' }}>
        <div className="flex flex-wrap gap-3 items-center mb-2">
          <span className="inline-flex items-center gap-2 text-sm font-medium rounded-full px-3.5 py-1.5 max-w-full" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.18)', color: '#1D4ED8', overflow: 'hidden' }}>
            <span style={{ flexShrink: 0 }} aria-hidden="true">📄</span>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{filename}</strong>
          </span>
          <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" style={{ background: '#EEF2FF', color: '#1E3A8A', border: '1px solid #C7D2FE' }}>
            Paket: {tierLabel}
          </span>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 m-0">Output: PDF · DOCX · {tierLabel === 'Coba Dulu' ? 'Bahasa Indonesia' : 'Bahasa Indonesia + English'}</p>
      </div>

      {/* Animated icon + headline */}
      <div className="text-center mb-5">
        <div className="mb-3 inline-flex items-center justify-center w-14 h-14 rounded-full" style={{ border: '1px solid rgba(59,130,246,0.25)', background: 'linear-gradient(180deg, rgba(239,246,255,0.95), rgba(219,234,254,0.95))' }} aria-hidden="true">
          <span className="block w-6 h-6 rounded-full border-2 border-blue-200 border-t-blue-600" style={{ animation: 'gasDownloadSpin 1.1s linear infinite' }} />
        </div>
        <h3 className="font-semibold text-lg text-slate-900" style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>AI lagi menyiapkan CV kamu</h3>
        <p className="text-sm text-slate-500 mt-1">CV kamu lagi ditulis ulang supaya lebih cocok sama posisi yang kamu incar.</p>
        {deliveryEmail && (
          <div className="mt-3 text-sm text-slate-600">
            <p className="m-0">Nanti link download otomatis dikirim ke:</p>
            <p className="m-0 font-medium text-slate-800 break-all">{deliveryEmail}</p>
            <ResendEmail sessionSecret={sessionSecret ?? null} compact />
          </div>
        )}
      </div>

      <div
        className="rounded-2xl p-6 my-4"
        style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}
      >
        <p
          className="text-sm text-slate-500 mb-4 transition-opacity duration-150"
          style={{ opacity: activityFade ? 0 : 1, minHeight: 20 }}
          aria-live="polite"
        >
          {ACTIVITY_MSGS[activityIdx]}
        </p>

        {/* Step list */}
        <div style={{ display: 'grid', gap: 18 }}>
          {STEP_DEFS.map((step, i) => {
            const s = getStepStatus(progress, i, allDone);
            return (
              <div
                key={i}
                className="flex items-center gap-3 text-sm text-slate-600"
                style={{ paddingBottom: i < STEP_DEFS.length - 1 ? '18px' : '0', borderBottom: i < STEP_DEFS.length - 1 ? '1px solid rgba(226,232,240,0.7)' : 'none' }}
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
      </div>

      {/* Timer */}
      <p className="text-center text-[0.8rem] text-slate-500 tabular-nums my-2">{timerText}</p>
      <p className="text-center text-[0.8rem] text-slate-500 my-3">Kamu bisa tunggu di sini, atau balik lagi lewat email begitu selesai.</p>

      {/* Cancel link */}
      <div className="text-center mt-3">
        <button
          onClick={() => {
            if (window.confirm('Yakin mau batalkan proses ini?')) onCancel();
          }}
          className="text-[13px] text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-none cursor-pointer font-[inherit] min-h-[44px] px-3"
          style={{ opacity: 0.65 }}
        >
          ← Batalkan &amp; balik ke hasil analisis
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
          <span
            className={`block text-[0.7rem] font-bold leading-none mb-1 ${s.done ? 'text-emerald-500' : s.active ? 'text-slate-900' : 'text-slate-300'}`}
            aria-label={s.done ? 'Selesai' : s.active ? 'Aktif' : 'Menunggu'}
          >
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
