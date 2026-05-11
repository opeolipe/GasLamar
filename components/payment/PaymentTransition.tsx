import { useEffect, useRef } from 'react';

const REDIRECT_DELAY_MS = 1800;

interface Props {
  invoiceUrl: string | null;
}

export default function PaymentTransition({ invoiceUrl }: Props) {
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (!invoiceUrl) return;
    redirectedRef.current = false;

    (window as any).Analytics?.track?.('payment_transition_shown', {
      redirect_delay_ms: REDIRECT_DELAY_MS,
    });

    const timer = setTimeout(() => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      (window as any).Analytics?.track?.('payment_redirect_executed');
      window.location.href = invoiceUrl;
    }, REDIRECT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [invoiceUrl]);

  if (!invoiceUrl) return null;

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mengarahkan ke pembayaran aman"
      aria-live="assertive"
      style={{
        position:           'fixed',
        inset:              0,
        zIndex:             9999,
        display:            'flex',
        alignItems:         'center',
        justifyContent:     'center',
        background:         'rgba(11, 23, 41, 0.88)',
        backdropFilter:     'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding:            '1.25rem',
        animation:          prefersReducedMotion ? 'none' : 'ptFadeIn 0.18s ease-out',
      }}
    >
      <div
        style={{
          background:     'rgba(255,255,255,0.96)',
          borderRadius:   24,
          padding:        '2.5rem 2rem 2rem',
          maxWidth:       360,
          width:          '100%',
          textAlign:      'center',
          boxShadow:      '0 24px 64px rgba(15, 23, 42, 0.20), 0 1px 2px rgba(15, 23, 42, 0.06)',
          border:         '1px solid rgba(148,163,184,0.16)',
          backdropFilter: 'blur(16px)',
          animation:      prefersReducedMotion ? 'none' : 'ptSlideUp 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Lock icon */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <div
            style={{
              width:        56,
              height:       56,
              borderRadius: '50%',
              background:   'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
              border:       '1px solid rgba(37,99,235,0.14)',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              flexShrink:   0,
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M18 11H6a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2v-6a2 2 0 00-2-2z"
                stroke="#1B4FE8"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 11V7a5 5 0 0110 0v4"
                stroke="#1B4FE8"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <h2
          style={{
            fontFamily:    '"Plus Jakarta Sans", sans-serif',
            fontSize:      '1.15rem',
            fontWeight:    700,
            color:         '#0F172A',
            margin:        '0 0 0.4rem',
            letterSpacing: '-0.02em',
            lineHeight:    1.3,
          }}
        >
          Mengarahkan ke pembayaran aman
        </h2>

        <p
          style={{
            fontSize:   '0.875rem',
            color:      '#64748B',
            margin:     '0 0 1.75rem',
            lineHeight: 1.6,
          }}
        >
          Kamu akan diarahkan ke halaman pembayaran Mayar dalam sebentar.
        </p>

        {/* Spinner */}
        <div
          aria-hidden="true"
          style={{
            width:        32,
            height:       32,
            border:       '3px solid #DBEAFE',
            borderTopColor: '#1B4FE8',
            borderRadius: '50%',
            animation:    'ptSpin 0.75s linear infinite',
            margin:       '0 auto 1.5rem',
          }}
        />

        {/* Progress bar */}
        <div
          aria-hidden="true"
          style={{
            background:   '#EFF6FF',
            borderRadius: 999,
            height:       4,
            overflow:     'hidden',
            marginBottom: '1.75rem',
          }}
        >
          <div
            style={{
              height:     '100%',
              background: 'linear-gradient(90deg, #3b82f6, #1B4FE8)',
              borderRadius: 999,
              animation:  prefersReducedMotion
                ? 'none'
                : `ptProgress ${REDIRECT_DELAY_MS}ms linear forwards`,
              width: prefersReducedMotion ? '100%' : '0%',
            }}
          />
        </div>

        {/* Secured-by badge */}
        <div
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            gap:            6,
            background:     '#F0FDF4',
            border:         '1px solid rgba(34,197,94,0.28)',
            borderRadius:   999,
            padding:        '0.3rem 0.85rem',
            fontSize:       '0.75rem',
            fontWeight:     600,
            color:          '#15803D',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              stroke="#15803D"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Pembayaran diproses oleh Mayar.id
        </div>
      </div>

      <style>{`
        @keyframes ptFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes ptSlideUp {
          from { transform: translateY(14px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0)    scale(1);    opacity: 1; }
        }
        @keyframes ptSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes ptProgress {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  );
}
