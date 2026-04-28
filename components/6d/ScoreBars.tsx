import { DIM_LABELS } from '@/lib/resultUtils';

interface Props {
  dimensions: Record<string, number>;
  mode:       'preview' | 'full';
  primaryKey?: string;
}

export default function ScoreBars({ dimensions, mode, primaryKey }: Props) {
  const items = Object.entries(DIM_LABELS).map(([key, meta]) => ({
    key,
    ...meta,
    score: Math.min(10, Math.max(0, Math.round(dimensions[key] ?? 0))),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: mode === 'full' ? '1.25rem' : '0.65rem' }}>
      {items.map(({ key, label, icon, score, desc, hint }) => {
        const pct       = score * 10;
        const color     = score >= 7 ? '#10B981' : score >= 4 ? '#F59E0B' : '#EF4444';
        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>
                {icon} {label}
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 700, color, flexShrink: 0, marginLeft: 8 }}>{score}/10</span>
            </div>
            <div style={{ background: '#E5E7EB', borderRadius: 4, height: 6 }}>
              <div style={{ width: `${pct}%`, background: color, borderRadius: 4, height: 6, transition: 'width 0.6s ease' }} />
            </div>
            {mode === 'full' && (
              <div style={{ marginTop: '0.6rem', paddingLeft: '0.1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#4B5563', lineHeight: 1.65, margin: '0 0 0.3rem' }}>{desc}</p>
                <p style={{ fontSize: '0.875rem', color: '#1D4ED8', fontWeight: 500, margin: 0, lineHeight: 1.5 }}>💡 {hint}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
