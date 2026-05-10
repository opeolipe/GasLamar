import { useState, useEffect, useRef }       from 'react';
import UploadSteps                             from '@/components/upload/UploadSteps';
import ScoreDisplay                            from '@/components/result/ScoreDisplay';
import GapList                                 from '@/components/result/GapList';
import RecommendationList                      from '@/components/result/RecommendationList';
import BeforeAfterProjection                   from '@/components/result/BeforeAfterProjection';
import PricingSelector                         from '@/components/result/PricingSelector';
import EmailCapture                            from '@/components/result/EmailCapture';
import DetailAnalysis                          from '@/components/result/DetailAnalysis';
import RedFlags                                from '@/components/result/RedFlags';
import InfoStrip                               from '@/components/result/InfoStrip';
import ScoreBars                               from '@/components/6d/ScoreBars';
import PrimaryHighlight                        from '@/components/6d/PrimaryHighlight';
import DimRewritePreview                       from '@/components/6d/RewritePreview';
import { useResultData }                       from '@/hooks/useResultData';
import { useSessionCountdown }                 from '@/hooks/useSessionCountdown';
import {
  WORKER_URL, TIER_CONFIG, EMAIL_REGEX, buildResultData, DIM_LABELS,
} from '@/lib/resultUtils';
import { validateEmail }   from '@/utils/emailValidation';
import { suggestEmailFix } from '@/utils/emailTypo';


console.log(
  '%c⚠️ GasLamar — Perhatian',
  'color:#92400E;background:#FFFBEB;font-size:14px;font-weight:700;padding:4px 10px;border-radius:4px;border:1px solid #FDE68A;',
);
console.log(
  '%cMengubah nilai di DevTools tidak akan mempengaruhi harga sebenarnya.\n' +
  'Pembayaran diproses oleh Mayar.id sesuai paket yang dipilih saat tombol bayar diklik.\n' +
  'Tier dan harga divalidasi ulang di server — tidak bisa dimanipulasi dari browser.',
  'color:#374151;font-size:14px;line-height:1.7;',
);

const ROLE_LABELS: Record<string, string> = {
  customer_service: 'Customer Service',
  data:             'Data & Analytics',
  marketing:        'Marketing',
  operations:       'Operasional/Logistik',
  finance:          'Finance/Akuntansi',
  engineering:      'IT/Software Engineering',
  sales:            'Sales/Business Development',
  hr:               'HRD/People Operations',
  admin:            'Administrasi/GA',
};

const CARD_STYLE: React.CSSProperties = {
  background:     'rgba(255,255,255,0.88)',
  borderRadius:   24,
  boxShadow:      '0 18px 44px rgba(15,23,42,0.08)',
  padding:        '1.5rem',
  border:         '1px solid rgba(148,163,184,0.14)',
  backdropFilter: 'blur(14px)',
  marginBottom:   '1.25rem',
};

const TABS = [
  { key: 'hasil',     label: 'Hasil',     subtitle: 'Skor & kondisi sekarang' },
  { key: 'gap',       label: 'Gap',       subtitle: 'Kenapa HR masih ragu' },
  { key: 'perbaikan', label: 'Perbaikan', subtitle: 'Yang harus diubah' },
] as const;

type ActiveTab = typeof TABS[number]['key'];

function scoreHeadline(score: number): string {
  if (score >= 75) return 'CV kamu sudah cukup kompetitif';
  if (score >= 60) return 'Peluang interview bisa lebih kuat';
  if (score >= 50) return 'Peluang interview perlu diperkuat';
  return 'Peluang interview masih rendah';
}

function verdictDesc(verdict: string | undefined, score: number): string {
  if (verdict === 'DO') return 'CV kamu sudah cukup kuat untuk dilamar sekarang — beberapa perbaikan kecil bisa mendorong peluang lebih tinggi.';
  if (verdict === 'DO NOT') return 'CV ini perlu perbaikan signifikan sebelum peluangnya lebih kompetitif di posisi ini.';
  if (score < 50) return 'Masih ada beberapa gap yang bikin HR ragu. Kalau diperbaiki, peluang kamu bisa jauh lebih kuat.';
  return 'CV kamu sudah di jalur yang benar — perbaiki beberapa gap untuk makin memperkuat peluang.';
}

export default function Result() {
  const { data, cvKey, analyzeTime, loading, error, noSession } = useResultData();
  const countdown = useSessionCountdown(analyzeTime);
  const [cvText]  = useState(() =>
    sessionStorage.getItem('gaslamar_cv_pending') ||
    sessionStorage.getItem('gaslamar_sample_line') || '',
  );

  const [activeTab,             setActiveTab]             = useState<ActiveTab>('hasil');
  const [showAllDimensions,     setShowAllDimensions]     = useState(false);
  const [showGapDetail,         setShowGapDetail]         = useState(false);
  const [showMorePerbaikan,     setShowMorePerbaikan]     = useState(false);
  const [selectedTier,          setSelectedTier]          = useState<string | null>(null);
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

  const toastShownRef   = useRef(false);
  const blurTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmEmailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem('gaslamar_tier') || localStorage.getItem('gaslamar_tier');
    if (saved && TIER_CONFIG[saved]) setSelectedTier(saved);
  }, []);

  useEffect(() => {
    if (!noSession) return;
    if (noSession === 'expired') { window.location.replace('access.html?expired=1'); return; }
    window.location.replace('upload.html?reason=no_session');
  }, [noSession]);

  useEffect(() => {
    if (countdown.isExpiringSoon && !toastShownRef.current) {
      toastShownRef.current = true;
      setShowExpiryToast(true);
      setTimeout(() => setShowExpiryToast(false), 30000);
    }
  }, [countdown.isExpiringSoon]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const emailValid  = EMAIL_REGEX.test(email.trim());
  const emailsMatch = email.trim().toLowerCase() === confirmEmail.trim().toLowerCase();

  const payHint: string | null = !selectedTier
    ? 'Pilih paket di atas untuk melanjutkan'
    : !!emailSuggestion
    ? 'Periksa email kamu sebelum lanjut'
    : !emailValid
    ? 'Masukkan email yang valid untuk melanjutkan'
    : !confirmEmail.trim()
    ? 'Ketik ulang email kamu untuk melanjutkan'
    : !emailsMatch
    ? 'Email konfirmasi tidak sama'
    : null;

  const tierPrice = selectedTier ? (TIER_CONFIG[selectedTier]?.price ?? null) : null;

  const payBtnLabel = payBtnOverride
    ?? (selectedTier && tierPrice !== null
      ? `Bayar Rp ${tierPrice.toLocaleString('id-ID')} →`
      : '✨ Lihat CV hasil rewrite lengkap');

  const payBtnDisabled = !selectedTier || paymentInProgress || sessionExpiredByPay
    || !!emailSuggestion || !emailValid || !confirmEmail.trim() || !emailsMatch;

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleTierSelect(tier: string) {
    setSelectedTier(tier);
    setPaymentError(null);
    sessionStorage.setItem('gaslamar_tier', tier);
    setEmailError('');
    ;(window as any).Analytics?.track?.('tier_selected', { tier, tier_price_idr: TIER_CONFIG[tier].price, tier_label: TIER_CONFIG[tier].label, is_bilingual: TIER_CONFIG[tier].bilingual });
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setEmailError('');
    setEmailSuggestion(suggestEmailFix(value));
    setEmailIsDisposable(false);
    setEmailIsConfirmed(false);
    setConfirmError('');
  }

  function handleEmailPaste(pastedValue: string) {
    const trimmed = pastedValue.trim();
    if (!trimmed) return;
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setEmail(trimmed);
    setEmailError('');
    setEmailSuggestion(suggestEmailFix(trimmed));
    setEmailIsDisposable(false);
    setEmailIsConfirmed(false);
    setConfirmError('');
    setTimeout(() => {
      const result = validateEmail(trimmed);
      setEmailError(result.error ?? '');
      setEmailSuggestion(result.suggestion);
      setEmailIsDisposable(result.isDisposable);
      setEmailIsConfirmed(result.valid && !result.suggestion);
      if (result.valid && !result.suggestion) {
        setTimeout(() => {
          confirmEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          confirmEmailRef.current?.focus();
        }, 50);
      }
    }, 50);
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
      if (emailIsConfirmed) { (window as any).Analytics?.track?.('email_confirm_success'); }
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
        ;(window as any).Analytics?.track?.('email_validation_failed', { reason: result.suggestion ? 'typo_domain' : 'invalid_format' });
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

  async function proceedToPayment() {
    if (!selectedTier || paymentInProgress) return;

    const currentCvKey = sessionStorage.getItem('gaslamar_cv_key');
    const pendingRaw = sessionStorage.getItem('gaslamar_pending_invoice');
    if (pendingRaw) {
      try {
        const pending = JSON.parse(pendingRaw) as {
          invoice_url: string;
          created_at:  number;
          tier?:       string;
          cv_key?:     string;
        };
        const notExpired  = (Date.now() - (pending.created_at || 0)) < 7200000;
        const tierMatches = !pending.tier || pending.tier === selectedTier;
        const noNewUpload = !currentCvKey || !pending.cv_key || pending.cv_key === currentCvKey;

        if (pending.invoice_url && notExpired) {
          if (tierMatches && noNewUpload) {
            let urlSafe = false;
            try { urlSafe = new URL(pending.invoice_url).protocol === 'https:'; } catch (_) {}
            if (!urlSafe) throw new Error('invalid_invoice_url');
            setPayBtnOverride('Mengalihkan ke halaman pembayaran...');
            window.location.href = pending.invoice_url;
            return;
          }
          if (!tierMatches && !currentCvKey) {
            const origLabel = (pending.tier && TIER_CONFIG[pending.tier])
              ? TIER_CONFIG[pending.tier].label
              : 'paket sebelumnya';
            setPaymentError(
              `Invoice sudah dibuat untuk "${origLabel}". Pilih paket itu untuk melanjutkan, ` +
              `atau klik "Upload CV lain" di bawah untuk memilih paket lain.`
            );
            setPaymentInProgress(false);
            setPayBtnOverride(null);
            return;
          }
        }
      } catch (_) {}
      sessionStorage.removeItem('gaslamar_pending_invoice');
    }

    const cvTextKey = sessionStorage.getItem('gaslamar_cv_key');
    if (!cvTextKey) {
      setPaymentError('Data CV tidak ditemukan. Silakan upload CV kamu kembali.');
      return;
    }

    const emailValidation = validateEmail(email);
    if (!emailValidation.valid || emailValidation.suggestion) {
      setEmailError(emailValidation.error ?? 'Email tidak valid.');
      setEmailSuggestion(emailValidation.suggestion);
      setEmailIsConfirmed(false);
      ;(window as any).Analytics?.track?.('email_validation_failed', { reason: emailValidation.suggestion ? 'typo_domain' : 'invalid_format' });
      document.getElementById('email-capture')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setEmailError('');
    setEmailSuggestion(null);

    if (confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setConfirmTouched(true);
      setConfirmError('Email tidak sama. Periksa kembali');
      confirmEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      confirmEmailRef.current?.focus();
      return;
    }

    const capturedEmail = email.trim();
    try { sessionStorage.setItem('gaslamar_email', capturedEmail); } catch (_) {}

    ;(window as any).Analytics?.identify?.(capturedEmail, { tier: selectedTier, tier_price_idr: TIER_CONFIG[selectedTier].price });
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

    const sessionSecret = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(`${WORKER_URL}/create-payment`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
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

      ;(window as any).Analytics?.track?.('payment_session_created', { tier: selectedTier, tier_price_idr: TIER_CONFIG[selectedTier].price });

      sessionStorage.setItem('gaslamar_session', session_id);
      sessionStorage.setItem(`gaslamar_secret_${session_id}`, sessionSecret);
      try {
        localStorage.setItem('gaslamar_session', session_id);
        localStorage.setItem(`gaslamar_secret_${session_id}`, sessionSecret);
      } catch (_) {}
      try {
        localStorage.setItem('gaslamar_delivery', JSON.stringify({ sessionId: session_id, email: capturedEmail, sentAt: Date.now() }));
      } catch (_) {}

      let validUrl = false;
      try { const parsed = new URL(invoice_url); validUrl = parsed.protocol === 'https:'; } catch (_) {}
      if (!validUrl) throw new Error('URL pembayaran tidak valid. Coba lagi.');

      try {
        sessionStorage.setItem('gaslamar_pending_invoice', JSON.stringify({
          invoice_url,
          created_at: Date.now(),
          tier:   selectedTier,
          cv_key: cvTextKey,
        }));
      } catch (_) {}

      sessionStorage.removeItem('gaslamar_cv_key');
      setPayBtnOverride('Mengalihkan ke halaman pembayaran...');
      window.location.href = invoice_url;

    } catch (err) {
      clearTimeout(timeout);
      setPaymentInProgress(false);
      setPayBtnOverride(null);

      const e = err as Error;
      ;(window as any).Analytics?.trackError?.('payment_api', { tier: selectedTier, is_timeout: e.name === 'AbortError', error_message: e.message });

      const msg = e.name === 'AbortError' ? 'Koneksi timeout. Coba lagi.' : e.message || 'Terjadi kesalahan. Coba lagi.';
      setPaymentError(msg);
    }
  }

  const result6d = (data && data.skor_6d && Object.keys(data.skor_6d).length > 0)
    ? buildResultData({
        skor6d:       data.skor_6d!,
        cvText:       cvText || undefined,
        entitasKlaim: (() => {
          try { const raw = sessionStorage.getItem('gaslamar_entitas_klaim'); return raw ? JSON.parse(raw) as string[] : undefined; }
          catch { return undefined; }
        })(),
      })
    : null;

  const isValidRewrite = !!(
    result6d?.rewritePreview?.after &&
    !result6d.rewritePreview.after.includes('[') &&
    result6d.rewritePreview.after.length > (result6d.rewritePreview.before?.length ?? 0)
  );

  // ── Countdown strip type ──────────────────────────────────────────────────
  const stripType: 'expired' | 'warning' | 'info' =
    countdown.variant === 'expired' ? 'expired' :
    countdown.variant === 'warning' ? 'warning' : 'info';

  // ── InfoStrip content ─────────────────────────────────────────────────────
  const stripText: React.ReactNode | null = (() => {
    const parts: string[] = [];
    if (countdown.text) parts.push(countdown.text);
    if (data?.inferred_role) {
      const roleLabel     = ROLE_LABELS[data.inferred_role] ?? data.inferred_role;
      const industryLabel = data.inferred_industry && data.inferred_industry !== 'General'
        ? ` (${data.inferred_industry})` : '';
      const confidence    = data.inferred_confidence ?? 0;
      parts.push(
        confidence >= 0.6
          ? `CV dinilai sebagai ${roleLabel}${industryLabel}`
          : 'Analisis berdasarkan pengalaman di CV kamu',
      );
    }
    return parts.length > 0 ? parts.join(' • ') : null;
  })();

  // ── Top 2 weakest dimensions for Hasil tab ────────────────────────────────
  const priorityWeaknesses = result6d
    ? Object.entries(DIM_LABELS)
        .map(([key, meta]) => ({
          key,
          label: meta.label,
          hint:  meta.hint,
          score: Math.min(10, Math.max(0, Math.round(result6d.scores[key] ?? 0))),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 2)
    : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen text-gray-900 font-sans"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.08), transparent)' }}
    >
      {/* 5-minute expiry toast */}
      {showExpiryToast && (
        <div role="alert" aria-live="assertive" className="fixed top-0 left-0 right-0 z-[9000] bg-red-600 text-white text-center text-sm font-semibold px-4 py-2.5">
          ⏳ Sesi analisis akan berakhir dalam 5 menit. Lanjutkan ke pembayaran.
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
        <a href="index.html" className="no-underline min-h-[44px] inline-flex items-center">
          <img src="assets/logo.svg" alt="GasLamar" height="28" style={{ display: 'block' }} />
        </a>
      </nav>

      <main id="main-content" className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-20">

        {/* ── Loading ── */}
        {loading && (
          <div style={{ ...CARD_STYLE, textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ width: 28, height: 28, border: '3px solid #BFDBFE', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'gasResultSpin 0.8s linear infinite', display: 'inline-block', marginBottom: '1rem' }} />
            <p style={{ fontWeight: 600, fontSize: '1.1rem', margin: '0 0 0.5rem', fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>Memuat hasil analisis…</p>
            <p style={{ color: '#94A3B8', fontSize: '0.875rem', margin: 0 }}>Sebentar lagi</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <div style={{ ...CARD_STYLE, textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ fontWeight: 600, fontSize: '1.2rem', margin: '0 0 0.5rem', fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>Analisis Gagal</h2>
            <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>{error}</p>
            <a href="upload.html" style={{ display: 'inline-block', background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: 'white', fontWeight: 700, padding: '0.75rem 1.5rem', borderRadius: 60, textDecoration: 'none', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
              Coba Lagi
            </a>
          </div>
        )}

        {/* ── Main results ── */}
        {data && !loading && !error && (
          <>
            {/* Progress steps */}
            <header aria-label="Langkah analisis CV" style={{ marginBottom: '1rem' }}>
              <div style={{ ...CARD_STYLE, marginBottom: 0, padding: '1.25rem 1.5rem' }}>
                <UploadSteps currentStep={3} />
              </div>
            </header>

            {/* Single status strip */}
            {stripText && (
              <InfoStrip type={stripType}>
                {stripText}
              </InfoStrip>
            )}

            {/* ── HERO CARD ── */}
            <div style={CARD_STYLE} data-testid="result-score">
              {/* Score ring */}
              <ScoreDisplay score={data.skor} />

              {/* Score context: headline + natural verdict prose */}
              <div style={{ textAlign: 'center', marginTop: '0.15rem', marginBottom: '0.85rem' }}>
                <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827', margin: '0 0 0.4rem', lineHeight: 1.4 }}>
                  {scoreHeadline(data.skor)}
                </p>
                <p style={{ fontSize: '0.83rem', color: '#64748B', margin: 0, lineHeight: 1.6, padding: '0 0.25rem' }}>
                  {verdictDesc(data.veredict, data.skor)}
                </p>
              </div>

              {/* Upgrade projection — focus only on the improvement, not the repeat */}
              {data.skor_sesudah !== undefined && (
                <div style={{
                  background:   'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(16,185,129,0.05) 100%)',
                  border:       '1px solid rgba(34,197,94,0.25)',
                  borderRadius: 14,
                  padding:      '0.9rem 1rem',
                  marginBottom: '1rem',
                  textAlign:    'center',
                }}>
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.3rem' }}>
                    Potensi setelah diperbaiki
                  </p>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 3 }}>
                    <span style={{ fontSize: '2.4rem', fontWeight: 800, color: '#15803D', lineHeight: 1 }}>{data.skor_sesudah}</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#16A34A' }}>%</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#16A34A', margin: '0.2rem 0 0', fontWeight: 500 }}>
                    estimasi jika gap utama diperbaiki
                  </p>
                </div>
              )}

              {/* Primary CTA */}
              <a
                href="#pricing-section"
                style={{
                  display:        'block',
                  background:     'linear-gradient(180deg,#3b82f6,#1d4ed8)',
                  color:          'white',
                  fontWeight:     700,
                  fontSize:       '0.95rem',
                  padding:        '0.8rem 1.75rem',
                  borderRadius:   60,
                  textDecoration: 'none',
                  boxShadow:      '0 6px 20px rgba(37,99,235,0.28)',
                  textAlign:      'center',
                }}
              >
                Lihat cara memperbaikinya →
              </a>
            </div>

            {/* ── TAB BAR ── */}
            <div style={{
              display:      'flex',
              gap:          4,
              marginBottom: '0',
              background:   '#F1F5F9',
              borderRadius: '20px 20px 0 0',
              padding:      4,
            }}>
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    flex:        1,
                    padding:     '0.6rem 0.4rem',
                    border:      'none',
                    borderRadius: 16,
                    cursor:      'pointer',
                    fontFamily:  'inherit',
                    background:  activeTab === tab.key ? 'white' : 'transparent',
                    boxShadow:   activeTab === tab.key ? '0 1px 4px rgba(0,0,0,0.09)' : 'none',
                    transition:  'all 0.18s',
                    minHeight:   44,
                  }}
                  aria-selected={activeTab === tab.key}
                >
                  <div style={{
                    fontSize:   '0.875rem',
                    fontWeight: 700,
                    color:      activeTab === tab.key ? '#1B4FE8' : '#64748B',
                    lineHeight: 1.2,
                  }}>
                    {tab.label}
                  </div>
                  <div style={{
                    fontSize:   '0.62rem',
                    color:      activeTab === tab.key ? '#64748B' : '#94A3B8',
                    marginTop:  2,
                    lineHeight: 1.3,
                    fontWeight: 500,
                  }}>
                    {tab.subtitle}
                  </div>
                </button>
              ))}
            </div>

            {/* ── TAB CONTENT ── */}
            <div style={{
              ...CARD_STYLE,
              borderRadius:  '0 0 24px 24px',
              marginBottom:  '2rem',
            }}>

              {/* ── HASIL TAB ── */}
              {activeTab === 'hasil' && (
                <>
                  {/* Priority weaknesses */}
                  {priorityWeaknesses.length > 0 ? (
                    <>
                      <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.75rem' }}>
                        Prioritas utama
                      </p>
                      {priorityWeaknesses.map(dim => (
                        <div key={dim.key} style={{
                          padding:      '0.85rem 1rem',
                          background:   dim.score < 4 ? '#FFF7F7' : '#FFFBEB',
                          border:       `1px solid ${dim.score < 4 ? '#FECACA' : '#FDE68A'}`,
                          borderRadius: 12,
                          marginBottom: '0.65rem',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#111827' }}>
                              {dim.score < 4 ? '❌' : '⚠️'} {dim.label}
                            </span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: dim.score < 4 ? '#DC2626' : '#92400E', flexShrink: 0, marginLeft: 8 }}>
                              {dim.score}/10
                            </span>
                          </div>
                          <div style={{ background: dim.score < 4 ? '#FEE2E2' : '#FEF3C7', borderRadius: 3, height: 4, marginBottom: 8 }}>
                            <div style={{
                              width:        `${dim.score * 10}%`,
                              background:   dim.score < 4 ? '#F87171' : '#F59E0B',
                              borderRadius: 3,
                              height:       4,
                              transition:   'width 0.7s cubic-bezier(0.22,1,0.36,1)',
                            }} />
                          </div>
                          <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0, lineHeight: 1.55 }}>
                            {dim.hint}
                          </p>
                        </div>
                      ))}
                    </>
                  ) : (data.gap || []).length > 0 && (
                    <GapList gaps={(data.gap || []).slice(0, 2)} />
                  )}

                  {/* Accordion: all dimensions */}
                  {result6d && (
                    <>
                      <button
                        onClick={() => setShowAllDimensions(d => !d)}
                        style={{
                          width:          '100%',
                          background:     '#F8FAFC',
                          border:         '1px solid #E2E8F0',
                          borderRadius:   10,
                          padding:        '0.65rem 1rem',
                          fontSize:       '0.83rem',
                          fontWeight:     600,
                          color:          '#1B4FE8',
                          cursor:         'pointer',
                          fontFamily:     'inherit',
                          minHeight:      44,
                          display:        'flex',
                          alignItems:     'center',
                          justifyContent: 'center',
                          gap:            6,
                          marginTop:      '0.5rem',
                          transition:     'background 0.15s',
                        }}
                      >
                        {showAllDimensions ? 'Sembunyikan ↑' : 'Lihat semua dimensi →'}
                      </button>
                      {showAllDimensions && (
                        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.14)' }}>
                          <ScoreBars
                            dimensions={result6d.scores}
                            mode="full"
                            primaryKey={result6d.primaryIssue ?? undefined}
                          />
                          <div style={{ marginTop: '1rem' }}>
                            <DetailAnalysis
                              strengths={data.kekuatan || []}
                              hr7Data={data.hr_7_detik}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── GAP TAB ── */}
              {activeTab === 'gap' && (
                <>
                  {/* Primary issue */}
                  {result6d?.primaryIssue ? (
                    <div data-testid="primary-problem">
                      <PrimaryHighlight issueKey={result6d.primaryIssue} />
                    </div>
                  ) : (data.gap || []).length > 0 && (
                    <div data-testid="primary-problem" style={{ marginBottom: '1rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', margin: '0 0 0.4rem', lineHeight: 1.4 }}>
                        {data.gap![0]}
                      </h3>
                      <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
                        Gap ini yang paling berpengaruh terhadap peluang kamu dipanggil interview — HR bisa langsung skip CV jika ini tidak terlihat.
                      </p>
                    </div>
                  )}

                  {/* Top gaps */}
                  {(data.gap || []).length > 0 && (
                    <GapList gaps={data.gap || []} />
                  )}

                  {/* Accordion: more detail */}
                  {((data.red_flags || []).length > 0 || (data.rekomendasi || []).length > 0) && (
                    <>
                      <button
                        onClick={() => setShowGapDetail(d => !d)}
                        style={{
                          width:          '100%',
                          background:     '#F8FAFC',
                          border:         '1px solid #E2E8F0',
                          borderRadius:   10,
                          padding:        '0.65rem 1rem',
                          fontSize:       '0.83rem',
                          fontWeight:     600,
                          color:          '#1B4FE8',
                          cursor:         'pointer',
                          fontFamily:     'inherit',
                          minHeight:      44,
                          display:        'flex',
                          alignItems:     'center',
                          justifyContent: 'center',
                          gap:            6,
                          marginTop:      '0.5rem',
                          transition:     'background 0.15s',
                        }}
                      >
                        {showGapDetail ? 'Sembunyikan ↑' : 'Lihat detail recruiter →'}
                      </button>
                      {showGapDetail && (
                        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.14)' }}>
                          <RedFlags redFlags={data.red_flags || []} />
                          {(data.rekomendasi || []).length > 0 && (
                            <div>
                              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.6rem' }}>
                                Yang perlu diperbaiki:
                              </p>
                              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                {(data.rekomendasi || []).slice(0, 3).map((r, i) => (
                                  <li key={i} style={{ fontSize: '0.875rem', color: '#111827', display: 'flex', gap: '0.6rem', alignItems: 'flex-start', lineHeight: 1.5 }}>
                                    <span style={{ color: '#2563EB', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>→</span>
                                    {r}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── PERBAIKAN TAB ── */}
              {activeTab === 'perbaikan' && (
                <>
                  {/* Rewrite preview — the star */}
                  {isValidRewrite ? (
                    <div data-testid="fix-before-after">
                      <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.75rem' }}>
                        Contoh perbaikan dari CV kamu
                      </p>
                      <DimRewritePreview preview={result6d!.rewritePreview} />
                      <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '-0.25rem', marginBottom: '0.75rem', lineHeight: 1.55 }}>
                        Contoh ini diambil langsung dari CV kamu — rewrite lengkap mencakup semua bagian.
                      </p>
                    </div>
                  ) : (data.rekomendasi || []).length > 0 && (
                    <div data-testid="fix-before-after">
                      <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.6rem' }}>
                        Yang perlu diperbaiki:
                      </p>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.75rem' }}>
                        {(data.rekomendasi || []).slice(0, 2).map((r, i) => (
                          <li key={i} style={{ fontSize: '0.875rem', color: '#111827', display: 'flex', gap: '0.6rem', alignItems: 'flex-start', lineHeight: 1.5 }}>
                            <span style={{ color: '#2563EB', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>→</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Accordion: all fixes */}
                  {(data.rekomendasi || []).length > 0 && (
                    <>
                      <button
                        onClick={() => setShowMorePerbaikan(d => !d)}
                        style={{
                          width:          '100%',
                          background:     '#F8FAFC',
                          border:         '1px solid #E2E8F0',
                          borderRadius:   10,
                          padding:        '0.65rem 1rem',
                          fontSize:       '0.83rem',
                          fontWeight:     600,
                          color:          '#1B4FE8',
                          cursor:         'pointer',
                          fontFamily:     'inherit',
                          minHeight:      44,
                          display:        'flex',
                          alignItems:     'center',
                          justifyContent: 'center',
                          gap:            6,
                          transition:     'background 0.15s',
                        }}
                      >
                        {showMorePerbaikan ? 'Sembunyikan ↑' : `Lihat ${(data.rekomendasi || []).length} perbaikan lainnya →`}
                      </button>
                      {showMorePerbaikan && (
                        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.14)' }}>
                          <RecommendationList recommendations={data.rekomendasi || []} />
                          {data.skor_sesudah !== undefined && (
                            <BeforeAfterProjection beforeScore={data.skor} afterScore={data.skor_sesudah} />
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Strong CTA */}
                  <div style={{
                    background:   'linear-gradient(135deg, rgba(37,99,235,0.05) 0%, rgba(27,79,232,0.03) 100%)',
                    border:       '1px solid rgba(37,99,235,0.15)',
                    borderRadius: 16,
                    padding:      '1.25rem',
                    marginTop:    '1.25rem',
                  }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 0.75rem', lineHeight: 1.4 }}>
                      Mau AI rewrite seluruh CV kamu?
                    </h3>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {[
                        'ATS-friendly & relevan dengan posisi yang kamu lamar',
                        'Bahasa Indonesia + English (bilingual)',
                        'Siap kirim: PDF & DOCX langsung',
                      ].map((b, i) => (
                        <li key={i} style={{ fontSize: '0.875rem', color: '#1E3A8A', display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 }}>
                          <span style={{ color: '#2563EB', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                          {b}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => document.getElementById('pricing-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      style={{
                        width:        '100%',
                        background:   'linear-gradient(180deg,#3b82f6,#1d4ed8)',
                        color:        'white',
                        border:       'none',
                        borderRadius: 60,
                        padding:      '0.85rem',
                        fontWeight:   700,
                        fontSize:     '1rem',
                        cursor:       'pointer',
                        fontFamily:   'inherit',
                        boxShadow:    '0 6px 20px rgba(37,99,235,0.28)',
                      }}
                    >
                      Rewrite CV Saya →
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ── PRICING ── */}
            <div id="pricing-section" style={{ scrollMarginTop: 80, ...CARD_STYLE }}>
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

              {sessionExpiredByPay && (
                <div style={{ marginBottom: '1rem', padding: '1rem', background: '#FFFBEB', border: '1px solid rgba(252,211,77,0.5)', borderRadius: 16, textAlign: 'center' }}>
                  <p style={{ color: '#92400E', fontWeight: 600, fontSize: '0.88rem', margin: '0 0 0.5rem' }}>
                    Sesi analisis sudah kedaluwarsa (30 menit)
                  </p>
                  <p style={{ color: '#78350F', fontSize: '0.875rem', margin: '0 0 0.75rem' }}>
                    Upload ulang CV kamu untuk melanjutkan.
                  </p>
                  <a href="upload.html" style={{ display: 'inline-block', background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', color: 'white', fontWeight: 700, padding: '0.65rem 1.5rem', borderRadius: 60, textDecoration: 'none', fontSize: '0.88rem', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
                    Upload CV Lagi →
                  </a>
                </div>
              )}

              <p style={{ fontSize: '0.8rem', color: '#94A3B8', fontStyle: 'italic', textAlign: 'center', margin: '1.25rem 0 0.75rem' }}>
                Perbaikan ini bikin CV kamu standout di 7 detik pertama.
              </p>

              {/* Pay button */}
              <button
                data-testid="generate-cv-button"
                onClick={proceedToPayment}
                disabled={payBtnDisabled}
                aria-label="Lihat CV hasil rewrite lengkap"
                title={payBtnDisabled && payHint ? payHint : undefined}
                style={{
                  background:   payBtnDisabled ? '#CBD5E1' : 'linear-gradient(180deg,#3b82f6,#1d4ed8)',
                  color:        'white',
                  border:       'none',
                  borderRadius: 60,
                  padding:      '0.95rem 1.5rem',
                  fontWeight:   700,
                  cursor:       payBtnDisabled ? 'not-allowed' : 'pointer',
                  width:        '100%',
                  transition:   '0.2s',
                  fontFamily:   'inherit',
                  fontSize:     '1rem',
                  opacity:      payBtnDisabled ? 0.55 : 1,
                  boxShadow:    payBtnDisabled ? 'none' : '0 8px 28px rgba(37,99,235,0.30)',
                }}
              >
                {payBtnLabel}
              </button>

              {emailIsConfirmed && !payHint && !sessionExpiredByPay && (
                <p style={{ fontSize: '0.8rem', color: '#374151', textAlign: 'center', marginTop: '0.5rem' }}>
                  📬 CV akan dikirim ke: <strong>{email.trim()}</strong>
                </p>
              )}
              {payHint && !sessionExpiredByPay && (
                <p style={{ fontSize: '0.8rem', color: '#DC2626', fontWeight: 500, textAlign: 'center', marginTop: '0.5rem' }}>
                  ⚠️ {payHint}
                </p>
              )}
              {paymentError && (
                <div role="alert" style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, color: '#B91C1C', fontSize: '0.875rem', textAlign: 'center' }}>
                  {paymentError}
                </div>
              )}
            </div>

            {/* Trust line */}
            <div style={{ textAlign: 'center', padding: '0.5rem 0 0.5rem', fontSize: '0.8rem', color: '#94A3B8', lineHeight: 1.7 }}>
              🔒 Data kamu aman &nbsp;·&nbsp; Bayar via QRIS, VA, e-wallet
            </div>

            {/* Back link */}
            <div className="text-center mt-4 mb-2">
              <a href="upload.html" className="text-sm text-slate-400 hover:text-slate-600 transition-colors no-underline">
                ← Upload CV lain
              </a>
            </div>

            {/* Legal footer */}
            <footer className="text-center py-6 text-sm text-slate-400">
              <p className="mb-3 text-slate-400">GasLamar · Karena nyari kerja udah cukup ribet</p>
              <a href="privacy.html" className="text-slate-400 no-underline hover:underline mx-2">Kebijakan Privasi</a>
              ·
              <a href="terms.html" className="text-slate-400 no-underline hover:underline mx-2">Syarat Layanan</a>
              ·
              <a href="accessibility.html" className="text-slate-400 no-underline hover:underline mx-2">Aksesibilitas</a>
            </footer>
          </>
        )}
      </main>

      <style>{`@keyframes gasResultSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
