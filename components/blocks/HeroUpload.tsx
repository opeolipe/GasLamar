import { useState, useRef } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;

function ab2b64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s);
}

function readFile(file: File): Promise<string> {
  const ext = "." + file.name.split(".").pop()!.toLowerCase();
  return new Promise((res, rej) => {
    const r = new FileReader();
    if (ext === ".txt") {
      r.onload = (e) => res(JSON.stringify({ type: "txt", data: e.target!.result }));
      r.onerror = () => rej(new Error("Gagal membaca file"));
      r.readAsText(file, "UTF-8");
    } else {
      r.onload = (e) => {
        const buf = e.target!.result as ArrayBuffer, b = new Uint8Array(buf.slice(0, 4));
        if (ext === ".pdf" && !(b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46))
          return rej(new Error("Bukan file PDF yang valid"));
        if (ext === ".docx" && !(b[0] === 0x50 && b[1] === 0x4b))
          return rej(new Error("Bukan file DOCX yang valid"));
        res(JSON.stringify({ type: ext.slice(1), data: ab2b64(buf) }));
      };
      r.onerror = () => rej(new Error("Gagal membaca file"));
      r.readAsArrayBuffer(file);
    }
  });
}

function UploadForm({ columns, onClose }: { columns?: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [jd, setJd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setError("");
    const ext = "." + f.name.split(".").pop()!.toLowerCase();
    if (![".pdf", ".docx"].includes(ext)) { setError("Upload PDF atau DOCX."); return; }
    if (f.size > 5 * 1024 * 1024) { setError("Maks 5MB."); return; }
    setFile(f);
  }

  async function analyze() {
    if (!file) { alert("Silakan upload CV terlebih dahulu."); return; }
    if (jd.trim().length < 100) { alert("Paste job description dulu (min. 100 karakter)."); return; }
    setLoading(true);
    try {
      const cv = await readFile(file);
      sessionStorage.setItem("gaslamar_cv_pending", cv);
      sessionStorage.setItem("gaslamar_jd_pending", jd.slice(0, 5000));
      sessionStorage.setItem("gaslamar_filename", file.name);
      window.location.href = "analyzing.html";
    } catch (e) { setError((e as Error).message); setLoading(false); }
  }

  const dropzoneCls = "min-h-[180px] rounded-[16px] border border-dashed border-slate-300/40 bg-slate-50/80 grid place-items-center p-[18px] text-center cursor-pointer transition-all hover:border-blue-400/50 hover:bg-blue-50/50 hover:-translate-y-[1px]";
  const jdCls = "w-full min-h-[180px] rounded-[16px] border border-dashed border-slate-300/40 bg-slate-50/80 p-[18px] text-[#111827] resize-y outline-none text-sm transition-all focus:border-blue-500/50 focus:shadow-[0_0_0_4px_rgba(37,99,235,0.08)]";

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-2xl font-semibold" style={SERIF}>Mulai analisis gratis</h2>
          <p className="mt-2 text-[#6b7280] text-sm leading-[1.6]">
            Upload CV kamu lalu tempel job description untuk lihat status peluang pertama.
          </p>
        </div>
        <button onClick={onClose} className="min-h-[48px] rounded-[16px] border border-blue-200/30 bg-white text-blue-600 font-bold px-4 cursor-pointer hover:bg-blue-50 hover:-translate-y-[1px] transition-all">
          Tutup
        </button>
      </div>

      <div className={`grid gap-4 mt-5 ${columns ? "grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" : "grid-cols-1"}`}>
        <div>
          <label className="mb-2 block text-sm font-semibold">CV kamu</label>
          <div className={dropzoneCls} onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
            <div>
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-xl text-[#2563EB]">CV</div>
              <div className="text-base font-semibold">{file ? <span className="text-emerald-600">{file.name}</span> : "Klik atau tarik PDF/DOCX"}</div>
              {!file && <div className="mt-2 text-sm text-slate-500">Upload tidak disimpan. Preview hanya sementara.</div>}
            </div>
            <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold">Job description</label>
          <textarea value={jd} onChange={(e) => setJd(e.target.value.slice(0, 5000))} placeholder="Paste lowongan di sini..." className={jdCls} />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button onClick={analyze} disabled={loading} className="min-h-[56px] rounded-[16px] px-[26px] py-4 text-white text-base font-bold border-0 cursor-pointer transition-all hover:-translate-y-[1px] focus-visible:-translate-y-[1px] disabled:opacity-60 w-full sm:w-auto" style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}>
          {loading ? "Menganalisis..." : "Analisis Sekarang"}
        </button>
        <p className="text-[12px] text-slate-400 sm:ml-2">Tanpa daftar • aman digunakan</p>
      </div>
    </div>
  );
}

export interface HeroUploadProps {
  isDesktopOpen: boolean;
  isMobileOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export default function HeroUpload({ isDesktopOpen, isMobileOpen, onOpen, onClose }: HeroUploadProps) {
  return (
    <>
      <section className="relative overflow-hidden rounded-[24px] px-5 py-8 text-center sm:px-8 sm:py-10 lg:px-10 lg:py-12 backdrop-blur-[14px]" style={{ border: "1px solid rgba(148,163,184,0.18)", background: "rgba(255,255,255,0.84)", boxShadow: SHADOW }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(140deg,rgba(255,255,255,0.52),transparent 40%),radial-gradient(circle at top right,rgba(37,99,235,0.08),transparent 25%)" }} />
        <div className="relative z-[1] mx-auto flex max-w-3xl flex-col items-center">
          <div className="max-w-2xl">
            <h1 className="text-[clamp(2.5rem,6vw,4.4rem)] leading-[0.95] m-0" style={{ ...SERIF, textWrap: "balance" } as React.CSSProperties}>
              Gas atau skip? Tahu dulu peluang kamu sebelum apply.
            </h1>
            <p className="mt-5 max-w-xl mx-auto text-[#6b7280] text-base leading-[1.6]">
              Upload CV + job description.<br />Tahu peluang interview kamu dalam 30 detik.
            </p>
          </div>
          <div className="mt-8 w-full">
            <button onClick={onOpen} className="min-h-[56px] rounded-[16px] px-[26px] py-4 text-white text-base font-bold border-0 cursor-pointer transition-all hover:-translate-y-[1px] w-full sm:w-auto" style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}>
              Cek Peluang Saya
            </button>
            <p className="mt-4 text-[#6b7280] text-[13px] leading-[1.5]">CV tidak disimpan • tanpa registrasi • hasil dalam ±30 detik</p>
            {isDesktopOpen && (
              <div className="mt-[18px] rounded-[24px] p-[18px] text-left backdrop-blur-[16px]" style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(148,163,184,0.2)", boxShadow: SHADOW }}>
                <UploadForm columns onClose={onClose} />
              </div>
            )}
          </div>
        </div>
      </section>

      <Sheet open={isMobileOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent side="bottom" className="rounded-t-[24px] px-5 pb-5 pt-2 max-h-[90vh] overflow-y-auto bg-white/97">
          <div className="w-[52px] h-[5px] rounded-full bg-slate-200 mx-auto mb-4" />
          <UploadForm onClose={onClose} />
        </SheetContent>
      </Sheet>
    </>
  );
}
