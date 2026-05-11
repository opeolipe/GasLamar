interface Props { redFlags: string[] }

export default function RedFlags({ redFlags }: Props) {
  if (!redFlags.length) return null;

  return (
    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 14, padding: '0.9rem 1.1rem', marginBottom: '1rem' }}>
      <h4 style={{ color: '#92400E', fontSize: '0.875rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
        Yang mungkin bikin recruiter bertanya
      </h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.855rem', color: '#78350F', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {redFlags.map((f, i) => (
          <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true">⚠️</span>
            <span style={{ lineHeight: 1.5, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              {f}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
