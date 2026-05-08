import { useState, useEffect } from "react";
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
  const [showStickyBar, setShowStickyBar]       = useState(false);
  const [stickyDismissed, setStickyDismissed]   = useState(false);
  const footerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let triggered = false;
    function onScroll() {
      if (triggered || window.scrollY <= 200) return;
      triggered = true;
      timer = setTimeout(() => setShowStickyBar(true), 2000);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, []);

  // Hide sticky bar when footer scrolls into view so it never blocks footer links
  useEffect(() => {
    if (!footerRef.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setShowStickyBar(false); else if (!stickyDismissed) setShowStickyBar(prev => prev); },
      { threshold: 0.1 },
    );
    obs.observe(footerRef.current);
    return () => obs.disconnect();
  }, [stickyDismissed]);

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
        <a href="index.html" className="no-underline min-h-[44px] inline-flex items-center">
          <img src="assets/logo.svg" alt="GasLamar" height="28" style={{ display: 'block' }} />
        </a>
        <div className="flex items-center gap-2">
          <a
            href="access.html"
            className="inline-flex items-center min-h-[44px] text-slate-600 hover:text-slate-900 font-medium text-sm px-3 no-underline transition-colors"
          >
            Akses CV
          </a>
          <a
            href="upload.html"
            className="inline-flex items-center min-h-[44px] text-white font-bold text-sm px-5 py-[10px] rounded-full no-underline transition-all hover:-translate-y-[1px]"
            style={{ background: "#1B4FE8", boxShadow: SHADOW }}
          >
            Cek Peluang Saya
          </a>
        </div>
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
            style={{ background: "#1B4FE8", boxShadow: SHADOW }}
          >
            Cek Peluang Saya
          </a>
        </div>

        {/* FAQ */}
        <FaqSection />
      </main>

      <FooterSection ref={footerRef} />

      {/* Sticky mobile CTA — only on small screens, appears after scroll.
          Auto-hides when footer is visible (IntersectionObserver above) so footer
          links (Privacy Policy, Terms, Accessibility) are never blocked. */}
      {showStickyBar && !stickyDismissed && (
        <div
          className="md:hidden"
          style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(255,255,255,0.96)', borderTop: '1px solid rgba(148,163,184,0.18)', backdropFilter: 'blur(14px)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <a
            href="upload.html"
            className="flex-1 max-w-sm mx-auto"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 16, background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', color: 'white', fontWeight: 700, fontSize: '0.95rem', textDecoration: 'none', boxShadow: SHADOW }}
          >
            Cek Peluang Kamu — Gratis →
          </a>
          <button
            type="button"
            aria-label="Tutup banner"
            onClick={() => { setShowStickyBar(false); setStickyDismissed(true); }}
            style={{ flexShrink: 0, minWidth: 36, minHeight: 36, borderRadius: '50%', border: 'none', background: 'rgba(148,163,184,0.15)', color: '#64748b', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
