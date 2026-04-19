interface Props {
  selectedTier: string | null;
  email:        string;
  onChange:     (value: string) => void;
  error?:       string;
}

interface EmailCopy {
  title:  string;
  body:   React.ReactNode;
  helper: string;
}

function getEmailCopy(tier: string | null): EmailCopy {
  if (tier === '3pack') {
    return {
      title:  'Masukkan email aktif kamu',
      body:   <>Kami kirim 1 link akses ke email kamu.<br />Pakai link ini untuk generate CV yang sudah disesuaikan hingga <strong>3 lowongan berbeda</strong> dalam 30 hari — tanpa perlu login.</>,
      helper: '🔒 Link pribadi kamu — bisa dipakai ulang kapan saja selama 30 hari',
    };
  }
  if (tier === 'jobhunt') {
    return {
      title:  'Masukkan email aktif kamu',
      body:   <>Kami kirim 1 link akses ke email kamu.<br />Gunakan link ini untuk generate CV yang sudah dioptimasi hingga <strong>10 lowongan berbeda</strong> dalam 30 hari — tanpa login.</>,
      helper: '⚡ 1 link untuk semua lamaran kamu selama 30 hari',
    };
  }
  return {
    title:  'Masukkan email untuk menerima link download CV kamu',
    body:   <>Kami kirim 1 link akses ke email kamu setelah pembayaran berhasil.<br />Link berlaku selama <strong>7 hari</strong> — tanpa perlu login.</>,
    helper: '🔒 Link download pribadimu — tersedia selama 7 hari',
  };
}

export default function EmailCapture({ selectedTier, email, onChange, error }: Props) {
  const copy = getEmailCopy(selectedTier);

  return (
    <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 32, boxShadow: '0 20px 35px -12px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.02)', padding: '2rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>📧</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem' }}>
            {copy.title} <span style={{ color: '#DC2626' }}>*</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#92400E', marginBottom: '0.75rem', lineHeight: 1.6, margin: '0 0 0.75rem' }}>
            {copy.body}
          </p>
          <input
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
              border:       `1.5px solid ${error ? '#DC2626' : '#D97706'}`,
              borderRadius: 10,
              fontSize:     '0.95rem',
              boxSizing:    'border-box',
              fontFamily:   'inherit',
              background:   'white',
              outline:      'none',
            }}
          />
          <p style={{ fontSize: '0.75rem', color: '#92400E', fontWeight: 500, marginTop: '0.5rem' }}>
            {copy.helper}
          </p>
          <p style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '0.3rem' }}>
            Kami tidak akan spam email kamu
          </p>
          <p style={{ fontSize: '0.8rem', color: '#6B7280', marginTop: '0.6rem' }}>
            💡 Tidak perlu buat akun — cukup pakai link dari email kamu
          </p>
          {error && (
            <p role="alert" style={{ color: '#DC2626', fontSize: '0.82rem', marginTop: '0.5rem', fontWeight: 500 }}>
              ⚠️ {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
