import { useState, useEffect } from 'react';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

interface Props {
  statusText:      string;
  showCheckButton: boolean;
  onCheckNow:      () => void;
}

export default function WaitingPayment({ statusText, showCheckButton, onCheckNow }: Props) {
  const [showContact, setShowContact] = useState(false);

  // Show contact link 5 minutes after the "check again" button appears
  useEffect(() => {
    if (!showCheckButton) return;
    const t = setTimeout(() => setShowContact(true), 300_000);
    return () => clearTimeout(t);
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
      <p className="text-sm text-slate-500 mb-1">Biasanya 1–2 menit setelah pembayaran berhasil</p>
      <p className="text-sm text-slate-400 mb-5" role="status" aria-live="polite">
        {statusText}
      </p>

      {showCheckButton && (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onCheckNow}
            aria-label="Cek ulang status pembayaran ke server"
            className="min-h-[48px] px-6 rounded-full font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
            style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          >
            Cek Ulang Status Pembayaran
          </button>
          <button
            onClick={() => window.location.reload()}
            aria-label="Muat ulang halaman ini"
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors underline"
          >
            Muat Ulang Halaman
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
        </div>
      )}
    </div>
  );
}
