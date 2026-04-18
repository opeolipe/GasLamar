interface Props { recommendations: string[] }

export default function RecommendationList({ recommendations }: Props) {
  if (!recommendations.length) return null;

  const visible = recommendations.slice(0, 3);

  return (
    <div style={{ background: '#F0FDF4', borderLeft: '4px solid #10B981', borderRadius: 20, padding: '1.5rem', margin: '1.5rem 0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: '0.75rem', color: '#065F46', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>
        🔥 Perbaiki ini dulu
      </h4>
      <ol style={{ marginLeft: '1.2rem', fontSize: '0.9rem', margin: '0 0 0.75rem 1.2rem', padding: 0 }}>
        {visible.map((r, i) => (
          <li key={i} style={{ margin: '0.4rem 0', color: '#111827' }}>{r}</li>
        ))}
      </ol>
      <p style={{ fontSize: '0.8rem', color: '#065F46', marginTop: '0.75rem', fontStyle: 'italic', margin: '0.75rem 0 0' }}>
        Ini adalah perubahan dengan dampak terbesar untuk meningkatkan peluang kamu dipanggil interview.
      </p>
    </div>
  );
}
