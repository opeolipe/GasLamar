import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const TRUST_ITEMS = [
  { icon: "🔒", text: "CV tidak disimpan" },
  { icon: "⚡", text: "Proses ±30 detik" },
  { icon: "❌", text: "Tidak perlu daftar" },
  { icon: "🔐", text: "CV otomatis dihapus setelah 7 hari" },
];

const MIN_JD = 100;
const MAX_JD = 5000;
const MAX_FILE = 5 * 1024 * 1024;
const VALID_EXTS = [".pdf", ".docx", ".txt"];

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(out);
}

function readFileToJson(file: File): Promise<string> {
  const ext = "." + file.name.split(".").pop()!.toLowerCase();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (ext === ".txt") {
      reader.onload = (e) =>
        resolve(JSON.stringify({ type: "txt", data: e.target!.result as string }));
      reader.onerror = () => reject(new Error("Gagal membaca file"));
      reader.readAsText(file, "UTF-8");
    } else {
      reader.onload = (e) => {
        const buf = e.target!.result as ArrayBuffer;
        const b = new Uint8Array(buf.slice(0, 4));
        if (ext === ".pdf" && !(b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46))
          return reject(new Error("Bukan file PDF yang valid"));
        if (ext === ".docx" && !(b[0] === 0x50 && b[1] === 0x4b))
          return reject(new Error("Bukan file DOCX yang valid"));
        resolve(JSON.stringify({ type: ext.slice(1), data: arrayBufferToBase64(buf) }));
      };
      reader.onerror = () => reject(new Error("Gagal membaca file"));
      reader.readAsArrayBuffer(file);
    }
  });
}

export default function HeroUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [jd, setJd] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canSubmit = !!file && jd.trim().length >= MIN_JD && jd.length <= MAX_JD;

  function handleFile(f: File) {
    setError("");
    const ext = "." + f.name.split(".").pop()!.toLowerCase();
    if (!VALID_EXTS.includes(ext)) {
      setError("Format tidak didukung. Upload CV dalam format PDF, DOCX, atau TXT.");
      return;
    }
    if (f.size > MAX_FILE) {
      setError(`Ukuran file terlalu besar (${(f.size / 1024 / 1024).toFixed(1)}MB). Maks 5MB.`);
      return;
    }
    setFile(f);
  }

  async function handleSubmit() {
    if (!canSubmit || !file) return;
    setLoading(true);
    setError("");
    try {
      const cvData = await readFileToJson(file);
      try {
        sessionStorage.setItem("gaslamar_cv_pending", cvData);
        sessionStorage.setItem("gaslamar_jd_pending", jd.slice(0, MAX_JD));
        sessionStorage.setItem("gaslamar_filename", file.name);
      } catch {
        setError("Browser kamu memblokir penyimpanan sementara (mode pribadi?). Coba mode normal.");
        setLoading(false);
        return;
      }
      window.location.href = "analyzing.html";
    } catch (err) {
      setError((err as Error).message || "Gagal membaca file. Coba lagi.");
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight text-slate-900 mb-5">
        CV kamu mungkin bagus…<br />
        tapi HR cuma butuh{" "}
        <span className="bg-orange-100 text-amber-800 px-1 rounded">6 detik buat reject.</span>
      </h1>

      <p className="text-lg text-slate-600 mb-6">
        Cek seberapa cocok CV kamu dengan job yang kamu lamar, lihat gap-nya, dan
        langsung dapat versi CV yang lebih kuat — dalam 2 menit.
      </p>

      <div className="flex flex-wrap gap-2 mb-7">
        {TRUST_ITEMS.map((item) => (
          <span
            key={item.text}
            className="inline-flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full text-sm font-medium text-slate-800"
          >
            <span>{item.icon}</span>
            {item.text}
          </span>
        ))}
      </div>

      {/* File dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Area upload CV"
        className="border-2 border-dashed border-slate-200 rounded-2xl p-5 mb-4 text-center cursor-pointer hover:border-slate-400 transition-colors"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        {file ? (
          <p className="text-sm font-semibold text-emerald-600">📄 {file.name}</p>
        ) : (
          <>
            <p className="font-semibold text-slate-700">Klik atau drag &amp; drop CV di sini</p>
            <p className="text-xs text-slate-400 mt-1">PDF, DOCX, atau TXT · maks 5MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      <Textarea
        placeholder="Paste job description di sini (min. 100 karakter)…"
        value={jd}
        onChange={(e) => setJd(e.target.value.slice(0, MAX_JD))}
        rows={4}
        className="mb-1 resize-none"
      />
      <p className="text-xs text-slate-400 text-right mb-4">
        {jd.length.toLocaleString("id-ID")} / 5.000
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2 mb-4">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
          className="bg-slate-900 hover:bg-slate-700 rounded-full px-7 py-3 text-base font-semibold"
        >
          {loading ? "Membaca file…" : "👉 Cek Skor CV Saya"}
        </Button>
        <a href="#sample" className="text-slate-500 text-sm hover:text-slate-800 transition-colors">
          👀 Lihat contoh hasil nyata
        </a>
      </div>

      <p className="text-xs text-slate-400 mt-3">
        Gratis lihat skor &amp; gap &nbsp;·&nbsp; Bayar hanya kalau mau download
      </p>
    </div>
  );
}
