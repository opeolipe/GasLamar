import { TIER_CONFIG, tierRecommendation } from '@/lib/resultUtils';

interface Props {
  selectedTier:  string | null;
  onSelect:      (tier: string) => void;
  score?:        number;
}

const TIERS = ['coba', 'single', '3pack', 'jobhunt'] as const;

const TIER_COPY: Record<string, { outcome: string; diff: string }> = {
  coba:     { outcome: 'CV siap kirim dalam Bahasa Indonesia',  diff: 'Download DOCX & PDF' },
  single:   { outcome: 'CV bilingual ID + EN siap kirim',        diff: 'Untuk apply lebih luas, termasuk MNC' },
  '3pack':  { outcome: 'Tailor CV untuk 3 posisi berbeda',       diff: '≈ Rp 50k per lamaran' },
  jobhunt:  { outcome: 'Tailor CV untuk 10 posisi berbeda',      diff: '≈ Rp 30k per lamaran' },
};

export default function PricingSelector({ selectedTier, onSelect, score }: Props) {
  const rec = score !== undefined ? tierRecommendation(score) : null;

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.25rem', color: '#0F172A' }}>
        Pilih versi CV yang ingin kamu gunakan
      </h3>
      <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '0 0 0.75rem' }}>
        Sekali bayar — langsung download CV yang sudah diperbaiki
      </p>

      {rec && (
        <p style={{ fontSize: '0.8rem', color: '#2563EB', margin: '0 0 1rem', fontWeight: 500 }}>
          💡 Kami rekomendasikan{' '}
          <button
            onClick={() => onSelect(rec.tier)}
            style={{ fontWeight: 700, background: 'none', border: 'none', color: '#2563EB', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0, textDecoration: 'underline' }}
          >
            {TIER_CONFIG[rec.tier].label}
          </button>
          {' '}untuk kamu. Fokus 1 posisi → Single. Apply banyak → 3‑Pack.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
        {TIERS.map(tier => {
          const info     = TIER_CONFIG[tier];
          const copy     = TIER_COPY[tier];
          const selected = selectedTier === tier;
          const isRec    = rec?.tier === tier;

          return (
            <button
              key={tier}
              data-testid="pricing-card"
              onClick={() => onSelect(tier)}
              style={{
                background:   selected ? '#EFF6FF' : 'white',
                borderRadius: 16,
                padding:      '1rem',
                textAlign:    'left',
                border:       selected
                  ? '2px solid #2563eb'
                  : isRec
                  ? '1.5px solid #93C5FD'
                  : '1px solid #E2E8F0',
                cursor:       'pointer',
                position:     'relative',
                transition:   'border-color 0.15s, box-shadow 0.15s',
                boxShadow:    selected ? '0 0 0 3px rgba(37,99,235,0.10)' : 'none',
                fontFamily:   'inherit',
                width:        '100%',
              }}
            >
              {(isRec || selected) && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: '#2563EB', color: 'white', fontSize: '0.62rem', padding: '0.18rem 0.75rem', borderRadius: 60, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                  {selected ? '✦ DIPILIH' : '✦ REKOMENDASI'}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#111827' }}>{info.label}</span>
                <span style={{ fontSize: '1rem', fontWeight: 800, color: selected ? '#1D4ED8' : '#111827', whiteSpace: 'nowrap', marginLeft: 6 }}>{info.priceStr}</span>
              </div>

              <p style={{ fontSize: '0.75rem', color: selected ? '#1E40AF' : '#374151', margin: '0 0 0.3rem', lineHeight: 1.4, fontWeight: 500 }}>
                {copy.outcome}
              </p>

              <p style={{ fontSize: '0.72rem', color: selected ? '#3B82F6' : '#94A3B8', margin: 0, fontWeight: 500 }}>
                {copy.diff}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
