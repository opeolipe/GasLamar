import { useState } from 'react';

interface Props { gaps: string[] }

export default function GapList({ gaps }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!gaps.length) return null;

  const visible = gaps.slice(0, 4);

  return (
    <div style={{ marginBottom: '1rem' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {visible.map((g, i) => (
          <li key={i} style={{ fontSize: '0.875rem', color: '#374151', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span style={{ color: '#64748B', flexShrink: 0, marginTop: 3 }}>•</span>
            <span style={{
              overflow:          'hidden',
              display:           '-webkit-box',
              WebkitLineClamp:   expanded ? 'unset' : 1,
              WebkitBoxOrient:   'vertical',
              lineHeight:        1.5,
            } as React.CSSProperties}>
              {g}
            </span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          background:  'none',
          border:      'none',
          padding:     '0.35rem 0',
          fontSize:    '0.82rem',
          color:       '#2563EB',
          fontWeight:  600,
          cursor:      'pointer',
          fontFamily:  'inherit',
          marginTop:   '0.4rem',
          display:     'block',
        }}
      >
        {expanded ? 'Sembunyikan ↑' : 'Lihat detail analisis →'}
      </button>
    </div>
  );
}
