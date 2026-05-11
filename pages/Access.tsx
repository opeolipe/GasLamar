import { useState, useRef, useEffect } from 'react';
import { WORKER_URL }             from '@/lib/sessionUtils';
import { validateEmail, EMAIL_REGEX } from '@/utils/emailValidation';
import { suggestEmailFix }        from '@/utils/emailTypo';

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
  const source = params.get('source');
  const sourceLabel = source === 'download'
    ? 'halaman download'
    : source === 'hasil'
    ? 'halaman hasil analisis'
    : null;

  if (params.has('return_url')) {
    const raw = params.get('return_url') ?? '';
    if (!isSameOriginUrl(raw)) {
      params.delete('return_url');
      history.replaceState(null, '', params.toString() ? `${location.pathname}?${params}` : location.pathname);
    }
  }

  const [email,            setEmail]            = useState('');
  const [emailError,       setEmailError]       = useState('');
  const [emailSuggestion,  setEmailSuggestion]  = useState<string | null>(null);
  const [emailIsDisposable,setEmailIsDisposable]= useState(false);
  const [emailIsConfirmed, setEmailIsConfirmed] = useState(false);

  const [confirmEmail,     setConfirmEmail]     = useState('');
  const [confirmTouched,   setConfirmTouched]   = useState(false);
  const [confirmError,     setConfirmError]     = useState('');

  const [status,           setStatus]           = useState<Status>('idle');

  const blurTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmEmailRef = useRef<HTMLInputElement>(null);

  // ── Derived ──────────────────────────────────────────────────────────────
  const emailValid       = EMAIL_REGEX.test(email.trim());
  const emailsMatch      = email.trim().toLowerCase() === confirmEmail.trim().toLowerCase();
  const showConfirmField = emailValid && !emailError && !emailSuggestion;

  const isSubmitDisabled =
    status === 'loading'
    || !email.trim()
    || !!emailError
    || !!emailSuggestion
    || !emailValid
    || !confirmEmail.trim()
    || !emailsMatch;

  const hint: string | null =
      !!emailSuggestion                         ? 'Periksa email kamu sebelum lanjut'
    : !emailValid && !!email                    ? 'Masukkan email yang valid'
    : showConfirmField && !confirmEmail.trim()  ? 'Ketik ulang email kamu untuk lanjut'
    : showConfirmField && !emailsMatch          ? 'Email konfirmasi tidak sama'
    : null;

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleEmailChange(value: string) {
    setEmail(value);
    setEmailError('');
    setEmailSuggestion(suggestEmailFix(value));
    setEmailIsDisposable(false);
    setEmailIsConfirmed(false);
    setConfirmError('');
    if (!EMAIL_REGEX.test(value.trim())) {
      setConfirmEmail('');
      setConfirmTouched(false);
    }
  }

  function handleEmailBlur() {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      const result = validateEmail(email);
      setEmailError(result.error ?? '');
      setEmailSuggestion(result.suggestion);
      setEmailIsDisposable(result.isDisposable);
      setEmailIsConfirmed(result.valid && !result.suggestion);
    }, 200);
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
      ;(window as any).Analytics?.track?.('access_email_mismatch_detected');
    } else {
      setConfirmError('');
      if (emailIsConfirmed) {
        ;(window as any).Analytics?.track?.('access_email_confirm_success');
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

  function handleAcceptSuggestion() {
    if (!emailSuggestion) return;
    const accepted = emailSuggestion;
    setEmail(accepted);
    setEmailError('');
    setEmailSuggestion(null);
    setEmailIsDisposable(false);
    setEmailIsConfirmed(true);
    setConfirmError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Final guard — mirrors proceedToPayment() in Result.tsx
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid || emailValidation.suggestion) {
      setEmailError(emailValidation.error ?? 'Email tidak valid.');
      setEmailSuggestion(emailValidation.suggestion);
      setEmailIsConfirmed(false);
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

    if (status === 'loading') return;
    setStatus('loading');

    try {
      await fetch(`${WORKER_URL}/resend-access`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  // ── Computed display flags (priority: error > suggestion > disposable > confirmed) ──
  const showSuggestion      = !emailError && !!emailSuggestion;
  const showDisposable      = !emailError && !emailSuggestion && emailIsDisposable;
  const showConfirmed       = !emailError && !emailSuggestion && !emailIsDisposable && emailIsConfirmed;
  const showConfirmError    = !emailError && !emailSuggestion && !!confirmError;
  const showConfirmSuccess  = !emailError && !emailSuggestion && emailIsConfirmed && emailsMatch && confirmTouched;

  // Auto-focus confirm input when it slides into view
  const prevShowConfirmField = useRef(false);
  useEffect(() => {
    if (showConfirmField && !prevShowConfirmField.current) {
      const t = setTimeout(() => confirmEmailRef.current?.focus(), 280);
      prevShowConfirmField.current = true;
      return () => clearTimeout(t);
    }
    if (!showConfirmField) prevShowConfirmField.current = false;
  }, [showConfirmField]);

  const primaryBorderClass  = emailError ? 'border-red-400 ring-red-200' : showConfirmed ? 'border-green-400 ring-green-100' : 'border-slate-200';
  const confirmBorderClass  = showConfirmError ? 'border-red-400 ring-red-200' : showConfirmSuccess ? 'border-green-400 ring-green-100' : 'border-slate-200';

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

        {/* Page title */}
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

          {/* Expired notice */}
          {showExpiredBanner && (
            <div
              role="status"
              className="rounded-[16px] px-4 py-3 text-sm mb-4 text-amber-800"
              style={{ background: 'rgba(255,251,235,0.9)', border: '1px solid rgba(253,230,138,0.8)' }}
            >
              <span aria-hidden="true">⏰</span><span className="sr-only">Perhatian: </span> Sesi dari {sourceLabel || 'halaman sebelumnya'} sudah berakhir, tapi tenang — kamu tetap bisa akses CV melalui email.
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
                <h2 className="text-lg font-semibold text-slate-900 mb-2" style={SERIF}>
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
                  className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-6"
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

                <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-1 items-stretch max-w-xs mx-auto text-left">

                  {/* ── Primary email ── */}
                  <div className="flex flex-col gap-1 mb-1">
                    <label htmlFor="access-email" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Email
                      {showConfirmed && (
                        <span className="ml-1 text-green-600" aria-label="Email valid">✓</span>
                      )}
                    </label>
                    <input
                      id="access-email"
                      type="email"
                      inputMode="email"
                      autoCapitalize="off"
                      autoComplete="email"
                      value={email}
                      onChange={e => handleEmailChange(e.target.value)}
                      onBlur={handleEmailBlur}
                      placeholder="email@kamu.com"
                      required
                      disabled={status === 'loading'}
                      aria-label="Alamat email"
                      aria-invalid={!!emailError}
                      aria-describedby={emailError ? 'email-error' : undefined}
                      className={`min-h-[48px] px-4 rounded-[14px] border text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 transition-colors ${primaryBorderClass}`}
                    />

                    {emailError && (
                      <p id="email-error" role="alert" className="text-xs text-red-500 font-medium mt-0.5">
                        <span aria-hidden="true">⚠️</span> {emailError}
                      </p>
                    )}

                    {showSuggestion && (
                      <button
                        type="button"
                        onClick={handleAcceptSuggestion}
                        className="w-full min-h-[44px] mt-1 px-3 py-2 text-left text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-[10px] hover:bg-blue-100 transition-colors"
                      >
                        <span aria-hidden="true">💡</span><span className="sr-only">Saran: </span> Maksud kamu: <strong>{emailSuggestion}</strong>?{' '}
                        <span className="underline">Pakai ini</span>
                      </button>
                    )}

                    {showDisposable && (
                      <p className="text-xs text-amber-600 font-medium mt-0.5">
                        <span aria-hidden="true">⚠️</span><span className="sr-only">Peringatan: </span> Gunakan email aktif agar link akses bisa diterima.
                      </p>
                    )}
                  </div>

                  {/* ── Confirm email — slides in once primary is valid ── */}
                  <div
                    aria-hidden={!showConfirmField}
                    style={{
                      display: 'grid',
                      gridTemplateRows: showConfirmField ? '1fr' : '0fr',
                      transition: 'grid-template-rows 0.28s cubic-bezier(0.4,0,0.2,1)',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ minHeight: 0 }} className="flex flex-col gap-1 mb-3">
                      <label htmlFor="access-email-confirm" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                        Ketik ulang email kamu
                        {showConfirmSuccess && (
                          <span className="ml-1 text-green-600" aria-label="Email konfirmasi cocok">✓</span>
                        )}
                      </label>
                      <input
                        id="access-email-confirm"
                        ref={confirmEmailRef}
                        type="email"
                        inputMode="email"
                        autoCapitalize="off"
                        autoComplete="email"
                        data-testid="email-confirm-input"
                        value={confirmEmail}
                        onChange={e => handleConfirmEmailChange(e.target.value)}
                        onBlur={handleConfirmEmailBlur}
                        onPaste={handleConfirmEmailPaste}
                        placeholder="email@kamu.com"
                        required={showConfirmField}
                        tabIndex={showConfirmField ? undefined : -1}
                        disabled={status === 'loading'}
                        aria-label="Konfirmasi alamat email"
                        aria-invalid={showConfirmError}
                        aria-describedby={showConfirmError ? 'confirm-email-error' : undefined}
                        className={`min-h-[48px] px-4 rounded-[14px] border text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 transition-colors ${confirmBorderClass}`}
                      />

                      {showConfirmError && (
                        <p id="confirm-email-error" role="alert" className="text-xs text-red-500 font-medium mt-0.5">
                          <span aria-hidden="true">⚠️</span> {confirmError}
                        </p>
                      )}

                      {showConfirmSuccess && (
                        <p className="text-xs text-green-600 font-medium mt-0.5">
                          <span aria-hidden="true">✓</span> Email sudah cocok
                        </p>
                      )}
                    </div>
                  </div>

                  {/* ── Hint line ── */}
                  {hint && !emailError && !showConfirmError && (
                    <p className="text-xs text-slate-400 text-center -mt-1 mb-1">{hint}</p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitDisabled}
                    className="min-h-[48px] px-6 rounded-[16px] font-bold text-white text-sm transition-all hover:-translate-y-[1px] disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: '#1B4FE8', boxShadow: SHADOW }}
                  >
                    {status === 'loading' ? 'Mengirim link...' : 'Kirim ulang link'}
                  </button>

                  {status === 'error' && (
                    <p className="text-xs text-red-500 text-center mt-1" role="alert">
                      Terjadi kendala. Coba lagi dalam beberapa detik.
                    </p>
                  )}
                </form>

                <p className="mt-6 text-xs text-slate-400 leading-relaxed max-w-xs mx-auto text-center">
                  Tidak perlu bayar lagi. CV kamu tetap tersimpan selama masa aktif.
                </p>
              </>
            )}
          </div>

          <a
            href="mailto:support@gaslamar.com"
            className="block text-center mt-6 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            <span aria-hidden="true">📧</span> Butuh bantuan? Hubungi support
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
