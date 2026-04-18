import Tooltip from '@/components/result/Tooltip';

interface Props { gaps: string[] }

export default function GapList({ gaps }: Props) {
  if (!gaps.length) return null;

  const visible = gaps.slice(0, 3);

  return (
    <div style={{ background: '#FAFCFE', borderRadius: 20, padding: '1.2rem', border: '1px solid #EDF2F7', marginBottom: '1.5rem' }}>
      <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, margin: '0 0 0.75rem' }}>
        ⚠️ Yang bikin HR ragu
        <Tooltip text="Gap = hal yang dicari rekruter tapi belum terlihat di CV-mu. Tambahkan ini untuk naikkan skor." />
      </h4>
      <ul style={{ paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#2D3A5E', margin: 0 }}>
        {visible.map((g, i) => (
          <li key={i} style={{ margin: '0.5rem 0' }}>{g}</li>
        ))}
      </ul>
    </div>
  );
}
