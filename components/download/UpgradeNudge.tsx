import { useEffect } from 'react';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

interface Props {
  /** If true, show point upgrade CTA to one tier above current package */
  showUpsell?: boolean;
  tier?: string;
  expiresAt?: number | null;
}

const NEXT_TIER: Record<string, { tier: string; label: string; price: string; valueLine: string; estSave: string }> = {
  coba: {
    tier: 'single',
    label: 'Single',
    price: 'Rp 59.000',
    valueLine: '1 CV bilingual (ID + EN) siap kirim.',
    estSave: 'Langsung unlock CV bilingual untuk lamaran prioritasmu.',
  },
  single: {
    tier: '3pack',
    label: '3-Pack',
    price: 'Rp 149.000',
    valueLine: '3 CV bilingual yang masing-masing di-tailor.',
    estSave: 'Hemat 40% dibanding beli satuan.',
  },
  '3pack': {
    tier: 'jobhunt',
    label: 'Job Hunt Pack',
    price: 'Rp 299.000',
    valueLine: '10 CV bilingual untuk dorong apply lebih konsisten.',
    estSave: 'Paling efisien untuk apply banyak posisi.',
  },
};

function getVariant(key: string, values: string[]): { value: string; isNew: boolean } {
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && values.includes(existing)) return { value: existing, isNew: false };
    const pick = values[Math.floor(Math.random() * values.length)];
    sessionStorage.setItem(key, pick);
    return { value: pick, isNew: true };
  } catch {
    return { value: values[0], isNew: false };
  }
}

export default function UpgradeNudge({ showUpsell = false, tier, expiresAt }: Props) {
  const nextTier = tier ? NEXT_TIER[tier] : null;
  const headlineVariant = getVariant('gaslamar_upsell_headline', ['hemat', 'cepat']);
  const ctaVariant = getVariant('gaslamar_upsell_cta', ['upgrade', 'lanjut']);
  const expiryDateStr = expiresAt && expiresAt > Date.now()
    ? new Date(expiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const analyticsPayload = {
    from_tier: tier ?? null,
    to_tier: nextTier?.tier ?? null,
    headline_variant: headlineVariant.value,
    cta_variant: ctaVariant.value,
    source: 'download_footer',
  };

  useEffect(() => {
    if (!showUpsell) return;
    if (headlineVariant.isNew || ctaVariant.isNew) {
      (window as any).Analytics?.track?.('upsell_variant_assigned', analyticsPayload);
    }
    (window as any).Analytics?.track?.('upsell_impression', analyticsPayload);
  }, [showUpsell, headlineVariant.isNew, ctaVariant.isNew, analyticsPayload.from_tier, analyticsPayload.to_tier, analyticsPayload.headline_variant, analyticsPayload.cta_variant]);

  if (showUpsell) {
    const headline = (() => {
      if (headlineVariant.value === 'cepat') {
        if (tier === 'coba') return 'Lanjut apply cepat dengan CV bilingual';
        if (tier === 'single') return 'Lanjut apply ke beberapa posisi minggu ini';
        if (tier === '3pack') return 'Dorong momentum apply dengan kuota lebih panjang';
        return 'Lanjut apply lebih banyak minggu ini';
      }
      if (tier === 'coba') return 'Upgrade ke Single untuk unlock CV bilingual';
      if (tier === 'single') return 'Naik ke 3-Pack biar lebih hemat per lamaran';
      if (tier === '3pack') return 'Naik ke Job Hunt Pack untuk volume apply lebih besar';
      return `Naik ke ${nextTier?.label ?? 'paket berikutnya'} biar lebih hemat`;
    })();
    const ctaText = ctaVariant.value === 'upgrade'
      ? `Naik ke ${nextTier?.label ?? 'Paket Berikutnya'}`
      : `Lanjut Apply dengan ${nextTier?.label ?? 'Paket Berikutnya'}`;
    const bodyLead = (() => {
      if (tier === 'coba') return 'Paket Coba Dulu kamu sudah terpakai.';
      if (tier === 'single') return 'CV pertama sudah beres dan siap kirim.';
      if (tier === '3pack') return 'Semua kredit 3-Pack sudah terpakai.';
      return 'Kredit paket kamu sudah habis.';
    })();

    return (
      <div
        className="rounded-[24px] p-6 text-center"
        style={{
          background: 'rgba(37,99,235,0.05)',
          border:     '1.5px solid rgba(37,99,235,0.18)',
        }}
      >
        <div className="text-sm font-bold inline-block px-3 py-1 rounded-full mb-4" style={{ background: '#FEF3C7', color: '#92400E' }}>
          <span aria-hidden="true">💰</span> Paket kamu habis · saatnya lanjut apply
        </div>
        <h3 className="text-base font-semibold text-slate-900 mb-2"><span aria-hidden="true">🎯</span> {headline}</h3>
        <p className="text-sm text-blue-700 mb-5">
          {bodyLead} <strong>{nextTier?.label ?? 'Paket berikutnya'}</strong> — {nextTier?.price ?? ''} · {nextTier?.valueLine ?? ''}<br />
          {nextTier?.estSave ?? 'Pilih paket yang sesuai target apply kamu.'}
        </p>
        <a
          href={`upload.html?new_package=1${nextTier ? `&tier=${encodeURIComponent(nextTier.tier)}` : ''}`}
          className="inline-flex items-center min-h-[44px] px-8 rounded-full font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
          style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          title={`Mulai analisis CV baru dengan paket ${nextTier?.label ?? 'berikutnya'}`}
          onClick={() => (window as any).Analytics?.track?.('upsell_click', analyticsPayload)}
        >
          {ctaText} →
        </a>
        {expiryDateStr && (
          <p className="text-xs text-blue-600 mt-3 mb-0">
            Akses link saat ini aktif sampai {expiryDateStr}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-[24px] p-6 text-center"
      style={{
        background:     'rgba(255,255,255,0.88)',
        border:         '1px solid rgba(148,163,184,0.14)',
        boxShadow:      SHADOW,
        backdropFilter: 'blur(14px)',
      }}
    >
      <div className="text-3xl mb-3" aria-hidden="true">🎉</div>
      <h3 className="font-semibold text-slate-900 mb-2" style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>Semua kredit sudah terpakai!</h3>
      <p className="text-sm text-slate-500 mb-5">
        Kredit kamu sudah habis. Masih ada loker lain yang ingin kamu lamar? Beli paket baru untuk CV yang disesuaikan.
      </p>
      <a
        href={`upload.html?new_package=1${tier ? `&tier=${encodeURIComponent(tier)}` : ''}`}
        className="inline-flex items-center min-h-[44px] px-6 rounded-full font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
        style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
        title="Beli paket baru untuk loker lain"
      >
        Beli Paket untuk Loker Baru
      </a>
      <p className="text-sm text-slate-400 mt-3">Bisa pakai CV yang sama atau upload CV yang sudah diperbarui</p>
    </div>
  );
}
