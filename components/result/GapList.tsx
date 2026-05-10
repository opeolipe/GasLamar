interface Props { gaps: string[] }

function shortGap(text: string): string {
  const first = text.split(/\.\s+/)[0].replace(/\.$/, '');
  return first.length > 100 ? first.slice(0, 97) + '…' : first;
}

export default function GapList({ gaps }: Props) {
  if (!gaps.length) return null;

  const visible = gaps.slice(0, 4);

  return (
    <div style={{ marginBottom: '1rem' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {visible.map((g, i) => (
          <li key={i} style={{ fontSize: '0.875rem', color: '#374151', display: 'flex', gap: '0.5rem', alignItems: 'flex-start', lineHeight: 1.5 }}>
            <span style={{ color: '#64748B', flexShrink: 0, marginTop: 1 }}>•</span>
            {shortGap(g)}
          </li>
        ))}
      </ul>
    </div>
  );
}
