import { useState, useEffect, useRef }       from 'react';
import UploadSteps                             from '@/components/upload/UploadSteps';
import ScoreDisplay                            from '@/components/result/ScoreDisplay';
import VerdictCard                             from '@/components/result/VerdictCard';
import GapList                                 from '@/components/result/GapList';
import RecommendationList                      from '@/components/result/RecommendationList';
import BeforeAfterProjection                   from '@/components/result/BeforeAfterProjection';
import PricingSelector                         from '@/components/result/PricingSelector';
import EmailCapture                            from '@/components/result/EmailCapture';
import RewritePreview                          from '@/components/result/RewritePreview';
import DetailAnalysis                          from '@/components/result/DetailAnalysis';
import RedFlags                                from '@/components/result/RedFlags';
import ScoreBars                               from '@/components/6d/ScoreBars';
import PrimaryHighlight                        from '@/components/6d/PrimaryHighlight';
import DimRewritePreview                       from '@/components/6d/RewritePreview';
import { useResultData }                       from '@/hooks/useResultData';
import { useSessionCountdown }                 from '@/hooks/useSessionCountdown';
import { WORKER_URL, TIER_CONFIG, EMAIL_REGEX, formatPrice, buildResultData } from '@/lib/resultUtils';
import { validateEmail }                                                        from '@/utils/emailValidation';

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

function scoreLabel(score: number): string {
  if (score >= 75) return 'Cukup baik';
  if (score >= 60) return 'Perlu sedikit perbaikan';
  if (score >= 50) return 'Perlu diperbaiki';
  return 'Butuh perbaikan segera';
}

function scoreInterpretation(score: number): string {
  if (score >= 75) return 'CV kamu sudah cukup kuat, tapi masih ada celah yang bisa ditingkatkan sebelum melamar.';
  if (score >= 50) return 'Masih ada beberapa gap penting yang menahan peluang interview kamu.';
  return 'Ada beberapa isu kritis yang perlu segera diperbaiki agar CV kamu bisa bersaing.';
}

export default function Result() {
  const { data, cvKey, analyzeTime, loading, error, noSession } = useResultData();
  const countdown = useSessionCountdown(analyzeTime);
  // cv_pending is cleared during analysis; fall back to the persisted sample line
  const [cvText]  = useState(() =>
    sessionStorage.getItem('gaslamar_cv_pending') ||
    sessionStorage.getItem('gaslamar_sample_line') || '',
  );

  // Pricing & payment state
  const [selectedTier,         setSelectedTier]         = useState<string | null>(null);
  const [email,                 setEmail]                 = useState('');
  const [emailError,            setEmailError]            = useState('');
  const [emailSuggestion,       setEmailSuggestion]       = useState<string | null>(null);
  const [emailIsDisposable,     setEmailIsDisposable]     = useState(false);
  const [emailIsConfirmed,      setEmailIsConfirmed]      = useState(false);
  const [confirmEmail,          setConfirmEmail]          = useState('');
  const [confirmTouched,        setConfirmTouched]        = useState(false);
  const [confirmError,          setConfirmError]          = useState('');
  const [paymentInProgress,     setPaymentInProgress]     = useState(false);
  const [payBtnOverride,        setPayBtnOverride]        = useState<string | null>(null);
  const [paymentError,          setPaymentError]          = useState<string | null>(null);
  const [sessionExpiredByPay,   setSessionExpiredByPay]   = useState(false);
  const [showExpiryToast,       setShowExpiryToast]       = useState(false);
  const [showDetails,           setShowDetails]           = useState(false);
  const [showAllDimensions,     setShowAllDimensions]     = useState(false);

  const toastShownRef   = useRef(false);
  const blurTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmEmailRef = useRef<HTMLInputElement>(null);

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
  const emailValid  = EMAIL_REGEX.test(email.trim());
  const emailsMatch = email.trim().toLowerCase() === confirmEmail.trim().toLowerCase();

  const payHint: string | null = !selectedTier
    ? 'Pilih paket di atas untuk melanjutkan'
    : !!emailSuggestion
    ? 'Periksa email kamu sebelum lanjut'
    : !emailValid
    ? 'Masukkan email yang valid untuk melanjutkan'
    : confirmTouched && !emailsMatch
    ? 'Email konfirmasi tidak sama'
    : null;

  const payBtnLabel = payBtnOverride
    ?? (selectedTier
      ? 'Dapatkan CV siap kirim →'
      : '✨ Lihat CV hasil rewrite lengkap');

  const payBtnDisabled = !selectedTier || paymentInProgress || sessionExpiredByPay
    || !!emailSuggestion || !emailValid || (confirmTouched && !emailsMatch);

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
    setEmailSuggestion(null);
    setEmailIsDisposable(false);
    setEmailIsConfirmed(false);
    setConfirmError('');
  }

  function handleEmailPaste() {
    setTimeout(() => confirmEmailRef.current?.focus(), 0);
  }

  function handleConfirmEmailChange(value: string) {
    setConfirmEmail(value);
    if (confirmTouched) {
      const matches = email.trim().toLowerCase() === value.trim().toLowerCase();
      setConfirmError(matches ? '' : 'Email tidak sama. Periksa kembali');
    }
  }

  function handleConfirmEmailBlur() {
    setConfirmTouched(true);
    const matches = email.trim().toLowerCase() === confirmEmail.trim().toLowerCase();
    if (!matches) {
      setConfirmError('Email tidak sama. Periksa kembali');
      ;(window as any).Analytics?.track?.('email_mismatch_detected');
    } else {
      setConfirmError('');
      if (emailIsConfirmed) {
        ;(window as any).Analytics?.track?.('email_confirm_success');
      }
    }
  }

  function handleConfirmEmailPaste() {
    setConfirmTouched(true);
    setTimeout(() => {
      const el = confirmEmailRef.current;
      if (!el) return;
      const matches = email.trim().toLowerCase() === el.value.trim().toLowerCase();
      setConfirmEmail(el.value);
      setConfirmError(matches ? '' : 'Email tidak sama. Periksa kembali');
    }, 0);
  }

  function handleEmailBlur() {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      const result = validateEmail(email);
      setEmailError(result.error ?? '');
      setEmailSuggestion(result.suggestion);
      setEmailIsDisposable(result.isDisposable);
      setEmailIsConfirmed(result.valid && !result.suggestion);
      if (result.error) {
        ;(window as any).Analytics?.track?.('email_validation_failed', {
          reason: result.suggestion ? 'typo_domain' : 'invalid_format',
        });
      } else if (result.isDisposable) {
        ;(window as any).Analytics?.track?.('email_validation_failed', { reason: 'disposable' });
      } else if (result.valid) {
        ;(window as any).Analytics?.track?.('email_valid_confirmed');
      }
    }, 200);
  }

  function handleAcceptSuggestion() {
    if (!emailSuggestion) return;
    const accepted = emailSuggestion;
    setEmail(accepted);
    setEmailError('');
    setEmailSuggestion(null);
    setEmailIsDisposable(false);
    setEmailIsConfirmed(true);
    ;(window as any).Analytics?.track?.('email_typo_corrected', { corrected_email: accepted });
  }

  function handleToggleDetails() {
    setShowDetails(d => !d);
  }

  async function proceedToPayment() {
    if (!selectedTier || paymentInProgress) return;

    const cvTextKey = sessionStorage.getItem('gaslamar_cv_key');
    if (!cvTextKey) {
      alert('Data CV tidak ditemukan. Mohon upload CV kamu kembali.');
      window.location.href = 'upload.html';
      return;
    }

    const emailValidation = validateEmail(email);
    if (!emailValidation.valid || emailValidation.suggestion) {
      setEmailError(emailValidation.error ?? 'Email tidak valid.');
      setEmailSuggestion(emailValidation.suggestion);
      setEmailIsConfirmed(false);
      ;(window as any).Analytics?.track?.('email_validation_failed', {
        reason: emailValidation.suggestion ? 'typo_domain' : 'invalid_format',
      });
      return;
    }
    setEmailError('');
    setEmailSuggestion(null);

    if (confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setConfirmTouched(true);
      setConfirmError('Email tidak sama. Periksa kembali');
      confirmEmailRef.current?.focus();
      return;
    }

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

      localStorage.setItem('gaslamar_session',                 session_id);
      localStorage.setItem(`gaslamar_secret_${session_id}`, sessionSecret);
      sessionStorage.removeItem('gaslamar_cv_key');
      try {
        localStorage.setItem('gaslamar_delivery', JSON.stringify({
          sessionId: session_id,
          email:     capturedEmail,
          sentAt:    Date.now(),
        }));
      } catch (_) {}

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

  // 6D result data — computed once, reused across Sections 2, 3, 4
  const result6d = (data && data.skor_6d && Object.keys(data.skor_6d).length > 0)
    ? buildResultData({
        skor6d:       data.skor_6d!,
        cvText:       cvText || undefined,
        entitasKlaim: (() => {
          try {
            const raw = sessionStorage.getItem('gaslamar_entitas_klaim');
            return raw ? JSON.parse(raw) as string[] : undefined;
          } catch { return undefined; }
        })(),
      })
    : null;

  const isValidRewrite = !!(
    result6d?.rewritePreview?.after &&
    !result6d.rewritePreview.after.includes('[') &&
    result6d.rewritePreview.after.length > (result6d.rewritePreview.before?.length ?? 0)
  );

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
        <a href="index.html" className="font-extrabold text-lg text-slate-900 no-underline tracking-tight min-h-[44px] inline-flex items-center">
          GasLamar
        </a>
      </nav>

      <main id="main-content" className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
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
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.25rem', fontFamily: '"Plus Jakarta Sans","Inter",sans-serif', letterSpacing: '-0.02em', color: '#0F172A' }}>
              Hasil Analisis CV
            </h1>

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

            {/* ── BLOCK 1: RESULT ── */}
            <div style={{ marginBottom: '2.5rem' }}>
              <div
                style={{ ...CARD_STYLE, marginBottom: 0, borderRadius: showDetails ? '24px 24px 0 0' : 24 }}
                data-testid="result-score"
              >
                <ScoreDisplay
                  score={data.skor}
                  archetype={data.archetype}
                  gapCount={(data.gap || []).length}
                />
                <div style={{ textAlign: 'center', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(148,163,184,0.14)' }}>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#111827', marginBottom: '0.35rem' }}>
                    {scoreLabel(data.skor)}
                  </div>
                  <p style={{ fontSize: '0.88rem', color: '#64748B', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
                    {scoreInterpretation(data.skor)}
                  </p>
                  <button
                    onClick={handleToggleDetails}
                    style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 60, padding: '0.4rem 1.1rem', fontSize: '0.82rem', color: '#4B5563', cursor: 'pointer', marginTop: '0.85rem', fontFamily: 'inherit', transition: 'border-color 0.2s' }}
                  >
                    {showDetails ? 'Sembunyikan analisis ↑' : 'Lihat analisis lengkap ↓'}
                  </button>
                </div>
              </div>

              {/* Inline collapsible detail — expands below score card */}
              {showDetails && (
                <div style={{ background: '#F8FAFC', borderRadius: '0 0 24px 24px', border: '1px solid rgba(148,163,184,0.14)', borderTop: 'none', padding: '1.5rem' }}>
                  <div style={{ marginBottom: '1rem', fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>
                    Analisis lengkap
                  </div>
                  {data.veredict && (
                    <VerdictCard verdict={data.veredict as 'DO' | 'DO NOT' | 'TIMED'} timeboxWeeks={data.timebox_weeks} />
                  )}
                  <RedFlags redFlags={data.red_flags || []} />
                  <GapList gaps={data.gap || []} />
                  <RecommendationList recommendations={data.rekomendasi || []} />
                  {(data.rekomendasi || []).length > 0 && (
                    <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#065F46', margin: '0.25rem 0 0.75rem', fontWeight: 500 }}>
                      ✨ Kamu sudah dekat — tinggal perbaiki ini sedikit lagi
                    </p>
                  )}
                  {data.skor_sesudah !== undefined && (
                    <BeforeAfterProjection beforeScore={data.skor} afterScore={data.skor_sesudah} />
                  )}
                  <DetailAnalysis
                    strengths={data.kekuatan || []}
                    hr7Data={data.hr_7_detik}
                  />
                </div>
              )}
            </div>

            {/* ── BLOCK 2: PROBLEM + FIX ── */}
            {(result6d?.primaryIssue || (data.gap || []).length > 0 || isValidRewrite || (data.rekomendasi || []).length > 0) && (
              <div style={{ ...CARD_STYLE, marginBottom: '2.5rem', padding: '1.75rem' }}>
                {/* Problem */}
                {result6d?.primaryIssue ? (
                  <div data-testid="primary-problem">
                    <PrimaryHighlight issueKey={result6d.primaryIssue} />
                  </div>
                ) : (data.gap || []).length > 0 ? (
                  <div data-testid="primary-problem">
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.4rem' }}>
                      Masalah utama kamu
                    </p>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#111827', margin: '0 0 0.5rem', lineHeight: 1.4 }}>
                      {data.gap![0]}
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
                      Gap ini yang paling berpengaruh terhadap peluang kamu dipanggil interview — HR bisa langsung skip CV jika ini tidak terlihat.
                    </p>
                  </div>
                ) : null}

                {/* Divider */}
                {(isValidRewrite || (data.rekomendasi || []).length > 0) && (
                  <div style={{ borderTop: '1px solid rgba(148,163,184,0.14)', margin: '1.25rem 0' }} />
                )}

                {/* Fix */}
                {isValidRewrite ? (
                  <div data-testid="fix-before-after">
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.75rem' }}>
                      Contoh perbaikan CV kamu
                    </p>
                    <DimRewritePreview preview={result6d!.rewritePreview} />
                    <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.5rem', lineHeight: 1.55 }}>
                      💡 Contoh ini menggunakan baris dari CV kamu — rewrite lengkap mencakup semua bagian
                    </p>
                  </div>
                ) : (data.rekomendasi || []).length > 0 ? (
                  <div data-testid="fix-before-after">
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.75rem' }}>
                      Yang perlu diperbaiki:
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                      {(data.rekomendasi || []).slice(0, 3).map((r, i) => (
                        <li key={i} style={{ fontSize: '0.9rem', color: '#111827', display: 'flex', gap: '0.6rem', alignItems: 'flex-start', lineHeight: 1.5 }}>
                          <span style={{ color: '#2563EB', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>→</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                    <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.75rem', lineHeight: 1.55 }}>
                      💡 Rewrite lengkap mencakup semua bagian CV kamu (Experience, Skills, Summary)
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {/* ── BLOCK 3: PROOF ── */}
            {result6d && (
              <div style={{ ...CARD_STYLE, marginBottom: '2.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                    Ini yang paling dilihat HR dalam 7–10 detik
                  </p>
                  <p style={{ fontSize: '0.72rem', color: '#CBD5E1', margin: 0, flexShrink: 0, marginLeft: 8 }}>
                    AI vs JD kamu
                  </p>
                </div>
                <ScoreBars
                  dimensions={result6d.scores}
                  mode={showAllDimensions ? 'full' : 'preview'}
                  primaryKey={result6d.primaryIssue ?? undefined}
                />
                <button
                  onClick={() => setShowAllDimensions(d => !d)}
                  style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 500, padding: '0.75rem 0 0', display: 'block', fontFamily: 'inherit' }}
                >
                  {showAllDimensions ? 'Sembunyikan ↑' : 'Lihat semua dimensi →'}
                </button>
              </div>
            )}

            {/* ── BLOCK 4: CONVERSION ── */}
            <div style={{ marginBottom: '2.5rem' }}>
            {/* Paywall teaser */}
            <div style={{ ...CARD_STYLE, background: 'linear-gradient(135deg,#F8FAFC 0%,#EFF6FF 100%)', border: '1.5px solid #BFDBFE' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', margin: '0 0 0.85rem' }}>
                Apa yang kamu dapat setelah bayar:
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {[
                  'Perbaikan 8 bagian utama CV kamu (bukan template)',
                  'Rewrite langsung dari CV kamu dalam bahasa profesional & ATS-friendly',
                  'Siap kirim dalam format ID & EN',
                ].map((b, i) => (
                  <li key={i} style={{ fontSize: '0.9rem', color: '#111827', display: 'flex', gap: '0.6rem', alignItems: 'flex-start', lineHeight: 1.5 }}>
                    <span style={{ color: '#059669', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✔</span>
                    {b}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => document.getElementById('pricing-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: 'white', border: 'none', borderRadius: 60, padding: '0.9rem 1.5rem', fontWeight: 700, cursor: 'pointer', width: '100%', fontSize: '1rem', fontFamily: 'inherit', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}
              >
                Lihat semua perbaikan &amp; CV rewrite →
              </button>
            </div>

            {/* Personalized rewrite preview — paywall teaser with first recommendation */}
            <RewritePreview
              recommendations={data.rekomendasi || []}
              gaps={data.gap || []}
            />

            {/* Pricing */}
            <div id="pricing-section" style={{ scrollMarginTop: 80 }}>
              <PricingSelector
                selectedTier={selectedTier}
                onSelect={handleTierSelect}
                score={data.skor}
              />

              <EmailCapture
                selectedTier={selectedTier}
                email={email}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
                onPaste={handleEmailPaste}
                error={emailError}
                suggestion={emailSuggestion}
                onAcceptSuggestion={handleAcceptSuggestion}
                isDisposable={emailIsDisposable}
                isConfirmed={emailIsConfirmed}
                confirmEmail={confirmEmail}
                onConfirmChange={handleConfirmEmailChange}
                onConfirmBlur={handleConfirmEmailBlur}
                onConfirmPaste={handleConfirmEmailPaste}
                confirmError={confirmError}
                confirmRef={confirmEmailRef}
                emailsMatch={emailsMatch}
                confirmTouched={confirmTouched}
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

              {/* Loss aversion microcopy */}
              <p style={{ fontSize: '0.75rem', color: '#64748B', fontStyle: 'italic', textAlign: 'center', margin: '0.75rem 0 0.5rem' }}>
                Tanpa perbaikan ini, CV kamu berisiko di-skip dalam 7 detik pertama.
              </p>

              {/* Pay button */}
              <div style={{ marginTop: '0' }}>
                <button
                  data-testid="generate-cv-button"
                  onClick={proceedToPayment}
                  disabled={payBtnDisabled}
                  aria-label="Lihat CV hasil rewrite lengkap"
                  style={{ background: payBtnDisabled ? '#CBD5E1' : 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: 'white', border: 'none', borderRadius: 60, padding: '0.9rem 1.5rem', fontWeight: 700, cursor: payBtnDisabled ? 'not-allowed' : 'pointer', width: '100%', transition: '0.2s', fontFamily: 'inherit', fontSize: '1rem', opacity: payBtnDisabled ? 0.6 : 1, boxShadow: payBtnDisabled ? 'none' : '0 8px 24px rgba(37,99,235,0.30)' }}
                >
                  {payBtnLabel}
                </button>
                {emailIsConfirmed && !payHint && !sessionExpiredByPay && (
                  <p style={{ fontSize: '0.8rem', color: '#374151', textAlign: 'center', marginTop: '0.5rem' }}>
                    📬 CV akan dikirim ke: <strong>{email.trim()}</strong>
                  </p>
                )}
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
            </div>
            </div>{/* end BLOCK 4 */}

            {/* ── TRUST ── */}
            <div style={{ textAlign: 'center', padding: '1rem 0 0.5rem', fontSize: '0.8rem', color: '#94A3B8', lineHeight: 1.7 }}>
              🔒 7-hari refund jika tidak puas &nbsp;·&nbsp; Data kamu aman &nbsp;·&nbsp; Bayar via QRIS, VA, e-wallet
            </div>

            {/* Back link */}
            <div className="text-center mt-4 mb-2">
              <a href="upload.html" className="text-sm text-slate-400 hover:text-slate-600 transition-colors no-underline">
                ← Upload CV lain
              </a>
            </div>

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
