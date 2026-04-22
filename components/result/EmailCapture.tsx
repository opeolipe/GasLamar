interface Props {
  selectedTier: string | null;
  email:        string;
  onChange:     (value: string) => void;
  error?:       string;
}

function getHelper(tier: string | null): string {
  if (tier === '3pack')   return '🔒 Link berlaku 30 hari — bisa dipakai untuk 3 lamaran';
  if (tier === 'jobhunt') return '⚡ Link berlaku 30 hari — bisa dipakai untuk 10 lamaran';
  return '🔒 Link download dikirim ke email ini setelah pembayaran';
}

export default function EmailCapture({ selectedTier, email, onChange, error }: Props) {
  const helper = getHelper(selectedTier);

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label
        htmlFor="email-capture"
        style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#374151', marginBottom: '0.5rem' }}
      >
        Email untuk link download CV kamu <span style={{ color: '#DC2626' }}>*</span>
      </label>
      <input
        id="email-capture"
        type="email"
        value={email}
        onChange={e => onChange(e.target.value)}
        placeholder="contoh@email.com"
        autoComplete="email"
        aria-label="Alamat email untuk konfirmasi pembayaran"
        aria-invalid={!!error}
        style={{
          width:        '100%',
          padding:      '0.75rem 1rem',
          border:       `1.5px solid ${error ? '#DC2626' : '#CBD5E1'}`,
          borderRadius: 10,
          fontSize:     '0.95rem',
          boxSizing:    'border-box' as const,
          fontFamily:   'inherit',
          background:   'white',
          outline:      'none',
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
    </div>
  );
}
