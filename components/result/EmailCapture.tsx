interface Props {
  selectedTier:        string | null;
  email:               string;
  onChange:            (value: string) => void;
  onBlur?:             () => void;
  onPaste?:            (value: string) => void;
  error?:              string;
  suggestion?:         string | null;
  onAcceptSuggestion?: () => void;
  isDisposable?:       boolean;
  isConfirmed?:        boolean;
  confirmEmail?:       string;
  onConfirmChange?:    (value: string) => void;
  confirmError?:       string;
}

function getHelper(tier: string | null): string {
  if (tier === '3pack')   return '🔒 Link berlaku 30 hari — bisa dipakai untuk 3 CV berbeda';
  if (tier === 'jobhunt') return '⚡ Link berlaku 30 hari — bisa dipakai untuk 10 CV berbeda';
  return '🔒 Link download dikirim ke email ini setelah pembayaran';
}

export default function EmailCapture({
  selectedTier, email, onChange, onBlur, onPaste, error,
  suggestion, onAcceptSuggestion, isDisposable, isConfirmed,
  confirmEmail, onConfirmChange, confirmError,
}: Props) {
  const helper = getHelper(selectedTier);

  const borderColor = error ? '#DC2626' : isConfirmed ? '#16A34A' : '#CBD5E1';

  const showSuggestion = !error && !!suggestion;
  const showDisposable = !error && !suggestion && !!isDisposable;

  const inputStyle: React.CSSProperties = {
    width:        '100%',
    padding:      '0.75rem 1rem',
    border:       `1.5px solid ${borderColor}`,
    borderRadius: 10,
    fontSize:     '1rem',
    boxSizing:    'border-box' as const,
    fontFamily:   'inherit',
    background:   'white',
    outline:      'none',
    transition:   'border-color 0.2s',
  };

  const labelStyle: React.CSSProperties = {
    display:      'block',
    fontWeight:   600,
    fontSize:     '0.9rem',
    color:        '#374151',
    marginBottom: '0.5rem',
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label htmlFor="email-capture" style={labelStyle}>
        Email <span style={{ color: '#DC2626' }}>*</span>
        {isConfirmed && !error && !suggestion && (
          <span style={{ color: '#16A34A', marginLeft: '0.35rem', fontWeight: 700 }} aria-label="Email valid">✓</span>
        )}
      </label>
      <input
        id="email-capture"
        type="email"
        inputMode="email"
        autoCapitalize="off"
        value={email}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        onPaste={e => onPaste?.(e.clipboardData.getData('text'))}
        placeholder="contoh@email.com"
        autoComplete="email"
        aria-label="Alamat email untuk konfirmasi pembayaran"
        aria-invalid={!!error}
        style={inputStyle}
      />
      {onConfirmChange !== undefined && (
        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="email-confirm-capture" style={labelStyle}>
            Konfirmasi Email <span style={{ color: '#DC2626' }}>*</span>
          </label>
          <input
            id="email-confirm-capture"
            data-testid="email-confirm-input"
            type="email"
            inputMode="email"
            autoCapitalize="off"
            value={confirmEmail ?? ''}
            onChange={e => onConfirmChange(e.target.value)}
            placeholder="contoh@email.com"
            autoComplete="email"
            aria-label="Konfirmasi alamat email"
            aria-invalid={!!confirmError}
            style={{
              ...inputStyle,
              borderColor: confirmError ? '#DC2626' : (confirmEmail && confirmEmail === email) ? '#16A34A' : '#CBD5E1',
            }}
          />
          {confirmError && (
            <p role="alert" style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: '0.4rem', fontWeight: 500 }}>
              ⚠️ {confirmError}
            </p>
          )}
        </div>
      )}
      <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.4rem', margin: '0.4rem 0 0' }}>
        {helper}
      </p>
      {error && (
        <p role="alert" style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: '0.4rem', fontWeight: 500 }}>
          ⚠️ {error}
        </p>
      )}
      {showSuggestion && (
        <button
          type="button"
          onClick={onAcceptSuggestion}
          style={{
            display:      'block',
            width:        '100%',
            minHeight:    44,
            marginTop:    '0.4rem',
            padding:      '0.5rem 1rem',
            background:   '#EFF6FF',
            border:       '1px solid #BFDBFE',
            borderRadius: 8,
            color:        '#1D4ED8',
            fontSize:     '0.875rem',
            fontWeight:   600,
            cursor:       'pointer',
            textAlign:    'left' as const,
            fontFamily:   'inherit',
          }}
        >
          💡 Maksud kamu: <strong>{suggestion}</strong>? <span style={{ textDecoration: 'underline' }}>Pakai ini</span>
        </button>
      )}
      {showDisposable && (
        <p style={{ color: '#D97706', fontSize: '0.875rem', marginTop: '0.4rem', fontWeight: 500 }}>
          ⚠️ Gunakan email aktif agar kamu bisa menerima CV hasil perbaikan.
        </p>
      )}
    </div>
  );
}
