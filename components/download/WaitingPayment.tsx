import { useState, useEffect } from 'react';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

interface Props {
  statusText:      string;
  showCheckButton: boolean;
  onStartFresh?:   () => void;
}

export default function WaitingPayment({ statusText, showCheckButton, onStartFresh }: Props) {
  const [showContact,    setShowContact]    = useState(false);
  const [showSlowHint,   setShowSlowHint]   = useState(false);
  const [showStartFresh, setShowStartFresh] = useState(false);

  // Progressive hint after ~20 s — shows while still auto-polling, before check button
  useEffect(() => {
    const t = setTimeout(() => setShowSlowHint(true), 20_000);
    return () => clearTimeout(t);
  }, []);

  // Show contact link 2 minutes after the "check again" button appears.
  // Show "start fresh" 3 minutes after — gives webhook enough time to arrive
  // while still offering an exit for cancelled/failed payments.
  useEffect(() => {
    if (!showCheckButton) return;
    const t1 = setTimeout(() => setShowContact(true),    120_000);
    const t2 = setTimeout(() => setShowStartFresh(true), 180_000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [showCheckButton]);

  return (
    <div
      className="rounded-[24px] p-8 text-center"
      style={{
        background:     'rgba(255,255,255,0.88)',
        border:         '1px solid rgba(148,163,184,0.14)',
        boxShadow:      SHADOW,
        backdropFilter: 'blur(14px)',
      }}
    >
      {/* Spinner */}
      <div
        className="w-12 h-12 rounded-full mx-auto mb-5"
        style={{
          border:          '3px solid rgba(37,99,235,0.15)',
          borderTopColor:  '#2563EB',
          animation:       'gasDownloadSpin 1s linear infinite',
        }}
        aria-hidden="true"
      />

      <h2 className="text-lg font-semibold text-slate-900 mb-1" style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>Menunggu Konfirmasi Pembayaran</h2>
      <p className="text-sm text-slate-500 mb-1">Biasanya &lt; 1 menit setelah pembayaran berhasil</p>
      <p className="text-sm text-slate-400 mb-1" role="status" aria-live="polite">
        {statusText}
      </p>
      {showSlowHint && !showCheckButton && (
        <p className="text-xs text-slate-400 mb-4">Masih diproses — tunggu sebentar atau klik cek ulang jika lebih dari 1 menit</p>
      )}

      {showCheckButton && (
        <div className="flex flex-col items-center gap-3 mt-4">
          <button
            onClick={() => window.location.reload()}
            aria-label="Cek ulang status pembayaran dengan memuat ulang halaman"
            className="min-h-[48px] px-6 rounded-full font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
            style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          >
            Cek Ulang Status Pembayaran
          </button>
          {showContact && (
            <a
              href="mailto:support@gaslamar.com"
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
              title="Hubungi tim support GasLamar via email"
            >
              Sudah lebih dari 5 menit? Hubungi Kami
            </a>
          )}
          {showStartFresh && onStartFresh && (
            <div className="mt-2 pt-4 border-t border-slate-100 text-center w-full">
              <p className="text-xs text-slate-400 mb-2">
                Tidak jadi bayar? Kamu bisa mulai ulang dengan CV baru.
                <br />Jika sudah membayar, link download akan dikirim ke email kamu.
              </p>
              <button
                onClick={onStartFresh}
                className="text-sm text-slate-500 hover:text-blue-600 transition-colors underline"
              >
                Upload CV Baru &rarr;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
