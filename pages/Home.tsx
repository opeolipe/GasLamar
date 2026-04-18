import { useState } from "react";
import HeroUpload from "@/components/blocks/HeroUpload";
import ResultPreview from "@/components/blocks/ResultPreview";
import PricingSection from "@/components/blocks/PricingSection";
import FaqSection from "@/components/blocks/FaqSection";
import FooterSection from "@/components/blocks/FooterSection";

const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";

const HOW_STEPS = [
  { n: "1", title: "Upload CV kamu", desc: "PDF atau DOCX — tidak disimpan, diproses lokal di browser." },
  { n: "2", title: "Analisis 6 Dimensi", desc: "AI membaca kesesuaian, daya tarik, kesiapan, usaha, relevansi skill, dan bukti kerja." },
  { n: "3", title: "Tahu peluang kamu", desc: "Dapat verdict instan: Gas lamar sekarang, TIMED, atau Skip dulu." },
];

const BENEFITS = [
  { emoji: "🎯", title: "Disesuaikan dengan job", desc: "Bukan saran umum — setiap analisis berdasarkan lowongan yang kamu lamar." },
  { emoji: "🌍", title: "CV bilingual siap kirim", desc: "Bahasa Indonesia & Inggris dalam satu flow — siap untuk lokal & multinational." },
  { emoji: "⚡", title: "Langsung diperbaiki", desc: "Tidak perlu edit manual — langsung dapat versi CV yang lebih kuat." },
];

export default function Home() {
  const [isDesktopOpen, setIsDesktopOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  function openUpload() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setIsMobileOpen(true);
    } else {
      setIsDesktopOpen(true);
    }
  }
  function closeUpload() { setIsDesktopOpen(false); setIsMobileOpen(false); }

  return (
    <div className="min-h-screen text-gray-900 font-sans" style={{ background: "radial-gradient(ellipse 80% 50% at 50% -20%,rgba(37,99,235,0.08),transparent)" }}>
      {/* Navbar */}
      <nav className="border-b py-4 px-6 flex items-center justify-between sticky top-0 z-50 backdrop-blur-[14px]" style={{ borderColor: "rgba(148,163,184,0.18)", background: "rgba(255,255,255,0.88)" }}>
        <a href="index.html" className="font-extrabold text-lg text-slate-900 no-underline tracking-tight">
          GasLamar
        </a>
        <button
          onClick={openUpload}
          className="inline-flex items-center text-white font-semibold text-sm px-5 py-2 rounded-full cursor-pointer border-0 transition-all hover:-translate-y-[1px]"
          style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
        >
          Cek CV Saya →
        </button>
      </nav>

      <main className="max-w-screen-xl mx-auto px-6">
        {/* Hero */}
        <section className="py-12 lg:py-16">
          <HeroUpload
            isDesktopOpen={isDesktopOpen}
            isMobileOpen={isMobileOpen}
            onOpen={openUpload}
            onClose={closeUpload}
          />
        </section>

        {/* Trust strip */}
        <p className="text-center text-[13px] text-slate-400 -mt-4 mb-12">
          🔒 CV tidak disimpan &nbsp;·&nbsp; tanpa registrasi &nbsp;·&nbsp; hasil dalam ±30 detik
        </p>

        {/* How it works */}
        <section className="py-8 mb-4">
          <div className="text-center mb-10">
            <span className="inline-block border border-slate-200 rounded-full px-3 py-0.5 text-xs font-bold tracking-widest text-slate-500 uppercase mb-4">
              Cara kerja
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight">3 langkah, hasil dalam 30 detik</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {HOW_STEPS.map((s) => (
              <div key={s.n} className="rounded-[20px] p-6 text-center" style={{ background: "rgba(255,255,255,0.84)", border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
                <div className="mx-auto mb-4 w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-white text-base" style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)" }}>
                  {s.n}
                </div>
                <h3 className="font-bold text-base mb-1">{s.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Result preview */}
        <ResultPreview onOpenUpload={openUpload} />

        {/* Benefits */}
        <section className="py-8">
          <div className="text-center mb-8">
            <span className="inline-block border border-slate-200 rounded-full px-3 py-0.5 text-xs font-bold tracking-widest text-slate-500 uppercase mb-4">
              Keuntungan
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight">Bukan CV checker biasa</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {BENEFITS.map((b) => (
              <div key={b.title} className="rounded-[20px] p-5 text-center" style={{ background: "rgba(255,255,255,0.84)", border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
                <div className="text-3xl mb-2">{b.emoji}</div>
                <h3 className="font-bold text-base mb-1">{b.title}</h3>
                <p className="text-sm text-slate-500">{b.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <PricingSection onOpenUpload={openUpload} />

        {/* Bottom CTA */}
        <section className="my-4 mb-12 rounded-[24px] p-10 text-center" style={{ background: "rgba(255,255,255,0.84)", border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
          <h2 className="text-2xl font-extrabold tracking-tight mb-3">
            Siap tahu peluang kamu?
          </h2>
          <p className="text-slate-500 mb-6">
            Upload CV + job description. Tahu status interview kamu dalam 30 detik.
          </p>
          <button
            onClick={openUpload}
            className="min-h-[56px] rounded-[16px] px-[26px] py-4 text-white text-base font-bold border-0 cursor-pointer transition-all hover:-translate-y-[1px]"
            style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
          >
            👉 Cek Peluang Saya Sekarang
          </button>
          <p className="text-xs text-slate-400 mt-3">
            Tanpa daftar &nbsp;·&nbsp; Proses ±30 detik
          </p>
        </section>

        {/* FAQ */}
        <FaqSection />
      </main>

      <FooterSection />
    </div>
  );
}
