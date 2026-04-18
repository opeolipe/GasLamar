import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const VALUE_PROPS = [
  { emoji: "🎯", title: "Disesuaikan dengan job", desc: "Bukan saran umum — setiap analisis berdasarkan lowongan yang kamu lamar" },
  { emoji: "🌍", title: "CV bilingual siap kirim", desc: "Bahasa Indonesia & Inggris dalam satu flow — siap untuk lokal & multinational" },
  { emoji: "⚡", title: "Langsung diperbaiki", desc: "Tidak perlu edit manual — langsung dapat versi CV yang lebih kuat" },
];

interface Feature { text: string; included: boolean }
interface Tier {
  name: string;
  price: string;
  badge: string;
  href: string;
  features: Feature[];
  featured?: boolean;
  popular?: boolean;
}

const TIERS: Tier[] = [
  {
    name: "Coba Dulu",
    price: "Rp 29.000",
    badge: "Rp 29k / CV",
    href: "upload.html?tier=coba",
    features: [
      { text: "CV tailored Bahasa Indonesia", included: true },
      { text: "Skor match + gap analysis", included: true },
      { text: "Download DOCX + PDF", included: true },
      { text: "Bahasa Inggris", included: false },
    ],
  },
  {
    name: "Single",
    price: "Rp 59.000",
    badge: "Rp 59k / CV bilingual",
    href: "upload.html?tier=single",
    features: [
      { text: "CV tailored Bahasa Indonesia", included: true },
      { text: "CV tailored Bahasa Inggris", included: true },
      { text: "Skor match + gap analysis", included: true },
      { text: "DOCX + PDF (4 file)", included: true },
    ],
  },
  {
    name: "3-Pack",
    price: "Rp 149.000",
    badge: "~Rp 50k / CV · hemat 16%",
    href: "upload.html?tier=3pack",
    featured: true,
    popular: true,
    features: [
      { text: "3 CV tailored (ID + EN)", included: true },
      { text: "Skor match + gap analysis", included: true },
      { text: "DOCX + PDF per CV (4 file)", included: true },
      { text: "Hemat Rp 28.000 vs Single", included: true },
    ],
  },
  {
    name: "Job Hunt Pack",
    price: "Rp 299.000",
    badge: "~Rp 30k / CV · hemat 49%",
    href: "upload.html?tier=jobhunt",
    features: [
      { text: "10 CV tailored (ID + EN)", included: true },
      { text: "Skor match + gap analysis", included: true },
      { text: "DOCX + PDF per CV (4 file)", included: true },
      { text: "Hemat Rp 291.000 vs Single", included: true },
    ],
  },
];

const FLOW_STEPS = ["Upload CV", "Analisis gratis", "Bayar kalau mau"];

export default function PricingSection() {
  return (
    <section className="py-12">
      {/* Value props */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16">
        {VALUE_PROPS.map((vp) => (
          <div key={vp.title} className="bg-white border border-slate-100 rounded-2xl p-5 text-center shadow-sm">
            <div className="text-3xl mb-2">{vp.emoji}</div>
            <h3 className="font-bold text-base mb-1">{vp.title}</h3>
            <p className="text-sm text-slate-500">{vp.desc}</p>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="text-center mb-8">
        <span className="inline-block border border-slate-200 rounded-full px-3 py-0.5 text-xs font-bold tracking-widest text-slate-500 uppercase mb-4">
          Harga
        </span>
        <h2 className="text-3xl font-extrabold tracking-tight mb-2">
          Perbaiki CV kamu — baru bayar kalau mau pakai
        </h2>
        <p className="text-slate-500">Lihat dulu hasil analisisnya, lalu putuskan</p>
      </div>

      {/* Flow steps */}
      <div className="flex items-center justify-center flex-wrap gap-2 text-sm mb-10" role="list" aria-label="Alur penggunaan">
        {FLOW_STEPS.map((step, i) => (
          <span key={step} className="flex items-center gap-2" role="listitem">
            <span className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full px-3 py-1 font-semibold text-slate-700">
              <span className="w-4 h-4 bg-slate-900 text-white rounded-full text-[10px] font-bold inline-flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              {step}
            </span>
            {i < FLOW_STEPS.length - 1 && <span className="text-slate-300" aria-hidden="true">→</span>}
          </span>
        ))}
      </div>

      {/* Pricing cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {TIERS.map((tier) => (
          <Card
            key={tier.name}
            className={`relative flex flex-col ${
              tier.featured ? "bg-blue-700 text-white border-0 shadow-lg" : "bg-white"
            }`}
          >
            {tier.popular && (
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-xs font-bold px-3 py-0.5 rounded-full whitespace-nowrap">
                Paling Populer
              </span>
            )}
            <CardHeader className="pb-2">
              <CardTitle className={`text-base ${tier.featured ? "text-white" : ""}`}>
                {tier.name}
              </CardTitle>
              <p className={`text-2xl font-extrabold tracking-tight ${tier.featured ? "text-white" : "text-slate-900"}`}>
                {tier.price}
              </p>
              <span className="inline-block bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded-full w-fit">
                {tier.badge}
              </span>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <ul className="space-y-2 text-sm mb-6 flex-1">
                {tier.features.map((f) => (
                  <li key={f.text} className={`flex items-start gap-2 ${!f.included ? "opacity-40" : ""}`}>
                    {f.included
                      ? <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      : <Minus className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    }
                    <span className={tier.featured && f.included ? "text-white/90" : ""}>{f.text}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant={tier.featured ? "secondary" : "outline"}
                className={`w-full rounded-xl font-bold ${
                  tier.featured
                    ? "bg-white text-blue-700 hover:bg-white/90"
                    : "border-blue-700 text-blue-700 hover:bg-blue-50"
                }`}
              >
                <a href={tier.href}>Gunakan versi ini</a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-slate-400 mt-6">
        🔒 Pembayaran aman · Tidak perlu daftar · CV otomatis dihapus setelah 7 hari
      </p>
    </section>
  );
}
