import { useState, useEffect, useRef }       from 'react';
import UploadSteps                             from '@/components/upload/UploadSteps';
import ScoreDisplay                            from '@/components/result/ScoreDisplay';
import VerdictCard                             from '@/components/result/VerdictCard';
import GapList                                 from '@/components/result/GapList';
import RecommendationList                      from '@/components/result/RecommendationList';
import BeforeAfterProjection                   from '@/components/result/BeforeAfterProjection';
import RewritePreview                          from '@/components/result/RewritePreview';
import PricingSelector                         from '@/components/result/PricingSelector';
import EmailCapture                            from '@/components/result/EmailCapture';
import DetailAnalysis                          from '@/components/result/DetailAnalysis';
import RedFlags                                from '@/components/result/RedFlags';
import { useResultData }                       from '@/hooks/useResultData';
import { useSessionCountdown }                 from '@/hooks/useSessionCountdown';
import { WORKER_URL, TIER_CONFIG, EMAIL_REGEX, formatPrice } from '@/lib/resultUtils';

// ── DevTools notice (educational, not a security control) ──────────────────
console.log(
  '%c⚠️ GasLamar — Perhatian',
  'color:#92400E;background:#FFFBEB;font-size:14px;font-weight:700;padding:4px 10px;border-radius:4px;border:1px solid #FDE68A;',
);
console.log(
  '%cMengubah nilai di DevTools tidak akan mempengaruhi harga sebenarnya.\n' +
  'Pembayaran diproses oleh Mayar.id sesuai paket yang dipilih saat tombol bayar diklik.\n' +
  'Tier dan harga divalidasi ulang di server — tidak bisa dimanipulasi dari browser.',
  'color:#374151;font-size:12px;line-height:1.7;',
);

const CARD_STYLE: React.CSSProperties = {
  background:     'rgba(255,255,255,0.88)',
  borderRadius:   24,
  boxShadow:      '0 18px 44px rgba(15,23,42,0.08)',
  padding:        '1.5rem',
  border:         '1px solid rgba(148,163,184,0.14)',
  backdropFilter: 'blur(14px)',
  marginBottom:   '1.25rem',
};

export default function Result() {
  const { data, cvKey, analyzeTime, loading, error, noSession } = useResultData();
  const countdown = useSessionCountdown(analyzeTime);

  // Pricing & payment state
  const [selectedTier,         setSelectedTier]         = useState<string | null>(null);
  const [email,                 setEmail]                 = useState('');
  const [emailError,            setEmailError]            = useState('');
  const [paymentInProgress,     setPaymentInProgress]     = useState(false);
  const [payBtnOverride,        setPayBtnOverride]        = useState<string | null>(null);
  const [paymentError,          setPaymentError]          = useState<string | null>(null);
  const [sessionExpiredByPay,   setSessionExpiredByPay]   = useState(false);
  const [showExpiryToast,       setShowExpiryToast]       = useState(false);

  const toastShownRef = useRef(false);

  // Pre-select tier from sessionStorage / localStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('gaslamar_tier') || localStorage.getItem('gaslamar_tier');
    if (saved && TIER_CONFIG[saved]) setSelectedTier(saved);
  }, []);

  // Show 5-minute expiry toast once
  useEffect(() => {
    if (countdown.isExpiringSoon && !toastShownRef.current) {
      toastShownRef.current = true;
      setShowExpiryToast(true);
      setTimeout(() => setShowExpiryToast(false), 30000);
    }
  }, [countdown.isExpiringSoon]);

  // ── Derived state ────────────────────────────────────────────────────────
  const emailValid = EMAIL_REGEX.test(email.trim());

  const payHint: string | null = !selectedTier
    ? 'Pilih paket di atas untuk melanjutkan'
    : !emailValid
    ? 'Masukkan email yang valid untuk melanjutkan'
    : null;

  const payBtnLabel = payBtnOverride
    ?? (selectedTier
      ? `Bayar Rp ${formatPrice(TIER_CONFIG[selectedTier].price)} — ${TIER_CONFIG[selectedTier].label} →`
      : '✨ Lihat CV hasil rewrite lengkap');

  const payBtnDisabled = !selectedTier || paymentInProgress || sessionExpiredByPay;

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleTierSelect(tier: string) {
    setSelectedTier(tier);
    setPaymentError(null);
    sessionStorage.setItem('gaslamar_tier', tier);
    setEmailError('');
    ;(window as any).Analytics?.track?.('tier_selected', {
      tier,
      tier_price_idr: TIER_CONFIG[tier].price,
      tier_label:     TIER_CONFIG[tier].label,
      is_bilingual:   TIER_CONFIG[tier].bilingual,
    });
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setEmailError('');
  }

  async function proceedToPayment() {
    if (!selectedTier || paymentInProgress) return;

    const cvTextKey = sessionStorage.getItem('gaslamar_cv_key');
    if (!cvTextKey) {
      alert('Data CV tidak ditemukan. Mohon upload CV kamu kembali.');
      window.location.href = 'upload.html';
      return;
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      setEmailError('Email wajib diisi — kami kirim link CV kamu ke sini');
      return;
    }
    setEmailError('');

    const capturedEmail = email.trim();
    try { sessionStorage.setItem('gaslamar_email', capturedEmail); } catch (_) {}

    ;(window as any).Analytics?.identify?.(capturedEmail, {
      tier:           selectedTier,
      tier_price_idr: TIER_CONFIG[selectedTier].price,
    });
    ;(window as any).Analytics?.track?.('payment_initiated', {
      tier:           selectedTier,
      tier_price_idr: TIER_CONFIG[selectedTier].price,
      time_ms_since_score: (() => {
        const t = sessionStorage.getItem('gaslamar_score_displayed_at');
        return t ? Date.now() - parseInt(t, 10) : undefined;
      })(),
    });

    setPaymentInProgress(true);
    setPaymentError(null);
    setPayBtnOverride('Membuat invoice...');

    // Cryptographically random session secret — binds subsequent requests to this browser
    const sessionSecret = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(`${WORKER_URL}/create-payment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tier:           selectedTier,
          cv_text_key:    cvTextKey,
          session_secret: sessionSecret,
          email:          capturedEmail,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const err    = await response.json().catch(() => ({}));
        const errMsg = (err as any).message || `Server error: ${response.status}`;
        if ((response.status === 400 && errMsg.includes('kedaluwarsa')) || response.status === 403) {
          setSessionExpiredByPay(true);
          setPayBtnOverride(null);
          setPaymentInProgress(false);
          return;
        }
        throw new Error(errMsg);
      }

      const { session_id, invoice_url } = await response.json();

      ;(window as any).Analytics?.track?.('payment_session_created', {
        tier:           selectedTier,
        tier_price_idr: TIER_CONFIG[selectedTier].price,
      });

      localStorage.setItem('gaslamar_session',                   session_id);
      localStorage.setItem(`gaslamar_secret_${session_id}`,     sessionSecret);
      sessionStorage.setItem('gaslamar_session',                  session_id);
      sessionStorage.removeItem('gaslamar_cv_key');

      // Validate invoice URL origin before redirecting
      let validUrl = false;
      try {
        const parsed = new URL(invoice_url);
        validUrl = parsed.protocol === 'https:' &&
          (parsed.hostname === 'mayar.id' || parsed.hostname.endsWith('.mayar.id') ||
           parsed.hostname === 'mayar.club' || parsed.hostname.endsWith('.mayar.club'));
      } catch (_) {}
      if (!validUrl) throw new Error('URL pembayaran tidak valid. Coba lagi.');

      setPayBtnOverride('Mengalihkan ke halaman pembayaran...');
      window.location.href = invoice_url;

    } catch (err) {
      clearTimeout(timeout);
      setPaymentInProgress(false);
      setPayBtnOverride(null);

      const e = err as Error;
      ;(window as any).Analytics?.trackError?.('payment_api', {
        tier:           selectedTier,
        is_timeout:     e.name === 'AbortError',
        error_message:  e.message,
      });

      const msg = e.name === 'AbortError'
        ? 'Koneksi timeout. Coba lagi.'
        : e.message || 'Terjadi kesalahan. Coba lagi.';
      setPaymentError(msg);
    }
  }

  // ── Countdown styles ─────────────────────────────────────────────────────
  const countdownStyle: React.CSSProperties =
    countdown.variant === 'expired'
      ? { background: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }
      : countdown.variant === 'warning'
      ? { background: '#FFFBEB', borderColor: '#FCD34D', color: '#92400E' }
      : {};

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen text-gray-900 font-sans"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.08), transparent)' }}
    >

      {/* 5-minute expiry toast */}
      {showExpiryToast && (
        <div role="alert" aria-live="assertive" className="fixed top-0 left-0 right-0 z-[9000] bg-red-600 text-white text-center text-sm font-semibold px-4 py-2.5">
          ⏳ Sesi analisis akan berakhir dalam 5 menit. Simpan hasil atau lanjutkan ke pembayaran.
        </div>
      )}

      {/* Skip link */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-[9999] focus:bg-slate-900 focus:text-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:rounded-br-lg">
        Langsung ke konten utama
      </a>

      {/* Navbar */}
      <nav
        className="border-b py-4 px-6 flex items-center sticky top-0 z-50 backdrop-blur-[14px]"
        style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(255,255,255,0.88)' }}
      >
        <a href="index.html" className="font-extrabold text-lg text-slate-900 no-underline tracking-tight">
          GasLamar
        </a>
      </nav>

      <main id="main-content" className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <h1 className="sr-only">Hasil Analisis CV</h1>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ ...CARD_STYLE, textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ width: 28, height: 28, border: '3px solid #BFDBFE', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'gasResultSpin 0.8s linear infinite', display: 'inline-block', marginBottom: '1rem' }} />
            <p style={{ fontWeight: 600, fontSize: '1.1rem', margin: '0 0 0.5rem', fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>Memuat hasil analisis…</p>
            <p style={{ color: '#94A3B8', fontSize: '0.82rem', margin: 0 }}>Sebentar lagi</p>
          </div>
        )}

        {/* ── No session ── */}
        {noSession && !loading && (
          <div style={{ ...CARD_STYLE, textAlign: 'center', padding: '2.5rem 1.5rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔍</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 0.5rem', fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>
              Sesi Analisis Tidak Ditemukan
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.85rem', margin: '0 0 1.5rem', lineHeight: 1.7 }}>
              {noSession === 'expired'
                ? <>⏰ Sesi analisis sudah berakhir (berlaku 2 jam).<br />Silakan upload ulang CV kamu untuk memulai analisis baru.</>
                : <>Sesi analisis tidak ditemukan atau sudah kadaluarsa.<br />Silakan upload CV kamu kembali untuk memulai analisis baru.</>}
            </p>
            <a href="upload.html" style={{ display: 'inline-block', background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: '#fff', fontWeight: 600, padding: '0.65rem 1.5rem', borderRadius: 60, textDecoration: 'none', fontSize: '0.88rem', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
              Upload CV Lagi →
            </a>
          </div>
        )}

        {/* ── Session expired by server validation ── */}
        {error && !loading && (
          <div style={{ ...CARD_STYLE, textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ fontWeight: 600, fontSize: '1.2rem', margin: '0 0 0.5rem', fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>Analisis Gagal</h2>
            <p style={{ color: '#64748B', fontSize: '0.85rem', margin: '0 0 1.5rem' }}>{error}</p>
            <a href="upload.html" style={{ display: 'inline-block', background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: 'white', fontWeight: 700, padding: '0.75rem 1.5rem', borderRadius: 60, textDecoration: 'none', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
              Coba Lagi
            </a>
          </div>
        )}

        {/* ── Main results ── */}
        {data && !loading && !error && (
          <>
            {/* Progress steps */}
            <header aria-label="Langkah analisis CV">
              <div style={{ ...CARD_STYLE, paddingBottom: '1.2rem', marginBottom: '1rem' }}>
                <UploadSteps currentStep={3} />
              </div>
            </header>

            {/* Session countdown */}
            {countdown.text && (
              <div style={{ textAlign: 'center', marginBottom: '1rem', fontSize: '0.78rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '0.5rem 1rem', ...countdownStyle }}>
                ⏳ {countdown.text}
              </div>
            )}

            {/* Score card */}
            <div style={CARD_STYLE}>
              <ScoreDisplay
                score={data.skor}
                archetype={data.archetype}
                gapCount={(data.gap || []).length}
              />
              {data.veredict && (
                <VerdictCard
                  verdict={data.veredict as 'DO' | 'DO NOT' | 'TIMED'}
                  timeboxWeeks={data.timebox_weeks}
                />
              )}
            </div>

            {/* Red flags */}
            <RedFlags redFlags={data.red_flags || []} />

            {/* Gap list */}
            <GapList gaps={data.gap || []} />

            {/* Recommendations */}
            <RecommendationList recommendations={data.rekomendasi || []} />

            {/* Micro-conversion line */}
            {(data.rekomendasi || []).length > 0 && (
              <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#065F46', margin: '0.25rem 0 0.75rem', fontWeight: 500 }}>
                ✨ Kamu sudah dekat — tinggal perbaiki ini sedikit lagi
              </p>
            )}

            {/* Before → After projection */}
            {data.skor_sesudah !== undefined && (
              <BeforeAfterProjection beforeScore={data.skor} afterScore={data.skor_sesudah} />
            )}

            {/* CV Rewrite preview */}
            <RewritePreview
              recommendations={data.rekomendasi || []}
              gaps={data.gap || []}
            />

            {/* Pricing CTA heading */}
            <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                👉 Perbaiki CV saya sekarang
              </h3>
            </div>
            <p style={{ textAlign: 'center', fontSize: '0.78rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '0.4rem 1rem', margin: '0 auto 0.75rem', maxWidth: 420 }}>
              ⏰ Preview analisis berlaku <strong>2 jam</strong> &nbsp;·&nbsp; 💳 Setelah bayar: download berlaku <strong>7 hari</strong> (Single/Coba) atau <strong>30 hari</strong> (3-Pack/Job Hunt)
            </p>

            {/* Pricing selector */}
            <PricingSelector
              selectedTier={selectedTier}
              onSelect={handleTierSelect}
              score={data.skor}
            />

            {/* Email capture */}
            <EmailCapture
              selectedTier={selectedTier}
              email={email}
              onChange={handleEmailChange}
              error={emailError}
            />

            {/* Session expired by payment error */}
            {sessionExpiredByPay && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: '#FFFBEB', border: '1px solid rgba(252,211,77,0.5)', borderRadius: 16, textAlign: 'center' }}>
                <p style={{ color: '#92400E', fontWeight: 600, fontSize: '0.88rem', margin: '0 0 0.5rem' }}>
                  Sesi analisis sudah kedaluwarsa (30 menit)
                </p>
                <p style={{ color: '#78350F', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
                  Upload ulang CV kamu untuk melanjutkan.
                </p>
                <a href="upload.html" style={{ display: 'inline-block', background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: 'white', fontWeight: 700, padding: '0.65rem 1.5rem', borderRadius: 60, textDecoration: 'none', fontSize: '0.88rem', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
                  Upload CV Lagi →
                </a>
              </div>
            )}

            {/* Pay button */}
            <div style={{ marginTop: '1rem' }}>
              <button
                onClick={proceedToPayment}
                disabled={payBtnDisabled}
                aria-label="Lihat CV hasil rewrite lengkap"
                style={{ background: payBtnDisabled ? '#CBD5E1' : 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: 'white', border: 'none', borderRadius: 60, padding: '0.9rem 1.5rem', fontWeight: 700, cursor: payBtnDisabled ? 'not-allowed' : 'pointer', width: '100%', transition: '0.2s', fontFamily: 'inherit', fontSize: '1rem', opacity: payBtnDisabled ? 0.6 : 1, boxShadow: payBtnDisabled ? 'none' : '0 8px 24px rgba(37,99,235,0.30)' }}
              >
                {payBtnLabel}
              </button>
              {payHint && !sessionExpiredByPay && (
                <p style={{ fontSize: '0.8rem', color: '#6B7280', textAlign: 'center', marginTop: '0.5rem' }}>
                  {payHint}
                </p>
              )}
              {paymentError && (
                <div role="alert" style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, color: '#B91C1C', fontSize: '0.875rem', textAlign: 'center' }}>
                  {paymentError}
                </div>
              )}
            </div>

            {/* Trust footer */}
            <p className="text-center text-xs text-slate-400 mt-5">
              💳 Pembayaran aman via Mayar &nbsp;·&nbsp; VA, QRIS, e-wallet &nbsp;·&nbsp; Tidak puas? Hubungi <a href="mailto:support@gaslamar.com" className="underline hover:text-slate-600">support@gaslamar.com</a>
            </p>

            {/* Back link */}
            <div className="text-center mt-4 mb-2">
              <a href="upload.html" className="text-sm text-slate-400 hover:text-slate-600 transition-colors no-underline">
                ← Upload CV lain
              </a>
            </div>

            {/* Detail analysis (collapsible) */}
            <DetailAnalysis
              strengths={data.kekuatan || []}
              hr7Data={data.hr_7_detik}
              dimensions={data.skor_6d}
            />

            {/* Legal footer */}
            <footer className="text-center py-6 text-xs text-slate-400">
              <a href="privacy.html" className="text-slate-400 no-underline hover:underline mx-2">Kebijakan Privasi</a>
              ·
              <a href="terms.html" className="text-slate-400 no-underline hover:underline mx-2">Syarat Layanan</a>
            </footer>
          </>
        )}
      </main>

      {/* Keyframe for loading spinner */}
      <style>{`@keyframes gasResultSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
