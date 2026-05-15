import { useState } from "react";

const SHADOW = "0 18px 44px rgba(15,23,42,0.07), 0 1px 2px rgba(15,23,42,0.04)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;

type BarVariant = "good" | "warn" | "bad";

const BAR_FILLS: Record<BarVariant, string> = {
  good: "linear-gradient(90deg,#6ee7b7 0%,#10b981 100%)",
  warn: "linear-gradient(90deg,#fde68a 0%,#f59e0b 100%)",
  bad:  "linear-gradient(90deg,#fca5a5 0%,#ef4444 100%)",
};

const CHIP_CLS: Record<BarVariant, string> = {
  good: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  bad:  "bg-red-100 text-red-800",
};

interface Dim { label: string; sub?: string; pct: number; score: string; variant: BarVariant }

const DIMS: Dim[] = [
  { label: "Cocok dengan job ini?", pct: 70, score: "7/10", variant: "good" },
  { label: "CV kamu menarik di awal?", pct: 40, score: "4/10", variant: "warn" },
  { label: "Seberapa cepat kamu bisa siap interview?", sub: "± minggu / bulan", pct: 80, score: "8/10", variant: "good" },
  { label: "Skill kamu masih kepake untuk job ini?", sub: "atau sudah mulai tidak relevan", pct: 60, score: "6/10", variant: "warn" },
  { label: "Ada bukti hasil kerja?", sub: "portfolio, project, hasil kerja", pct: 30, score: "3/10", variant: "bad" },
];

const PRIORITY = DIMS.filter(d => parseInt(d.score) <= 4);

const GAPS = [
  "Pengalaman belum langsung relevan dengan job ini → peluang interview turun",
  "Belum terlihat dampak atau hasil kerja yang jelas → sulit meyakinkan HRD",
  "Penjelasan masih terlalu umum → CV kurang menonjol",
];

type Tab = "Hasil" | "Gap" | "Perbaikan";
const TABS: Tab[] = ["Hasil", "Gap", "Perbaikan"];

export default function ResultPreview() {
  const [tab, setTab] = useState<Tab>("Hasil");

  return (
    <div className="relative overflow-hidden rounded-[24px]" style={{ border: "1px solid rgba(148,163,184,0.14)", background: "rgba(255,255,255,0.92)", boxShadow: SHADOW, backdropFilter: "blur(14px)" }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(140deg,rgba(255,255,255,0.52),transparent 40%),radial-gradient(circle at top right,rgba(37,99,235,0.08),transparent 25%)" }} />

      {/* Verdict band — always visible */}
      <div className="relative z-[1] border-b p-6" style={{ borderColor: "rgba(148,163,184,0.18)", background: "linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.96))" }}>
        <div className="flex flex-wrap items-start gap-2 mb-3">
          <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Preview peluang interview</span>
          <span className="inline-flex items-center rounded-full px-[10px] py-[5px] text-sm font-bold bg-amber-100 text-amber-900">5D ringkas</span>
        </div>
        <div className="mb-3">
          <span className="inline-flex items-center rounded-full px-[14px] py-[8px] text-sm font-extrabold bg-amber-100 text-amber-900"><span aria-hidden="true">🔮</span><span className="sr-only">Status analisis: </span> TIMED</span>
        </div>
        <h2 className="m-0 text-[clamp(1.4rem,2.5vw,2.2rem)] leading-tight mb-2" style={SERIF}>
          Peluang interview masih rendah — butuh ±8 minggu untuk siap
        </h2>
        <p className="text-sm text-slate-500">DO → Lanjutkan, peluang besar. &nbsp; DO NOT → Gap terlalu besar untuk sekarang.</p>
      </div>

      {/* Tab bar */}
      <div className="relative z-[1] grid grid-cols-3 gap-2 px-6 pt-5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-[44px] px-3 py-[10px] rounded-xl text-sm font-semibold cursor-pointer transition-all w-full text-center ${
              tab === t ? "text-white border-0" : "text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200"
            }`}
            style={tab === t ? { background: "linear-gradient(180deg,#3b82f6,#1d4ed8)", boxShadow: "0 8px 24px rgba(37,99,235,0.22)" } : {}}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="relative z-[1] p-6">
        {tab === "Hasil" && (
          <div>
            {PRIORITY.length > 0 && (
              <div className="mb-5 rounded-[14px] px-4 py-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)" }}>
                <p className="text-sm font-bold text-red-700 mb-2"><span aria-hidden="true">🔥</span> Perlu diperbaiki dulu:</p>
                <ul className="space-y-1">
                  {PRIORITY.map((d) => (
                    <li key={d.label} className="text-sm text-red-600">• {d.label} ({d.score})</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="hidden sm:block mb-4 text-sm uppercase tracking-[0.12em] text-slate-500">Ini yang dilihat HR dalam 7–10 detik pertama:</p>
            <div className="grid gap-3">
              {DIMS.map((d) => (
                <div key={d.label} className="grid items-center gap-x-3 gap-y-1 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
                  <div>
                    <div className="font-semibold text-sm leading-snug">{d.label}</div>
                    {d.sub && <div className="text-sm text-slate-500">{d.sub}</div>}
                  </div>
                  <div className="h-3 overflow-hidden rounded-full col-span-full sm:col-auto" style={{ background: "rgba(148,163,184,0.18)" }}>
                    <div className="h-full rounded-[inherit]" style={{ width: `${d.pct}%`, background: BAR_FILLS[d.variant] }} />
                  </div>
                  <span className={`row-start-1 col-start-2 self-start sm:row-auto sm:col-auto inline-flex items-center rounded-full px-[10px] py-[5px] text-sm font-bold ${CHIP_CLS[d.variant]}`}>
                    {d.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "Gap" && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 mb-4">Gap utama yang perlu diperbaiki</p>
            <ul className="grid gap-3">
              {GAPS.map((g, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-700 font-semibold pb-4 border-b last:pb-0 last:border-0" style={{ borderColor: "rgba(148,163,184,0.14)" }}>
                  <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold inline-flex items-center justify-center">{i + 1}</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "Perbaikan" && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 mb-4">Cara memperbaiki CV kamu (langsung bisa dipakai)</p>
            <div className="text-sm mb-3" style={{ color: "#94a3b8", textDecoration: "line-through" }}><span aria-hidden="true">❌</span><span className="sr-only">Sebelum: </span> "Bertanggung jawab mengelola tugas harian."</div>
            <div className="text-sm font-bold mb-2" style={{ color: "#0f172a" }}><span aria-hidden="true">✅</span><span className="sr-only">Sesudah: </span> "Mengelola operasional harian untuk memastikan proses berjalan lancar dan efisien."</div>
            <p className="text-sm text-slate-400 mb-5">Jika ada data, tambahkan hasil konkret, misalnya: "Meningkatkan efisiensi proses sebesar X%"</p>
            <a
              href="upload.html"
              className="inline-flex items-center min-h-[48px] rounded-[16px] px-5 text-sm font-bold text-[#2563eb] no-underline transition-all hover:-translate-y-[1px]"
              style={{ border: "1px solid rgba(37,99,235,0.18)", background: "#EFF6FF" }}
            >
              → Lanjutkan perbaikan CV
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
