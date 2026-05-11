import { useState, useRef, useEffect } from 'react';
import { WORKER_URL } from '@/lib/uploadValidation';

interface Props {
  onFetchSuccess: (text: string) => void;
  onClose:        () => void;
}

export default function UrlFetcher({ onFetchSuccess, onClose }: Props) {
  const [url,     setUrl]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-clear error after 8 s so the user can try again without distraction
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(t);
  }, [error]);

  async function handleFetch() {
    if (!url.trim()) { setError('Masukkan URL loker terlebih dahulu'); inputRef.current?.focus(); return; }
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`${WORKER_URL}/fetch-job-url`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data?.message ||
          `URL tidak dapat diambil (error ${res.status}). Coba lagi atau paste manual.`
        );
        inputRef.current?.focus();
      } else {
        onFetchSuccess(data.job_desc);
      }
    } catch (err) {
      const isNetwork = err instanceof TypeError;
      setError(
        isNetwork
          ? 'Tidak dapat terhubung ke server. Cek koneksi internet kamu.'
          : 'Gagal mengambil konten. Coba paste manual.'
      );
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2 items-center">
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
          placeholder="https://glints.com/id/opportunities/jobs/…"
          className="flex-1 min-h-[44px] px-3 py-2 border border-blue-200 rounded-[10px] text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors font-sans bg-white"
          aria-label="URL halaman lowongan kerja (LinkedIn, Glints, JobStreet, dll)"
        />
        <button
          type="button"
          onClick={handleFetch}
          disabled={loading}
          className="min-h-[44px] px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-[10px] text-sm font-semibold disabled:opacity-60 whitespace-nowrap transition-colors"
        >
          {loading ? 'Mengambil...' : 'Ambil'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 text-lg"
          aria-label="Tutup form URL loker"
        >
          ✕
        </button>
      </div>
      <p className="text-sm mt-1.5 text-slate-400">
        Platform yang didukung: Glints, JobStreet, Kalibrr, Indeed.{' '}
        <span title="LinkedIn membatasi akses otomatis sehingga pengambilan sering gagal." className="cursor-help underline decoration-dotted">
          LinkedIn sering gagal.
        </span>
      </p>
      {error && (
        <p className="text-sm mt-1 text-red-600">{error}</p>
      )}
    </div>
  );
}
