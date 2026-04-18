const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;
type BarVariant = "good" | "warn" | "default";

const BAR_FILLS: Record<BarVariant, string> = {
  good: "linear-gradient(90deg,#6ee7b7 0%,#10b981 100%)",
  warn: "linear-gradient(90deg,#fde68a 0%,#f59e0b 100%)",
  default: "linear-gradient(90deg,#93c5fd 0%,#2563eb 100%)",
};

interface Dim { label: string; sub?: string; pct: number; score: string; variant: BarVariant }
const DIMS: Dim[] = [
  { label: "Cocok dengan job ini?", pct: 70, score: "7/10", variant: "good" },
  { label: "CV kamu menarik di awal?", pct: 40, score: "4/10", variant: "warn" },
  { label: "Berapa lama sampai siap interview?", sub: "± minggu / bulan", pct: 80, score: "8/10", variant: "warn" },
  { label: "Seberapa berat usaha untuk sampai ke sana?", sub: "belajar, biaya, waktu", pct: 90, score: "9/10", variant: "default" },
  { label: "Skill kamu masih kepake untuk job ini?", sub: "atau sudah mulai tidak relevan", pct: 60, score: "6/10", variant: "warn" },
  { label: "Ada bukti hasil kerja?", sub: "portfolio, project, hasil kerja", pct: 30, score: "3/10", variant: "warn" },
];

const GAPS = [
  "Pengalaman belum langsung relevan dengan job ini → peluang interview turun",
  "Belum terlihat dampak atau hasil kerja yang jelas → sulit meyakinkan HRD",
  "Penjelasan masih terlalu umum → CV kurang menonjol",
];

export interface ResultPreviewProps { onOpenUpload: () => void }

export default function ResultPreview({ onOpenUpload }: ResultPreviewProps) {
  return (
    <div className="relative overflow-hidden rounded-[24px]" style={{ border: "1px solid rgba(148,163,184,0.18)", background: "rgba(255,255,255,0.84)", boxShadow: SHADOW, backdropFilter: "blur(14px)" }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(140deg,rgba(255,255,255,0.52),transparent 40%),radial-gradient(circle at top right,rgba(37,99,235,0.08),transparent 25%)" }} />

      <div className="relative z-[1] border-b p-6" style={{ borderColor: "rgba(148,163,184,0.18)", background: "linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.96)),linear-gradient(120deg,rgba(245,158,11,0.12),transparent 45%)" }}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span>Preview peluang interview</span>
              <span className="inline-flex items-center rounded-full px-[10px] py-[6px] text-xs font-bold" style={{ background: "rgba(245,158,11,0.12)", color: "#b45309" }}>6D ringkas</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-full px-[14px] py-[10px] text-sm font-extrabold tracking-[0.02em]" style={{ background: "rgba(245,158,11,0.12)", color: "#b45309" }}>🔮 Status: TIMED</span>
              <h2 className="m-0 text-[clamp(1.6rem,3vw,2.5rem)] leading-tight" style={SERIF}>Peluang interview masih rendah — butuh ±8 minggu untuk siap</h2>
            </div>
          </div>
          <div className="flex flex-wrap gap-[10px] text-xs text-[#6b7280]">
            <span>DO → Lanjutkan, peluang besar.</span>
            <span>DO NOT → Gap terlalu besar untuk sekarang.</span>
          </div>
        </div>
      </div>

      <div className="relative z-[1] grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <div className="p-7">
          <p className="mb-6 text-sm text-[#6b7280]">Ini yang dilihat HR dalam 7–10 detik pertama:</p>
          <div className="grid gap-[14px]">
            {DIMS.map((d) => (
              <div key={d.label} className="grid items-center gap-x-3 gap-y-1 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,168px)_minmax(0,1fr)_auto]">
                <div className="sm:col-auto">
                  <div className="font-semibold text-sm leading-snug">{d.label}</div>
                  {d.sub && <div className="text-xs text-slate-400">{d.sub}</div>}
                </div>
                <div className="h-[10px] overflow-hidden rounded-full col-span-full sm:col-auto" style={{ background: "rgba(148,163,184,0.18)" }}>
                  <div className="h-full rounded-[inherit]" style={{ width: `${d.pct}%`, background: BAR_FILLS[d.variant] }} />
                </div>
                <div className="row-start-1 col-start-2 self-start sm:row-auto sm:col-auto inline-flex items-center rounded-full px-[10px] py-[6px] text-xs font-bold" style={{ background: "rgba(15,23,42,0.05)", color: "#0f172a" }}>{d.score}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t p-7 lg:border-t-0 lg:border-l" style={{ borderColor: "rgba(148,163,184,0.18)" }}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Gap utama</div>
          <ul className="mt-5 list-none m-0 p-0 grid gap-[14px]">
            {GAPS.map((g, i) => (
              <li key={i} className="pb-[14px] font-semibold text-sm border-b last:pb-0 last:border-b-0" style={{ borderColor: "rgba(148,163,184,0.14)" }}>{g}</li>
            ))}
          </ul>
          <div className="mt-6 grid gap-[14px] rounded-[24px] p-5" style={{ background: "linear-gradient(180deg,rgba(248,250,252,0.9),rgba(255,255,255,0.92))", border: "1px solid rgba(37,99,235,0.22)" }}>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cara memperbaiki CV kamu (langsung bisa dipakai)</div>
            <div className="text-sm" style={{ color: "#94a3b8", textDecoration: "line-through" }}>❌ "Bertanggung jawab mengelola tugas harian."</div>
            <div className="text-sm font-bold" style={{ color: "#0f172a" }}>✅ "Mengelola operasional harian untuk memastikan proses berjalan lancar dan efisien."</div>
            <div className="text-sm text-[#6b7280]">Jika ada data, tambahkan hasil konkret, misalnya: "Meningkatkan efisiensi proses sebesar X%"</div>
            <button onClick={onOpenUpload} className="min-h-[48px] rounded-[16px] px-5 text-left text-sm font-bold text-[#2563eb] cursor-pointer transition-all hover:-translate-y-[1px]" style={{ border: "1px solid rgba(37,99,235,0.18)", background: "white" }}>→ Lanjutkan perbaikan CV</button>
          </div>
        </div>
      </div>
    </div>
  );
}
