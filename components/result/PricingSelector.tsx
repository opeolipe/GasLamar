import { TIER_CONFIG, tierRecommendation } from '@/lib/resultUtils';

interface Props {
  selectedTier:  string | null;
  onSelect:      (tier: string) => void;
  score?:        number;
}

const TIERS = ['coba', 'single', '3pack', 'jobhunt'] as const;

export default function PricingSelector({ selectedTier, onSelect, score }: Props) {
  const rec = score !== undefined ? tierRecommendation(score) : null;

  return (
    <div style={{ background: 'rgba(255,255,255,0.88)', borderRadius: 24, boxShadow: '0 18px 44px rgba(15,23,42,0.08)', padding: '1.5rem', border: '1px solid rgba(148,163,184,0.14)', backdropFilter: 'blur(14px)', marginBottom: '1.25rem' }}>
      <h3 style={{ textAlign: 'center', marginBottom: '0.5rem', fontSize: '1.3rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
        Pilih versi CV yang ingin kamu gunakan
      </h3>
      <p style={{ textAlign: 'center', fontSize: '0.9rem', color: '#4B5563', margin: '0 0 1rem' }}>
        Sekali bayar — langsung download CV yang sudah diperbaiki
      </p>

      {/* Tier recommendation banner */}
      {rec && (
        <div style={{ background: 'rgba(239,246,255,0.9)', border: '1px solid #BFDBFE', color: '#1E3A8A', borderRadius: 16, padding: '1rem 1.2rem', margin: '1rem 0', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>💡</span>
            <p style={{ margin: 0, color: '#1E3A8A' }}>
              <span dangerouslySetInnerHTML={{ __html: rec.msg }} />
              {' '}
              <button
                onClick={() => onSelect(rec.tier)}
                style={{ marginLeft: 4, textDecoration: 'underline', fontWeight: 600, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0 }}
              >
                Pilih →
              </button>
            </p>
          </div>
        </div>
      )}

      {/* Pricing grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem', margin: '1.5rem 0 0' }}>
        {TIERS.map(tier => {
          const info     = TIER_CONFIG[tier];
          const selected = selectedTier === tier;
          const popular  = tier === '3pack';

          return (
            <button
              key={tier}
              onClick={() => onSelect(tier)}
              style={{
                background:   selected ? '#F8FAFC' : 'white',
                borderRadius: 24,
                padding:      '1.2rem',
                textAlign:    'center',
                border:       selected
                  ? '2px solid #2563eb'
                  : popular
                  ? '1.5px solid #CBD5E1'
                  : '1px solid rgba(148,163,184,0.20)',
                cursor:       'pointer',
                position:     'relative',
                transition:   '0.2s',
                boxShadow:    selected ? '0 0 0 3px rgba(37,99,235,0.12)' : 'none',
                fontFamily:   'inherit',
                width:        '100%',
              }}
            >
              {popular && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', color: 'white', fontSize: '0.65rem', padding: '0.2rem 0.8rem', borderRadius: 60, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  ⭐ PALING LARIS
                </div>
              )}
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#111827' }}>{info.label}</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0.5rem 0', color: '#111827' }}>{info.priceStr}</div>
              <div style={{ fontSize: '0.7rem', color: '#5B6E8C', margin: '0.5rem 0' }}>{info.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
