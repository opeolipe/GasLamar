import { useState, useEffect, useRef } from 'react';
import { validateEmail }               from '@/utils/emailValidation';
import { WORKER_URL, buildSecretHeaders } from '@/lib/downloadUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeliveryState {
  sessionId: string;
  email:     string;
  sentAt:    number;
}

interface Props {
  sessionSecret: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COOLDOWN_SECS = 30;

// ── Component ─────────────────────────────────────────────────────────────────

export default function ResendEmail({ sessionSecret }: Props) {
  const [delivery, setDelivery] = useState<DeliveryState | null>(() => {
    try {
      const raw = localStorage.getItem('gaslamar_delivery');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const [showChange,        setShowChange]        = useState(false);
  const [newEmail,          setNewEmail]          = useState('');
  const [emailError,        setEmailError]        = useState('');
  const [emailSuggestion,   setEmailSuggestion]   = useState<string | null>(null);
  const [emailIsDisposable, setEmailIsDisposable] = useState(false);
  const [emailIsConfirmed,  setEmailIsConfirmed]  = useState(false);
  const [sending,           setSending]           = useState(false);
  const [successMsg,        setSuccessMsg]        = useState('');
  const [errorMsg,          setErrorMsg]          = useState('');
  const [cooldown,          setCooldown]          = useState(0);

  const blurTimerRef     = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current)     clearTimeout(blurTimerRef.current);
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function startCooldown() {
    setCooldown(COOLDOWN_SECS);
    cooldownTimerRef.current = setInterval(() => {
      setCooldown(c => {
        if (c <= 1) { clearInterval(cooldownTimerRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  function persistDelivery(updated: DeliveryState) {
    setDelivery(updated);
    try { localStorage.setItem('gaslamar_delivery', JSON.stringify(updated)); } catch (_) {}
  }

  // ── API call ──────────────────────────────────────────────────────────────

  async function doResend(targetEmail: string, isChange: boolean) {
    // Start cooldown immediately to block spam even if the request fails
    startCooldown();
    setSending(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      const body = isChange ? { email: targetEmail } : {};
      const res  = await fetch(`${WORKER_URL}/resend-email`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json', ...buildSecretHeaders(sessionSecret) },
        credentials: 'include',
        body:        JSON.stringify(body),
      });

      if (res.status === 401 || res.status === 404) {
        localStorage.removeItem('gaslamar_delivery');
        window.location.href = '/';
        return;
      }

      if (res.status === 429) {
        setErrorMsg('Terlalu banyak permintaan. Coba lagi dalam beberapa saat.');
        ;(window as any).Analytics?.track?.('resend_failed', { reason: 'rate_limited' });
        return;
      }

      if (!res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const reason = data.reason || 'unknown';
        setErrorMsg(
          reason === 'expired' || reason === 'no_cookie'
            ? 'Sesi telah berakhir. Silakan upload ulang CV.'
            : 'Gagal mengirim ulang. Coba lagi dalam beberapa saat.',
        );
        ;(window as any).Analytics?.track?.('resend_failed', { reason });
        return;
      }

      const updated = { ...(delivery!), email: targetEmail, sentAt: Date.now() };
      persistDelivery(updated);

      if (isChange) {
        ;(window as any).Analytics?.track?.('email_changed', {
          old_domain: delivery?.email.split('@')[1],
          new_domain: targetEmail.split('@')[1],
        });
        setSuccessMsg(`CV berhasil dikirim ulang ke ${targetEmail}.`);
        setShowChange(false);
        setNewEmail('');
      } else {
        setSuccessMsg(`CV berhasil dikirim ulang ke ${targetEmail}.`);
      }
      ;(window as any).Analytics?.track?.('resend_success');

    } catch (_) {
      setErrorMsg('Gagal mengirim ulang. Coba lagi dalam beberapa saat.');
      ;(window as any).Analytics?.track?.('resend_failed', { reason: 'network_error' });
    } finally {
      setSending(false);
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleResendSame() {
    if (!delivery) return;
    if (sending) return;
    ;(window as any).Analytics?.track?.('resend_clicked', { action: 'same_email' });
    doResend(delivery.email, false);
  }

  function handleToggleChange() {
    const next = !showChange;
    setShowChange(next);
    if (next) {
      setNewEmail(delivery?.email ?? '');
      setEmailError('');
      setEmailSuggestion(null);
      setEmailIsDisposable(false);
      setEmailIsConfirmed(false);
    }
    setSuccessMsg('');
    setErrorMsg('');
    ;(window as any).Analytics?.track?.('resend_clicked', { action: 'change_email' });
  }

  function handleNewEmailChange(value: string) {
    setNewEmail(value);
    setEmailError('');
    setEmailSuggestion(null);
    setEmailIsDisposable(false);
    setEmailIsConfirmed(false);
  }

  function handleNewEmailBlur() {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      const result = validateEmail(newEmail);
      setEmailError(result.error ?? '');
      setEmailSuggestion(result.suggestion);
      setEmailIsDisposable(result.isDisposable);
      setEmailIsConfirmed(result.valid && !result.suggestion);
    }, 200);
  }

  function handleAcceptSuggestion() {
    if (!emailSuggestion) return;
    setNewEmail(emailSuggestion);
    setEmailError('');
    setEmailSuggestion(null);
    setEmailIsDisposable(false);
    setEmailIsConfirmed(true);
  }

  function handleChangeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateEmail(newEmail);
    if (!result.valid || result.suggestion) {
      setEmailError(result.error ?? 'Email tidak valid.');
      setEmailSuggestion(result.suggestion);
      return;
    }
    doResend(newEmail.trim().toLowerCase(), true);
  }

  // ── Early return ──────────────────────────────────────────────────────────

  if (!delivery) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  const inputBorder = emailError ? '#DC2626' : emailIsConfirmed ? '#16A34A' : '#CBD5E1';

  return (
    <div
      style={{
        marginTop:    '1.5rem',
        padding:      '1rem 1.25rem',
        background:   '#F8FAFC',
        border:       '1px solid #E2E8F0',
        borderRadius: 16,
        fontSize:     '0.875rem',
        color:        '#475569',
      }}
    >
      <p style={{ margin: '0 0 0.65rem', fontWeight: 600, color: '#374151' }}>
        Belum menerima email?
      </p>

      {/* Action row */}
      {!showChange && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={cooldown > 0 || sending}
              onClick={handleResendSame}
              style={{
                padding:      '0.5rem 0.9rem',
                background:   cooldown > 0 || sending ? '#F1F5F9' : '#EFF6FF',
                border:       '1px solid #BFDBFE',
                borderRadius: 8,
                color:        cooldown > 0 || sending ? '#94A3B8' : '#1D4ED8',
                fontWeight:   600,
                cursor:       cooldown > 0 || sending ? 'not-allowed' : 'pointer',
                fontSize:     '0.82rem',
                fontFamily:   'inherit',
                whiteSpace:   'nowrap' as const,
              }}
            >
              {`Resend ke ${delivery.email}`}
            </button>

            <button
              type="button"
              onClick={handleToggleChange}
              style={{
                padding:      '0.5rem 0.9rem',
                background:   'transparent',
                border:       '1px solid #CBD5E1',
                borderRadius: 8,
                color:        '#64748B',
                fontWeight:   500,
                cursor:       'pointer',
                fontSize:     '0.82rem',
                fontFamily:   'inherit',
              }}
            >
              Ganti email
            </button>
          </div>

          {sending && (
            <p style={{ margin: '0.4rem 0 0', color: '#64748B', fontSize: '0.82rem' }}>
              Mengirim ulang...
            </p>
          )}
          {cooldown > 0 && !sending && (
            <p style={{ margin: '0.4rem 0 0', color: '#64748B', fontSize: '0.82rem' }}>
              Kirim ulang dalam {cooldown}s
            </p>
          )}
        </>
      )}

      {/* Change email form */}
      {showChange && (
        <form onSubmit={handleChangeSubmit}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 200px' }}>
              <input
                type="email"
                inputMode="email"
                autoCapitalize="off"
                value={newEmail}
                onChange={e => handleNewEmailChange(e.target.value)}
                onBlur={handleNewEmailBlur}
                placeholder="email-baru@contoh.com"
                autoComplete="email"
                aria-label="Email baru untuk menerima CV"
                aria-invalid={!!emailError}
                disabled={sending}
                style={{
                  width:        '100%',
                  padding:      '0.5rem 0.75rem',
                  border:       `1.5px solid ${inputBorder}`,
                  borderRadius: 8,
                  fontSize:     '0.875rem',
                  boxSizing:    'border-box' as const,
                  fontFamily:   'inherit',
                  background:   'white',
                  outline:      'none',
                  transition:   'border-color 0.2s',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <button
                type="submit"
                disabled={sending || !!emailSuggestion}
                style={{
                  padding:      '0.5rem 0.9rem',
                  background:   sending || emailSuggestion ? '#F1F5F9' : '#1D4ED8',
                  border:       'none',
                  borderRadius: 8,
                  color:        sending || emailSuggestion ? '#94A3B8' : 'white',
                  fontWeight:   600,
                  cursor:       sending || emailSuggestion ? 'not-allowed' : 'pointer',
                  fontSize:     '0.82rem',
                  fontFamily:   'inherit',
                  whiteSpace:   'nowrap' as const,
                  minHeight:    36,
                }}
              >
                {sending ? 'Mengirim...' : 'Kirim ulang'}
              </button>
              <button
                type="button"
                onClick={handleToggleChange}
                style={{
                  padding:      '0.5rem 0.75rem',
                  background:   'transparent',
                  border:       '1px solid #CBD5E1',
                  borderRadius: 8,
                  color:        '#64748B',
                  cursor:       'pointer',
                  fontSize:     '0.82rem',
                  fontFamily:   'inherit',
                }}
              >
                Batal
              </button>
            </div>
          </div>

          {/* Validation messages — one at a time */}
          {emailError && (
            <p role="alert" style={{ margin: '0.35rem 0 0', color: '#DC2626', fontSize: '0.8rem', fontWeight: 500 }}>
              ⚠️ {emailError}
            </p>
          )}
          {!emailError && emailSuggestion && (
            <button
              type="button"
              onClick={handleAcceptSuggestion}
              style={{
                display:      'block',
                marginTop:    '0.35rem',
                padding:      '0.4rem 0.75rem',
                minHeight:    44,
                background:   '#EFF6FF',
                border:       '1px solid #BFDBFE',
                borderRadius: 6,
                color:        '#1D4ED8',
                fontSize:     '0.8rem',
                fontWeight:   600,
                cursor:       'pointer',
                textAlign:    'left' as const,
                fontFamily:   'inherit',
                width:        '100%',
              }}
            >
              💡 Maksud kamu <strong>{emailSuggestion}</strong>? Klik untuk pakai alamat ini.
            </button>
          )}
          {!emailError && !emailSuggestion && emailIsDisposable && (
            <p style={{ margin: '0.35rem 0 0', color: '#D97706', fontSize: '0.8rem' }}>
              ⚠️ Gunakan email aktif agar kamu bisa menerima CV hasil perbaikan.
            </p>
          )}
          {!emailError && !emailSuggestion && !emailIsDisposable && emailIsConfirmed && (
            <p style={{ margin: '0.35rem 0 0', color: '#16A34A', fontSize: '0.8rem' }}>
              ✓ Email terlihat valid
            </p>
          )}
        </form>
      )}

      {/* Status messages */}
      {successMsg && (
        <p role="status" aria-live="polite" style={{ margin: '0.6rem 0 0', color: '#15803D', fontWeight: 500 }}>
          ✓ {successMsg}
        </p>
      )}
      {errorMsg && (
        <p role="alert" style={{ margin: '0.6rem 0 0', color: '#B91C1C', fontWeight: 500 }}>
          ⚠️ {errorMsg}
        </p>
      )}
    </div>
  );
}
