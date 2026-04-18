import { Button } from "@/components/ui/button";
import HeroUpload from "@/components/blocks/HeroUpload";
import { MockAnalysisCard, ComparisonSection } from "@/components/blocks/ResultPreview";
import PricingSection from "@/components/blocks/PricingSection";
import FaqSection from "@/components/blocks/FaqSection";
import FooterSection from "@/components/blocks/FooterSection";

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      {/* Navbar */}
      <nav className="border-b border-slate-100 py-4 px-6 flex items-center justify-between sticky top-0 bg-white z-50">
        <a
          href="index.html"
          className="font-extrabold text-lg text-slate-900 no-underline tracking-tight"
        >
          GasLamar
        </a>
        <a
          href="upload.html"
          className="inline-flex items-center bg-slate-900 text-white font-semibold text-sm px-5 py-2 rounded-full hover:bg-slate-700 transition-colors no-underline"
        >
          Cek CV Saya →
        </a>
      </nav>

      <main className="max-w-screen-xl mx-auto px-6">
        {/* Hero — two-column on large screens */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-16 lg:py-24">
          <HeroUpload />
          <div>
            <p className="text-xs font-medium text-slate-400 text-center mb-3">
              Contoh hasil analisis nyata
            </p>
            <MockAnalysisCard />
          </div>
        </section>

        {/* Before / after comparison */}
        <ComparisonSection />

        {/* Pricing (includes value props above the cards) */}
        <PricingSection />

        {/* Bottom CTA */}
        <section className="my-4 mb-12 bg-gradient-to-br from-slate-50 to-slate-100 rounded-3xl p-10 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight mb-3">
            Siap bikin CV kamu lebih kuat?
          </h2>
          <p className="text-slate-500 mb-6">
            Dapatkan CV yang benar-benar dilihat recruiter — bukan sekadar lolos ATS.
          </p>
          <Button
            asChild
            className="bg-slate-900 hover:bg-slate-700 rounded-full px-8 py-3 text-base font-semibold"
          >
            <a href="upload.html">👉 Cek Skor CV Saya Sekarang</a>
          </Button>
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
