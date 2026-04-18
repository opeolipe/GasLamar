import { Check } from "lucide-react";

interface Tier {
  name: string;
  price: string;
  desc: string;
  features: string[];
  featured?: boolean;
  badge?: string;
}

const TIERS: Tier[] = [
  {
    name: "Coba Dulu",
    price: "Rp 29k",
    desc: "Analisis gratis dulu. Kalau lanjut rewrite, hasil aktif 7 hari.",
    features: ["Analisis awal gratis", "Gap analysis utama", "Hasil rewrite aktif 7 hari"],
  },
  {
    name: "Single",
    price: "Rp 59k",
    desc: "Analisis gratis dulu. Kalau lanjut rewrite, hasil aktif 7 hari.",
    features: ["CV tailored bilingual", "Status + 6 dimensi", "Hasil rewrite aktif 7 hari"],
  },
  {
    name: "3-Pack / Job Hunt",
    price: "Rp 149k – Rp 299k",
    desc: "Untuk lamaran lebih banyak, dengan hasil rewrite aktif 30 hari.",
    badge: "Paket banyak lamaran",
    featured: true,
    features: ["3-Pack: 3 CV tailored ID + EN", "Job Hunt: 10 CV tailored ID + EN", "Hasil rewrite aktif 30 hari"],
  },
];

const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;

export interface PricingSectionProps { onOpenUpload: () => void }

export default function PricingSection({ onOpenUpload }: PricingSectionProps) {
  return (
    <section className="py-8">
      {/* Mid-page CTA */}
      <div className="rounded-[24px] p-10 text-center mb-8" style={{ background: "rgba(255,255,255,0.84)", border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
        <h2 className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight mb-6" style={SERIF}>
          Siap tahu peluang kamu?
        </h2>
        <button
          onClick={onOpenUpload}
          className="min-h-[52px] rounded-[16px] px-[26px] py-3 text-white text-base font-bold border-0 cursor-pointer transition-all hover:-translate-y-[1px]"
          style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
        >
          Cek Peluang Saya
        </button>
      </div>

      {/* Pricing subtitle */}
      <p className="text-center text-sm text-slate-500 mb-6">
        Analisis gratis dulu. Bayar hanya kalau mau tingkatkan peluang interview.
      </p>

      {/* Pricing cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className="relative flex flex-col rounded-[20px] p-6"
            style={{
              background: tier.featured
                ? "linear-gradient(180deg,rgba(37,99,235,0.06),rgba(37,99,235,0.02))"
                : "rgba(255,255,255,0.9)",
              border: tier.featured
                ? "1px solid rgba(37,99,235,0.18)"
                : "1px solid rgba(148,163,184,0.14)",
              boxShadow: tier.featured
                ? "0 24px 56px rgba(37,99,235,0.12)"
                : SHADOW,
            }}
          >
            {tier.badge && (
              <span className="absolute -top-3.5 left-6 rounded-full text-white text-xs font-bold px-3 py-1" style={{ background: "#2563eb" }}>
                {tier.badge}
              </span>
            )}

            <div className="mb-4">
              <p className="text-sm text-slate-500 mb-1">{tier.name}</p>
              <p className="text-3xl font-extrabold tracking-tight text-slate-900">{tier.price}</p>
              <p className="text-sm text-slate-500 mt-2">{tier.desc}</p>
            </div>

            <ul className="space-y-2 text-sm mb-6 flex-1">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-slate-600">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={onOpenUpload}
              className={`w-full rounded-[14px] py-2.5 font-bold text-sm cursor-pointer transition-all hover:-translate-y-[1px] ${
                tier.featured
                  ? "text-white border-0"
                  : "bg-white text-blue-600 border border-blue-200"
              }`}
              style={tier.featured ? { background: "linear-gradient(180deg,#2563eb,#1d4ed8)" } : {}}
            >
              Coba analisis gratis
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
