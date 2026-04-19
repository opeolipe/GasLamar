interface Props { redFlags: string[] }

export default function RedFlags({ redFlags }: Props) {
  if (!redFlags.length) return null;

  return (
    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 16, padding: '1rem 1.2rem', marginBottom: '1rem' }}>
      <h4 style={{ color: '#B91C1C', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem', margin: '0 0 0.5rem' }}>
        🚩 Red Flag Terdeteksi
      </h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.85rem', color: '#7F1D1D', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {redFlags.map((f, i) => (
          <li key={i}>🚩 {f}</li>
        ))}
      </ul>
    </div>
  );
}
