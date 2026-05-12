interface Props { gaps: string[] }

export default function GapList({ gaps }: Props) {
  if (!gaps.length) return null;

  const visible = gaps.slice(0, 4);

  return (
    <div style={{ marginBottom: '1rem' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {visible.map((g, i) => (
          <li key={i} style={{ fontSize: '0.875rem', color: '#374151', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span style={{ color: '#64748B', flexShrink: 0, marginTop: 3 }}>•</span>
            <span style={{ lineHeight: 1.5, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              {g}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
