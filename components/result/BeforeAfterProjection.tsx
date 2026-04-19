import Tooltip from '@/components/result/Tooltip';

interface Props {
  beforeScore: number;
  afterScore:  number;
}

export default function BeforeAfterProjection({ beforeScore, afterScore }: Props) {
  return (
    <div style={{ background: 'white', borderRadius: 32, boxShadow: '0 20px 35px -12px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.02)', padding: '1.25rem', border: '1px solid #EEF2F6', marginBottom: '1.5rem', textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2rem' }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>Sebelum</div>
          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#EF4444' }}>{beforeScore}%</div>
        </div>
        <div style={{ fontSize: '1.8rem', color: '#9CA3AF' }}>→</div>
        <div>
          <div style={{ fontSize: '0.72rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>Sesudah perbaikan</div>
          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#10B981' }}>{afterScore}%</div>
        </div>
      </div>
      <p style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '0.5rem', margin: '0.5rem 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        Estimasi jika semua rekomendasi di atas diikuti
        <Tooltip text="Ini estimasi — hasil aktual bergantung pada implementasi dan rekruter yang membaca CV-mu." />
      </p>
    </div>
  );
}
