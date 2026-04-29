import HeroUpload    from "@/components/blocks/HeroUpload";
import ResultPreview from "@/components/blocks/ResultPreview";
import PricingSection from "@/components/blocks/PricingSection";
import FaqSection    from "@/components/blocks/FaqSection";
import FooterSection from "@/components/blocks/FooterSection";

const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;

const HOW_STEPS = [
  { n: "1", title: "Upload CV",               bg: "rgba(37,99,235,0.08)",    color: "#2563eb" },
  { n: "2", title: "Analisis otomatis",        bg: "rgba(245,158,11,0.08)",   color: "#d97706" },
  { n: "3", title: "Dapat status + perbaikan", bg: "rgba(16,185,129,0.08)",   color: "#059669" },
];

const BENEFITS = [
  { title: "Disesuaikan dengan job",  desc: "Setiap CV dibaca terhadap lowongan yang kamu incar." },
  { title: "CV bilingual",            desc: "Tetap siap untuk perusahaan lokal dan multinasional." },
  { title: "Langsung diperbaiki",     desc: "Gap utama langsung diubah jadi bullet yang lebih kuat." },
];

export default function Home() {
  return (
    <div
      className="min-h-screen text-gray-900 font-sans"
      style={{ background: "radial-gradient(ellipse 80% 50% at 50% -20%,rgba(37,99,235,0.08),transparent)" }}
    >
      {/* Skip link — visible on keyboard focus only */}
      <a
        href="#main-content"
        className="absolute left-[-9999px] top-0 z-[9999] bg-slate-900 text-white px-4 py-2 text-sm font-semibold rounded-br-lg focus:left-0"
      >
        Langsung ke konten utama
      </a>

      {/* Navbar */}
      <nav
        className="border-b py-4 px-6 flex items-center justify-between sticky top-0 z-50 backdrop-blur-[14px]"
        style={{ borderColor: "rgba(148,163,184,0.18)", background: "rgba(255,255,255,0.88)" }}
      >
        <a href="index.html" className="font-extrabold text-lg text-slate-900 no-underline tracking-tight min-h-[44px] inline-flex items-center">
          GasLamar
        </a>
        <a
          href="upload.html"
          className="inline-flex items-center min-h-[44px] text-white font-bold text-sm px-5 py-[10px] rounded-full no-underline transition-all hover:-translate-y-[1px]"
          style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
        >
          Cek Peluang Saya
        </a>
      </nav>

      <main id="main-content" className="max-w-screen-xl mx-auto px-6">
        {/* Hero */}
        <section className="py-12 lg:py-16">
          <HeroUpload />
        </section>

        {/* Result preview */}
        <ResultPreview />

        {/* How it works */}
        <section className="py-8 md:py-12">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500 mb-3">Cara kerja</p>
          <h2 className="text-[clamp(1.8rem,3.5vw,2.8rem)] font-semibold leading-tight mb-8" style={SERIF}>
            Cepat, jelas, langsung ke status peluang
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
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
          <div className="mt-8 md:mt-16">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500 mb-3">Keuntungan</p>
            <h2 className="text-[clamp(1.8rem,3.5vw,2.8rem)] font-semibold leading-tight mb-8" style={SERIF}>
              Bukan sekadar cocok kata kunci
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {BENEFITS.map((b) => (
                <div key={b.title} className="rounded-[20px] p-6 bg-white" style={{ border: "1px solid rgba(148,163,184,0.18)", boxShadow: SHADOW }}>
                  <h3 className="font-semibold text-slate-800 mb-2">{b.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <PricingSection />

        {/* Inline bottom CTA */}
        <div className="text-center py-8 mb-4">
          <p className="text-lg font-semibold text-slate-700 mb-4" style={SERIF}>Siap cek peluang kamu?</p>
          <a
            href="upload.html"
            className="inline-flex items-center justify-center min-h-[52px] rounded-[16px] px-[26px] py-3 text-white text-base font-bold no-underline transition-all hover:-translate-y-[1px]"
            style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
          >
            Cek Peluang Saya
          </a>
        </div>

        {/* FAQ */}
        <FaqSection />
      </main>

      <FooterSection />
    </div>
  );
}
