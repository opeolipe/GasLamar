interface Props {
  selectedTier:         string | null;
  email:                string;
  onChange:             (value: string) => void;
  onBlur?:              () => void;
  error?:               string;
  suggestion?:          string | null;
  onAcceptSuggestion?:  () => void;
  isDisposable?:        boolean;
  isConfirmed?:         boolean;
}

function getHelper(tier: string | null): string {
  if (tier === '3pack')   return '🔒 Link berlaku 30 hari — bisa dipakai untuk 3 lamaran';
  if (tier === 'jobhunt') return '⚡ Link berlaku 30 hari — bisa dipakai untuk 10 lamaran';
  return '🔒 Link download dikirim ke email ini setelah pembayaran';
}

export default function EmailCapture({
  selectedTier, email, onChange, onBlur, error,
  suggestion, onAcceptSuggestion, isDisposable, isConfirmed,
}: Props) {
  const helper = getHelper(selectedTier);

  const borderColor = error ? '#DC2626' : isConfirmed ? '#16A34A' : '#CBD5E1';

  // Only one message at a time — priority: error > suggestion > disposable > confirmed
  const showSuggestion = !error && !!suggestion;
  const showDisposable = !error && !suggestion && !!isDisposable;
  const showConfirmed  = !error && !suggestion && !isDisposable && !!isConfirmed;

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label
        htmlFor="email-capture"
        style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#374151', marginBottom: '0.5rem' }}
      >
        Masukkan email untuk kirim CV hasil perbaikan <span style={{ color: '#DC2626' }}>*</span>
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
        placeholder="contoh@email.com"
        autoComplete="email"
        aria-label="Alamat email untuk konfirmasi pembayaran"
        aria-invalid={!!error}
        style={{
          width:        '100%',
          padding:      '0.75rem 1rem',
          border:       `1.5px solid ${borderColor}`,
          borderRadius: 10,
          fontSize:     '0.95rem',
          boxSizing:    'border-box' as const,
          fontFamily:   'inherit',
          background:   'white',
          outline:      'none',
          transition:   'border-color 0.2s',
        }}
      />
      <p style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '0.4rem', margin: '0.4rem 0 0' }}>
        {helper}
      </p>
      {error && (
        <p role="alert" style={{ color: '#DC2626', fontSize: '0.82rem', marginTop: '0.4rem', fontWeight: 500 }}>
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
            fontSize:     '0.82rem',
            fontWeight:   600,
            cursor:       'pointer',
            textAlign:    'left' as const,
            fontFamily:   'inherit',
          }}
        >
          💡 Maksud kamu <strong>{suggestion}</strong>? Klik untuk pakai alamat ini.
        </button>
      )}
      {showDisposable && (
        <p style={{ color: '#D97706', fontSize: '0.82rem', marginTop: '0.4rem', fontWeight: 500 }}>
          ⚠️ Gunakan email aktif agar kamu bisa menerima CV hasil perbaikan.
        </p>
      )}
      {showConfirmed && (
        <p style={{ color: '#64748B', fontSize: '0.75rem', marginTop: '0.4rem' }}>
          Pastikan email ini benar — hasil CV akan dikirim ke sini.
        </p>
      )}
    </div>
  );
}
