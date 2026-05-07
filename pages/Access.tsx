import { useState } from 'react';
import { WORKER_URL } from '@/lib/uploadValidation';

type Status = 'idle' | 'loading' | 'sent' | 'error';

const SHADOW  = '0 18px 44px rgba(15, 23, 42, 0.08)';
const SERIF   = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' } as const;

function isSameOriginUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export default function Access() {
  const params = new URLSearchParams(window.location.search);
  const showExpiredBanner = params.get('expired') === '1';

  // Strip return_url immediately — this page doesn't redirect to it.
  // Leaving external URLs in the query string creates an open-redirect signal
  // even if client-side code never follows them.
  if (params.has('return_url')) {
    const raw = params.get('return_url') ?? '';
    if (!isSameOriginUrl(raw)) {
      params.delete('return_url');
      history.replaceState(null, '', params.toString() ? `${location.pathname}?${params}` : location.pathname);
    }
  }

  const [email,  setEmail]  = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || status === 'loading') return;
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
      {/* Skip link */}
      <a
        href="#access-main"
        className="absolute left-[-9999px] top-0 z-[9999] bg-slate-900 text-white px-4 py-2 text-sm font-semibold rounded-br-lg focus:left-0"
      >
        Langsung ke form akses
      </a>

      {/* Navbar */}
      <nav
        className="border-b py-4 px-6 flex items-center sticky top-0 z-50 backdrop-blur-[14px]"
        style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(255,255,255,0.88)' }}
        aria-label="Site navigation"
      >
        <a href="index.html" className="no-underline min-h-[44px] inline-flex items-center">
          <img src="assets/logo.svg" alt="GasLamar" height="28" style={{ display: 'block' }} />
        </a>
      </nav>

      {/* Main */}
      <main id="access-main" className="max-w-screen-xl mx-auto px-6 pt-14 pb-8">

        {/* Page title — above the card, not inside it */}
        <div className="text-center mb-8 max-w-[480px] mx-auto">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">
            Pemulihan akses
          </p>
          <h1
            className="text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-tight text-slate-900 mb-2"
            style={SERIF}
          >
            Akses CV kamu
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Masukkan email yang kamu gunakan untuk pembayaran.
            Kami akan kirim ulang link akses ke email kamu.
          </p>
        </div>

        <div className="max-w-[480px] mx-auto">

          {/* Expired notice — same pattern as Upload's notice system */}
          {showExpiredBanner && (
            <div
              role="status"
              className="rounded-[16px] px-4 py-3 text-sm mb-4 text-amber-800"
              style={{ background: 'rgba(255,251,235,0.9)', border: '1px solid rgba(253,230,138,0.8)' }}
            >
              ⏰ Link kamu sudah kadaluarsa, tapi tenang — kamu masih bisa akses CV kamu.
            </div>
          )}

          {/* Card */}
          <div
            className="rounded-[24px] px-8 py-9 text-center"
            style={{
              background:     'rgba(255,255,255,0.88)',
              border:         '1px solid rgba(148,163,184,0.14)',
              boxShadow:      SHADOW,
              backdropFilter: 'blur(14px)',
            }}
          >
            {status === 'sent' ? (
              /* ── Success state ── */
              <>
                <div
                  className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-4"
                  style={{ background: 'rgba(240,253,244,0.9)', border: '1px solid rgba(34,197,94,0.2)' }}
                  aria-hidden="true"
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M20 6L9 17l-5-5"
                      stroke="#22C55E"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <h2
                  className="text-lg font-semibold text-slate-900 mb-2"
                  style={SERIF}
                >
                  Link sudah dikirim
                </h2>
                <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
                  Jika email terdaftar, link baru telah dikirim. Cek email kamu — termasuk folder spam.
                </p>
                <p className="mt-4 text-sm font-medium text-blue-600">
                  Buka email kamu untuk lanjutkan akses.
                </p>
              </>
            ) : (
              /* ── Form state ── */
              <>
                {/* Email icon */}
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
                    style={{ background: '#1B4FE8', boxShadow: SHADOW }}
                  >
                    {status === 'loading' ? 'Mengirim link...' : 'Kirim ulang link'}
                  </button>

                  {status === 'error' && (
                    <p className="text-xs text-red-500 text-center" role="alert">
                      Terjadi kendala. Coba lagi dalam beberapa detik.
                    </p>
                  )}
                </form>

                <p className="mt-6 text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
                  Tidak perlu bayar lagi. CV kamu tetap tersimpan selama masa aktif.
                </p>
              </>
            )}
          </div>

          <a
            href="mailto:support@gaslamar.com"
            className="block text-center mt-6 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            📧 Butuh bantuan? Hubungi support
          </a>
        </div>
      </main>

      <footer className="text-center py-6 text-sm text-slate-400">
        <a href="privacy.html"       className="text-slate-400 underline hover:text-slate-600 mx-2">Kebijakan Privasi</a>
        ·
        <a href="terms.html"         className="text-slate-400 underline hover:text-slate-600 mx-2">Syarat Layanan</a>
        ·
        <a href="accessibility.html" className="text-slate-400 underline hover:text-slate-600 mx-2">Aksesibilitas</a>
      </footer>
    </div>
  );
}
