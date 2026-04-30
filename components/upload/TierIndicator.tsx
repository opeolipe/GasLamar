import { VALID_TIERS, TIER_DISPLAY, type ValidTier } from '@/lib/uploadValidation';

interface Props { tier: string | null }

const TIER_CLS: Record<ValidTier, string> = {
  coba:    'bg-amber-50 border-amber-200 text-amber-800',
  single:  'bg-blue-50 border-blue-200 text-blue-800',
  '3pack': 'bg-blue-50 border-blue-200 text-blue-800',
  jobhunt: 'bg-emerald-50 border-emerald-200 text-emerald-800',
};

export default function TierIndicator({ tier }: Props) {
  if (!tier || !(VALID_TIERS as readonly string[]).includes(tier)) return null;
  const t  = tier as ValidTier;
  const td = TIER_DISPLAY[t];
  return (
    <div className="mb-4">
      <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border ${TIER_CLS[t]}`}>
        {td.icon}&nbsp;Paket kamu: {td.name} — {td.desc}
      </div>
      <p className="text-sm text-slate-400 mt-1">
        Analisis gratis dulu — konfirmasi dan bayar setelah lihat hasilnya.
      </p>
    </div>
  );
}
