interface Props { recommendations: string[] }

export default function RecommendationList({ recommendations }: Props) {
  if (!recommendations.length) return null;

  const visible = recommendations.slice(0, 3);

  return (
    <div style={{ borderLeft: '3px solid #10B981', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1.25rem', background: '#F0FDF4' }}>
      <h4 style={{ fontWeight: 700, color: '#065F46', fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden="true">🔥</span> Perbaiki ini dulu
      </h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {visible.map((r, i) => (
          <li key={i} style={{ fontSize: '0.88rem', color: '#111827', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ color: '#10B981', flexShrink: 0, marginTop: 2, fontWeight: 700 }}>→</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
