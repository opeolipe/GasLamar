import { useState } from "react";
import HeroUpload from "@/components/blocks/HeroUpload";
import ResultPreview from "@/components/blocks/ResultPreview";
import PricingSection from "@/components/blocks/PricingSection";
import FaqSection from "@/components/blocks/FaqSection";
import FooterSection from "@/components/blocks/FooterSection";

const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;

const HOW_STEPS = [
  { n: "1", title: "Upload CV", bg: "rgba(37,99,235,0.08)", color: "#2563eb" },
  { n: "2", title: "Analisis otomatis", bg: "rgba(245,158,11,0.08)", color: "#d97706" },
  { n: "3", title: "Dapat status + perbaikan", bg: "rgba(16,185,129,0.08)", color: "#059669" },
];

const BENEFITS = [
  { title: "Disesuaikan dengan job", desc: "Setiap CV dibaca terhadap lowongan yang kamu incar." },
  { title: "CV bilingual", desc: "Tetap siap untuk perusahaan lokal dan multinasional." },
  { title: "Langsung diperbaiki", desc: "Gap utama langsung diubah jadi bullet yang lebih kuat." },
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
          className="inline-flex items-center text-white font-bold text-sm px-5 py-2 rounded-full cursor-pointer border-0 transition-all hover:-translate-y-[1px]"
          style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
        >
          Cek Peluang Saya
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

        {/* Result preview */}
        <ResultPreview onOpenUpload={openUpload} />

        {/* How it works */}
        <section className="py-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">Cara kerja</p>
          <h2 className="text-[clamp(1.8rem,3.5vw,2.8rem)] font-semibold leading-tight mb-8" style={SERIF}>
            Cepat, jelas, langsung ke status peluang
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {HOW_STEPS.map((s) => (
              <div key={s.n} className="rounded-[20px] p-6 bg-white" style={{ border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
                <div className="mb-4 w-10 h-10 rounded-full flex items-center justify-center font-bold text-base" style={{ background: s.bg, color: s.color }}>
                  {s.n}
                </div>
                <p className="font-semibold text-slate-800">{s.title}</p>
              </div>
            ))}
          </div>

          {/* Benefits */}
          <div className="mt-16">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">Keuntungan</p>
            <h2 className="text-[clamp(1.8rem,3.5vw,2.8rem)] font-semibold leading-tight mb-8" style={SERIF}>
              Bukan sekadar cocok kata kunci
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {BENEFITS.map((b) => (
                <div key={b.title} className="rounded-[20px] p-6 bg-white" style={{ border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
                  <h3 className="font-semibold text-slate-800 mb-2">{b.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Privacy trust strip */}
          <p className="text-center text-[13px] text-slate-400 mt-10">
            Privasi &amp; akses: &nbsp;•&nbsp; CV tidak disimpan &nbsp;•&nbsp; Tanpa registrasi &nbsp;•&nbsp; Preview aktif 2 jam &nbsp;•&nbsp; Rewrite aktif 7–30 hari
          </p>
        </section>

        {/* Pricing */}
        <PricingSection onOpenUpload={openUpload} />

        {/* Bottom CTA */}
        <section className="my-4 mb-12 rounded-[24px] p-10 text-center" style={{ background: "rgba(255,255,255,0.84)", border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
          <h2 className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight mb-4" style={SERIF}>
            Siap bikin CV kamu lebih kuat?
          </h2>
          <p className="text-slate-500 mb-6">Dapatkan CV yang benar-benar dilihat recruiter.</p>
          <button
            onClick={openUpload}
            className="min-h-[52px] rounded-[16px] px-[26px] py-3 text-white text-base font-bold border-0 cursor-pointer transition-all hover:-translate-y-[1px]"
            style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
          >
            Cek Peluang Saya
          </button>
        </section>

        {/* FAQ */}
        <FaqSection />
      </main>

      <FooterSection />
    </div>
  );
}
