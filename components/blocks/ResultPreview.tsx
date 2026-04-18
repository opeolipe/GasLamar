const MISSING_KEYWORDS = ["React Hooks", "API Integration", "Unit Testing"];

function MockAnalysisCard() {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
        <span className="font-extrabold text-2xl text-slate-900">
          68{" "}
          <span className="text-base font-semibold text-slate-400">/ 100</span>
        </span>
        <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full">
          ⚠️ Kurang cocok untuk job ini
        </span>
      </div>

      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide font-semibold text-slate-400 mb-2">
          ❌ Missing Keywords (dibutuhkan recruiter)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MISSING_KEYWORDS.map((kw) => (
            <span key={kw} className="bg-red-50 text-red-600 text-xs px-2.5 py-1 rounded-full">
              {kw}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide font-semibold text-slate-400 mb-2">
          ⚠️ Weak Bullet (before)
        </p>
        <div className="bg-red-50 rounded-xl px-3 py-2 text-sm text-slate-600">
          "Bertanggung jawab mengembangkan fitur frontend."
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide font-semibold text-emerald-600 mb-2">
          ✅ Improved Version (tailored)
        </p>
        <div className="bg-emerald-50 border-l-2 border-emerald-500 rounded-xl px-3 py-2 text-sm text-slate-700 font-medium">
          "Mengembangkan 4 fitur frontend menggunakan React Hooks, menurunkan load time 30%."
        </div>
      </div>

      <p className="text-center text-xs text-blue-600 bg-blue-50 rounded-xl px-3 py-2 mt-4">
        🔍 Lihat 3 rekomendasi lain + CV rewrite setelah upload
      </p>
    </div>
  );
}

function ComparisonSection() {
  return (
    <section id="sample" className="py-16">
      <h2 className="text-2xl font-extrabold text-center tracking-tight mb-2">
        Lihat kenapa CV bisa di-skip — dan cara memperbaikinya
      </h2>
      <p className="text-center text-slate-500 max-w-xl mx-auto mb-8">
        Kami tunjukkan bagian mana yang bikin HR kurang tertarik, dan bagaimana
        memperbaikinya secara spesifik.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-100 rounded-3xl p-6">
        {/* Before */}
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <span className="inline-block bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full mb-4">
            ❌ Kemungkinan besar di-skip HR
          </span>
          {[
            { label: "CV tidak spesifik", text: '"Memiliki pengalaman di bidang marketing dan social media management."' },
            { label: "Kurang impact", text: '"Bertanggung jawab untuk meningkatkan brand awareness."' },
            { label: "Tidak ada keyword relevan", text: 'Missing: "SEO strategy, content calendar, Google Analytics"' },
          ].map((item) => (
            <div key={item.label} className="mt-3 pl-3 border-l-2 border-slate-200 text-sm">
              <strong>{item.label}</strong>
              <br />
              {item.text}
            </div>
          ))}
        </div>

        {/* After */}
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <span className="inline-block bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full mb-4">
            ✅ Lebih mudah lolos screening
          </span>
          <div className="bg-emerald-50 border-l-2 border-emerald-500 rounded-xl px-3 py-2 text-sm mb-3">
            <strong>🎯 Spesifik &amp; terukur:</strong>
            <br />
            "Meningkatkan engagement Instagram 45% dalam 3 bulan dengan strategi konten data-driven &amp;
            A/B testing."
          </div>
          <div className="bg-emerald-50 border-l-2 border-emerald-500 rounded-xl px-3 py-2 text-sm mb-3">
            <strong>⚙️ Keyword SEO yang dicari recruiter:</strong>
            <br />
            "Google Analytics, Meta Ads, Content Strategy, ROI reporting"
          </div>
          <div className="pl-3 border-l-2 border-emerald-500 text-sm mb-4">
            <strong>📈 Hasil konkret</strong>
            <br />
            "Mengelola campaign dengan ROI +32% dibanding kuartal sebelumnya."
          </div>
          <span className="inline-block bg-blue-50 text-blue-600 text-xs font-semibold px-3 py-1 rounded-full">
            🔥 Skor naik jadi 87/100 · Rekomendasi prioritas
          </span>
        </div>
      </div>

      <p className="text-center text-sm text-slate-500 mt-6">
        🔍 Semua rekomendasi berdasarkan <strong>job description</strong> yang kamu targetkan
      </p>
    </section>
  );
}

export default function ResultPreview() {
  return (
    <>
      <div>
        <p className="text-xs font-medium text-slate-400 text-center mb-3">
          Contoh hasil analisis nyata
        </p>
        <MockAnalysisCard />
      </div>
      <ComparisonSection />
    </>
  );
}

export { MockAnalysisCard, ComparisonSection };
