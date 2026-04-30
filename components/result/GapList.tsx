import Tooltip from '@/components/result/Tooltip';

interface Props { gaps: string[] }

export default function GapList({ gaps }: Props) {
  if (!gaps.length) return null;

  const visible = gaps.slice(0, 3);

  return (
    <div style={{ background: 'rgba(248,250,252,0.8)', borderRadius: 20, padding: '1.2rem', border: '1px solid rgba(148,163,184,0.14)', marginBottom: '1.25rem' }}>
      <h4 style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, margin: '0 0 0.75rem' }}>
        ⚠️ Yang bikin HR ragu
        <Tooltip text="Gap = hal yang dicari rekruter tapi belum terlihat di CV-mu. Tambahkan ini untuk naikkan skor." />
      </h4>
      <ul style={{ paddingLeft: '1.2rem', fontSize: '0.875rem', color: '#374151', margin: 0 }}>
        {visible.map((g, i) => (
          <li key={i} style={{ margin: '0.5rem 0' }}>{g}</li>
        ))}
      </ul>
    </div>
  );
}
