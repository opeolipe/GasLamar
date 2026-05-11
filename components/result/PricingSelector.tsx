import { TIER_CONFIG, tierRecommendation } from '@/lib/resultUtils';

interface Props {
  selectedTier:  string | null;
  onSelect:      (tier: string) => void;
  score?:        number;
  hasError?:     boolean;
}

const TIERS = ['coba', 'single', '3pack', 'jobhunt'] as const;

const TIER_COPY: Record<string, { outcome: string; diff: string }> = {
  coba:     { outcome: 'CV siap kirim dalam Bahasa Indonesia',  diff: 'Untuk 1 posisi' },
  single:   { outcome: 'CV bilingual ID + EN siap kirim',        diff: 'Untuk apply lebih luas, termasuk MNC' },
  '3pack':  { outcome: 'Tailor CV untuk 3 posisi berbeda',       diff: '≈ Rp 50k per lamaran' },
  jobhunt:  { outcome: 'Tailor CV untuk 10 posisi berbeda',      diff: '≈ Rp 30k per lamaran' },
};

export default function PricingSelector({ selectedTier, onSelect, score, hasError }: Props) {
  const rec = score !== undefined ? tierRecommendation(score) : null;

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.25rem', color: '#0F172A' }}>
        Pilih versi CV yang ingin kamu gunakan
      </h3>
      <p style={{ fontSize: '0.8rem', color: '#64748B', margin: '0.15rem 0 0', textAlign: 'center' }}>
        1 posisi → Bilingual &nbsp;·&nbsp; 3+ posisi → 3-Pack lebih hemat
      </p>

      {/* Pricing grid */}
      <div id="tier-grid" className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '1rem', margin: '1.5rem 0 0', borderRadius: 16, outline: hasError ? '2px solid #EF4444' : 'none', outlineOffset: 4 }}>
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
                boxShadow:    selected
                  ? '0 0 0 3px rgba(37,99,235,0.12)'
                  : isRec
                  ? '0 6px 18px rgba(37,99,235,0.10)'
                  : 'none',
                fontFamily:   'inherit',
                width:        '100%',
                transform:    isRec && !selected ? 'scale(1.02)' : 'none',
                overflow:     'visible',
                transition:   '0.2s',
                minHeight:    44,
              }}
            >
              {(isRec || selected) && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: '#2563EB', color: 'white', fontSize: '0.62rem', padding: '0.18rem 0.75rem', borderRadius: 60, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                  {selected ? '✦ DIPILIH' : '✦ PALING COCOK'}
                </div>
              )}

              {/* Stack label + price vertically so they never overflow on narrow cards */}
              <div style={{ marginBottom: '0.35rem' }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '0.9rem', color: '#111827' }}>{info.label}</span>
                <span style={{ display: 'block', fontSize: '1rem', fontWeight: 800, color: selected ? '#1D4ED8' : '#111827', marginTop: '0.1rem' }}>{info.priceStr}</span>
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
