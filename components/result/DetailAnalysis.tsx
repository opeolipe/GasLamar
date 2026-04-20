import { useRef }  from 'react';
import Tooltip      from '@/components/result/Tooltip';

interface Props {
  strengths?:  string[];
  hr7Data?:    { kuat: string[]; diabaikan: string[] };
}

export default function DetailAnalysis({ strengths = [], hr7Data }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function handleToggle() {
    if (detailsRef.current?.open) {
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  const hasStrengths = strengths.length > 0;
  const hasHr7       = hr7Data && (hr7Data.kuat.length > 0 || hr7Data.diabaikan.length > 0);
  const hasAny       = hasStrengths || hasHr7;
  if (!hasAny) return null;

  return (
    <details
      ref={detailsRef}
      onToggle={handleToggle}
      style={{ background: 'white', borderRadius: 24, border: '1px solid #EEF2F6', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', marginBottom: '2rem', overflow: 'hidden' }}
    >
      <summary style={{ padding: '1rem 1.5rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: '#374151', listStyle: 'none', display: 'flex', alignItems: 'center', userSelect: 'none' }}>
        📋 Lihat detail (strength &amp; HR view)
        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#9CA3AF' }}>▼</span>
      </summary>

      <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Strengths */}
        {hasStrengths && (
          <div style={{ background: '#FAFCFE', borderRadius: 20, padding: '1.2rem', border: '1px solid #EDF2F7' }}>
            <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
              ✅ Ini yang sudah kuat (jangan diubah)
            </h4>
            <ul style={{ paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#2D3A5E', margin: 0 }}>
              {strengths.map((s, i) => <li key={i} style={{ margin: '0.5rem 0' }}>{s}</li>)}
            </ul>
          </div>
        )}

        {/* HR 7-second view */}
        {hasHr7 && (
          <div style={{ background: 'white', borderRadius: 20, border: '1px solid #EEF2F6', padding: '1.2rem' }}>
            <h4 style={{ marginBottom: '0.75rem', fontWeight: 700, margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              👁️ Yang HR lihat dalam 7 detik
              <Tooltip text="Riset menunjukkan HR hanya melihat CV 6-7 detik sebelum memutuskan lanjut atau tidak. Ini bagian yang paling diperhatikan." />
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>✅ Diperhatikan</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.82rem', color: '#111827', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {(hr7Data!.kuat || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>⏭️ Dilewati</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.82rem', color: '#111827', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {(hr7Data!.diabaikan || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

      </div>
    </details>
  );
}
