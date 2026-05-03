import { useState } from 'react';
import { WORKER_URL } from '@/lib/downloadUtils';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

type Status = 'idle' | 'loading' | 'sent' | 'error';

export default function ExpiredLinkRecovery() {
  const [email,  setEmail]  = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || status === 'loading') return;
    setStatus('loading');
    try {
      await fetch(`${WORKER_URL}/resend-access`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div
      data-testid="expired-link-recovery"
      className="rounded-[24px] p-8 text-center"
      style={{
        background:     'rgba(255,255,255,0.88)',
        border:         '1px solid rgba(148,163,184,0.14)',
        boxShadow:      SHADOW,
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-4"
        style={{ background: 'rgba(239,246,255,0.9)', border: '1px solid rgba(59,130,246,0.18)' }}
        aria-hidden="true"
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            stroke="#3B82F6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {status === 'sent' ? (
        <>
          <h2
            className="text-lg font-semibold text-slate-900 mb-2"
            style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}
          >
            Link baru sedang dikirim
          </h2>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed max-w-sm mx-auto">
            Jika email terdaftar, link baru telah dikirim. Biasanya email masuk dalam beberapa detik — cek juga folder spam.
          </p>
          <p className="text-sm font-medium text-blue-600">Buka email kamu untuk lanjutkan akses.</p>
        </>
      ) : (
        <>
          <h2
            className="text-lg font-semibold text-slate-900 mb-2"
            style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}
          >
            Link sudah kedaluwarsa
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed max-w-sm mx-auto">
            CV kamu masih aman. Masukkan email yang kamu daftarkan saat pembayaran untuk lanjutkan akses.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 items-stretch max-w-xs mx-auto">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@kamu.com"
              required
              disabled={status === 'loading'}
              className="min-h-[48px] px-4 rounded-[14px] border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              aria-label="Alamat email"
            />
            <button
              type="submit"
              disabled={status === 'loading' || !email.trim()}
              className="min-h-[48px] px-6 rounded-[16px] font-bold text-white text-sm transition-all hover:-translate-y-[1px] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: SHADOW }}
            >
              {status === 'loading' ? 'Mengirim...' : 'Kirim ulang link'}
            </button>
            {status === 'error' && (
              <p className="text-xs text-red-500">
                Gagal mengirim. Coba lagi atau hubungi{' '}
                <a href="mailto:support@gaslamar.com" className="underline">support@gaslamar.com</a>
              </p>
            )}
          </form>
        </>
      )}

      <a
        href="mailto:support@gaslamar.com"
        className="block mt-6 text-sm text-slate-400 hover:text-slate-600 transition-colors"
      >
        Butuh bantuan? Hubungi support
      </a>
    </div>
  );
}
