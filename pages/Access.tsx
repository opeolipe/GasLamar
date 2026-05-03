import { useState } from 'react';
import { WORKER_URL } from '@/lib/downloadUtils';

type Status = 'idle' | 'loading' | 'sent' | 'error';

const SHADOW    = '0 18px 44px rgba(15, 23, 42, 0.08)';
const CARD_BG   = 'rgba(255,255,255,0.88)';
const CARD_BORD = '1px solid rgba(148,163,184,0.14)';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Access() {
  const showExpiredBanner =
    new URLSearchParams(window.location.search).get('expired') === '1';

  const [email,  setEmail]  = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !EMAIL_RE.test(trimmed) || status === 'loading') return;
    setStatus('loading');
    try {
      await fetch(`${WORKER_URL}/resend-access`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: trimmed.toLowerCase() }),
      });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div
      className="min-h-screen text-gray-900 font-sans"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.08), transparent)' }}
    >
      {/* Navbar */}
      <nav
        className="sticky top-0 z-50 flex items-center px-6 py-4"
        style={{
          background:     CARD_BG,
          borderBottom:   '1px solid rgba(148,163,184,0.18)',
          backdropFilter: 'blur(14px)',
        }}
        aria-label="Site navigation"
      >
        <a
          href="index.html"
          className="font-extrabold text-[1.1rem] text-slate-900 no-underline tracking-[-0.02em]"
        >
          GasLamar
        </a>
      </nav>

      {/* Main */}
      <main className="px-4 py-10">
        <div className="max-w-[480px] mx-auto">

          {/* Expired banner */}
          {showExpiredBanner && (
            <div
              role="status"
              className="mb-5 px-4 py-3 rounded-[12px] text-sm text-center"
              style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}
            >
              Link kamu sudah kadaluarsa, tapi tenang — kamu masih bisa akses CV kamu.
            </div>
          )}

          {/* Card */}
          <div
            className="rounded-[24px] p-8 text-center"
            style={{ background: CARD_BG, border: CARD_BORD, boxShadow: SHADOW, backdropFilter: 'blur(14px)' }}
          >
            {/* Email icon */}
            <div
              className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-5"
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

            <h1
              className="text-xl font-semibold text-slate-900 mb-2"
              style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}
            >
              Akses CV kamu
            </h1>

            <p className="text-sm text-slate-500 mb-6 leading-relaxed max-w-sm mx-auto">
              Masukkan email yang kamu gunakan untuk pembayaran. Kami akan kirim ulang link akses ke email kamu.
            </p>

            {status === 'sent' ? (
              <p className="text-sm font-medium text-blue-600 leading-relaxed">
                Link sudah dikirim. Cek email kamu (termasuk folder spam).
              </p>
            ) : (
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
                  {status === 'loading' ? 'Mengirim link...' : 'Kirim ulang link'}
                </button>

                {status === 'error' && (
                  <p className="text-xs text-red-500" role="alert">
                    Terjadi kendala. Coba lagi dalam beberapa detik.
                  </p>
                )}
              </form>
            )}

            <p className="mt-6 text-xs text-slate-400 leading-relaxed">
              Tidak perlu bayar lagi. CV kamu tetap tersimpan selama masa aktif.
            </p>

            <a
              href="mailto:support@gaslamar.com"
              className="block mt-4 text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              Butuh bantuan? Hubungi support
            </a>
          </div>
        </div>
      </main>

      <footer className="text-center py-8 text-sm text-slate-400">
        <a href="privacy.html" className="text-slate-500 no-underline hover:underline mx-2">Kebijakan Privasi</a>
        ·
        <a href="terms.html"   className="text-slate-500 no-underline hover:underline mx-2">Syarat Layanan</a>
      </footer>
    </div>
  );
}
