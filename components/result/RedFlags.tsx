import { useState } from 'react';

interface Props { redFlags: string[] }

export default function RedFlags({ redFlags }: Props) {
  const [expanded, setExpanded] = useState(true);
  if (!redFlags.length) return null;

  return (
    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 14, padding: '0.9rem 1.1rem', marginBottom: '1rem' }}>
      <h4 style={{ color: '#92400E', fontSize: '0.875rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
        Yang mungkin bikin recruiter bertanya
      </h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.855rem', color: '#78350F', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {redFlags.map((f, i) => (
          <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', overflow: 'hidden' }}>
            <span style={{ flexShrink: 0, marginTop: 2 }}>⚠️</span>
            <span style={{
              minWidth:          0,
              overflow:          'hidden',
              display:           '-webkit-box',
              WebkitLineClamp:   expanded ? 'unset' : 1,
              WebkitBoxOrient:   'vertical',
              lineHeight:        1.5,
              overflowWrap:      'break-word',
              wordBreak:         'break-word',
            } as React.CSSProperties}>
              {f}
            </span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          background:  'none',
          border:      'none',
          padding:     '0.3rem 0 0',
          fontSize:    '0.79rem',
          color:       '#92400E',
          fontWeight:  600,
          cursor:      'pointer',
          fontFamily:  'inherit',
          marginTop:   '0.25rem',
          display:     'block',
          opacity:     0.8,
        }}
      >
        {expanded ? 'Sembunyikan ↑' : 'Lihat selengkapnya →'}
      </button>
    </div>
  );
}
