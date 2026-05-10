import { TIER_CONFIG } from '@/lib/resultUtils';

const TIERS = ['coba', 'single', '3pack', 'jobhunt'] as const;

const TIER_COPY: Record<string, { outcome: string; diff: string }> = {
  coba:    { outcome: 'CV siap kirim dalam Bahasa Indonesia',  diff: 'Untuk 1 posisi' },
  single:  { outcome: 'CV bilingual ID + EN siap kirim',       diff: 'Untuk apply lebih luas, termasuk MNC' },
  '3pack': { outcome: 'Tailor CV untuk 3 posisi berbeda',      diff: '≈ Rp 50k per lamaran' },
  jobhunt: { outcome: 'Tailor CV untuk 10 posisi berbeda',     diff: '≈ Rp 30k per lamaran' },
};

const FEATURED_TIER = '3pack';

export default function PricingSection() {
  return (
    <section className="py-8">
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.25rem', color: '#0F172A' }}>
          Pilih versi CV yang ingin kamu gunakan
        </h3>
        <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '0 0 0.75rem' }}>
          Sekali bayar — langsung download CV yang sudah diperbaiki
        </p>

        <div style={{ fontSize: '0.8rem', color: '#374151', margin: '0 0 1rem', lineHeight: 1.9 }}>
          <span style={{ display: 'block' }}>Fokus 1 posisi → <strong>Bilingual</strong></span>
          <span style={{ display: 'block' }}>Apply lebih dari 1 posisi → <strong>3-Pack lebih hemat</strong></span>
        </div>

        {/* paddingTop gives room for the -11px badge pill on top-row cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
          {TIERS.map(tier => {
            const info     = TIER_CONFIG[tier];
            const copy     = TIER_COPY[tier];
            const isFeatured = tier === FEATURED_TIER;

            return (
              <a
                key={tier}
                href={`upload.html?tier=${tier}`}
                style={{
                  background:    'white',
                  borderRadius:  16,
                  padding:       '1rem',
                  textAlign:     'left',
                  border:        isFeatured
                    ? '1.5px solid #93C5FD'
                    : '1px solid #E2E8F0',
                  cursor:        'pointer',
                  position:      'relative',
                  overflow:      'visible',
                  transition:    'border-color 0.15s, box-shadow 0.15s',
                  boxShadow:     'none',
                  fontFamily:    'inherit',
                  width:         '100%',
                  minHeight:     44,
                  display:       'block',
                  textDecoration:'none',
                  color:         'inherit',
                  boxSizing:     'border-box',
                }}
              >
                {isFeatured && (
                  <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: '#2563EB', color: 'white', fontSize: '0.62rem', padding: '0.18rem 0.75rem', borderRadius: 60, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                    ✦ PALING DIPILIH
                  </div>
                )}

                {/* Stack label + price vertically so they never overflow on narrow cards */}
                <div style={{ marginBottom: '0.35rem' }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: '0.9rem', color: '#111827' }}>{info.label}</span>
                  <span style={{ display: 'block', fontSize: '1rem', fontWeight: 800, color: '#111827', marginTop: '0.1rem' }}>{info.priceStr}</span>
                </div>

                <p style={{ fontSize: '0.75rem', color: '#374151', margin: '0 0 0.3rem', lineHeight: 1.4, fontWeight: 500 }}>
                  {copy.outcome}
                </p>

                <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0, fontWeight: 500 }}>
                  {copy.diff}
                </p>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
