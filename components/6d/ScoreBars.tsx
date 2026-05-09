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
    <div style={{ display: 'flex', flexDirection: 'column', gap: mode === 'full' ? '1.1rem' : '0.75rem' }}>
      {items.map(({ key, label, icon, score, desc, hint }) => {
        const pct      = score * 10;
        // Only flag truly weak scores — neutral gray for everything else
        const isWeak   = score < 4;
        const barColor = isWeak ? '#F87171' : '#94A3B8';
        const numColor = isWeak ? '#DC2626' : '#6B7280';
        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>
                {label}
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: numColor, flexShrink: 0, marginLeft: 8 }}>{score}/10</span>
            </div>
            <div style={{ background: '#F1F5F9', borderRadius: 3, height: 5 }}>
              <div style={{ width: `${pct}%`, background: barColor, borderRadius: 3, height: 5, transition: 'width 0.7s cubic-bezier(0.22,1,0.36,1)' }} />
            </div>
            {mode === 'full' && (
              <div style={{ marginTop: '0.5rem' }}>
                <p style={{ fontSize: '0.8rem', color: '#64748B', lineHeight: 1.6, margin: '0 0 0.25rem' }}>{desc}</p>
                <p style={{ fontSize: '0.8rem', color: '#2563EB', fontWeight: 500, margin: 0, lineHeight: 1.5 }}>💡 {hint}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
