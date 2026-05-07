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
    desc: "Rewrite 1 posisi dalam Bahasa Indonesia. Hasil aktif 7 hari.",
    features: ["Gap analysis utama", "Rewrite 1 CV (Bahasa Indonesia)", "Hasil aktif 7 hari"],
  },
  {
    name: "Single",
    price: "Rp 59k",
    desc: "Rewrite 1 posisi, versi ID + EN. Hasil aktif 7 hari.",
    features: ["Perbaikan 8 bagian utama CV", "Rewrite langsung dari CV kamu (bukan template)", "Versi ID + EN", "Siap kirim ke HR (ATS-friendly)"],
  },
  {
    name: "3-Pack",
    price: "Rp 149k",
    desc: "Untuk 3 posisi berbeda, dengan hasil rewrite aktif 30 hari.",
    badge: "Paling dipilih",
    featured: true,
    features: ["3 CV tailored ID + EN", "Rewrite langsung dari CV kamu (bukan template)", "Siap kirim ke HR (ATS-friendly)"],
  },
  {
    name: "Job Hunt Pack",
    price: "Rp 299k",
    desc: "Untuk job hunt intensif, dengan hasil rewrite aktif 30 hari.",
    features: ["10 CV tailored ID + EN", "Rewrite langsung dari CV kamu (bukan template)", "Siap kirim ke HR (ATS-friendly)"],
  },
];

const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;

export default function PricingSection() {
  return (
    <section className="py-8">
      {/* Mid-page CTA */}
      <div className="rounded-[24px] p-5 sm:p-10 text-center mb-8" style={{ background: "rgba(255,255,255,0.84)", border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
        <h2 className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight mb-6" style={SERIF}>
          Siap tahu peluang kamu?
        </h2>
        <a
          href="upload.html"
          className="inline-flex items-center justify-center min-h-[52px] rounded-[16px] px-[26px] py-3 text-white text-base font-bold no-underline transition-all hover:-translate-y-[1px]"
          style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
        >
          Cek Peluang Saya
        </a>
      </div>

      {/* Pricing subtitle */}
      <p className="text-center text-sm text-slate-500 mb-4">
        Analisis gratis dulu. Bayar hanya kalau mau tingkatkan peluang interview.
      </p>

      {/* Guided decision copy */}
      <p className="text-sm sm:text-base text-slate-600 text-center mb-6 px-2">
        Kalau kamu fokus 1 posisi → pilih Single. Kalau apply ke beberapa posisi → pilih 3‑Pack.
      </p>

      {/* Pricing cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`relative flex flex-col rounded-[20px] p-4 sm:p-6 ${tier.featured ? "scale-[1.02]" : ""}`}
            style={{
              background: tier.featured
                ? "linear-gradient(180deg,rgba(37,99,235,0.06),rgba(37,99,235,0.02))"
                : "rgba(255,255,255,0.9)",
              border: tier.featured
                ? "2px solid #93C5FD"
                : "1px solid rgba(148,163,184,0.14)",
              boxShadow: tier.featured
                ? "0 24px 56px rgba(37,99,235,0.12)"
                : SHADOW,
            }}
          >
            {tier.badge && (
              <span className="absolute -top-1 left-6 rounded-full text-sm font-bold px-3 py-1 bg-amber-100 text-amber-900">
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

            <a
              href="upload.html"
              className={`w-full rounded-[14px] min-h-[44px] py-2.5 font-bold text-sm no-underline flex items-center justify-center transition-all hover:-translate-y-[1px] ${
                tier.featured
                  ? "text-white border-0"
                  : "bg-white text-blue-700 border border-blue-200"
              }`}
              style={tier.featured ? { background: "linear-gradient(180deg,#2563eb,#1d4ed8)" } : {}}
            >
              {tier.featured ? "Mulai 3-Pack" : "Coba gratis dulu"}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
