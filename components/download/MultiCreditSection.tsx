import { useState, useRef } from 'react';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

const EXAMPLE_JD = `Posisi: Software Engineer

Requirements:
- S1 Teknik Informatika atau terkait
- 2+ tahun pengalaman sebagai Software Engineer
- Menguasai JavaScript / TypeScript dan salah satu framework (React, Vue, Node.js)
- Pengalaman dengan REST API dan version control (Git)
- Kemampuan problem-solving yang baik dan senang belajar hal baru`;

interface Props {
  creditsRemaining: number;
  totalCredits:     number;
  onGenerate:       (jobDesc: string) => Promise<void> | void;
  onUrlFetch:       (url: string) => Promise<string>;
}

export default function MultiCreditSection({ creditsRemaining, totalCredits, onGenerate, onUrlFetch }: Props) {
  const [jobDesc,      setJobDesc]      = useState('');
  const [showUrlRow,   setShowUrlRow]   = useState(false);
  const [urlInput,     setUrlInput]     = useState('');
  const [urlStatus,    setUrlStatus]    = useState<{ text: string; ok: boolean } | null>(null);
  const [fetchingUrl,  setFetchingUrl]  = useState(false);
  const [generating,   setGenerating]   = useState(false);
  const multiRef = useRef<HTMLDivElement>(null);

  const charCount    = jobDesc.length;
  const nearLimit    = charCount > 4500;
  const overLimit    = charCount > 5000;

  function setTextDir(el: HTMLTextAreaElement) {
    const RTL = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/;
    el.dir = RTL.test(el.value) ? 'rtl' : 'ltr';
  }

  async function handleFetchUrl() {
    if (!urlInput.trim()) return;
    setFetchingUrl(true);
    setUrlStatus({ text: '⏳ Mengambil job description...', ok: true });
    try {
      const jd = await onUrlFetch(urlInput.trim());
      setJobDesc(jd);
      setUrlStatus({ text: '✅ Job description berhasil diambil. Periksa dan edit seperlunya.', ok: true });
    } catch (err) {
      setUrlStatus({ text: `⚠️ ${(err as Error).message || 'Gagal mengambil. Coba copy-paste manual.'}`, ok: false });
    } finally {
      setFetchingUrl(false);
    }
  }

  async function handleGenerate() {
    const jd = jobDesc.trim();
    if (!jd) { return; }
    if (overLimit) { alert('Job description terlalu panjang (maks 5.000 karakter).'); return; }
    setGenerating(true);
    try {
      await onGenerate(jd);
    } catch (err) {
      alert((err as Error).message || 'Terjadi kesalahan. Coba lagi.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      id="multi-credit-section"
      ref={multiRef}
      className="rounded-[24px] p-6 sm:p-8"
      style={{
        background:     'rgba(255,255,255,0.84)',
        border:         '1px solid rgba(148,163,184,0.18)',
        boxShadow:      SHADOW,
        backdropFilter: 'blur(14px)',
      }}
    >
      {/* Credits badge */}
      <div
        className="rounded-[20px] p-4 text-center mb-6"
        style={{ background: 'rgba(254,243,199,0.8)', border: '1px solid #FDE68A' }}
      >
        <div className="text-sm text-amber-700">✨ Kamu masih punya</div>
        <div className="text-4xl font-extrabold text-amber-700 my-1">{creditsRemaining} kredit tersisa</div>
        <div className="text-sm text-amber-600">dari {totalCredits} total kredit paket kamu</div>
        <p className="text-sm text-slate-600 mt-2">CV dasarmu sudah tersimpan – tinggal masukkan job description loker berikutnya.</p>
        <p className="text-sm text-slate-400 mt-1">
          Mau pakai CV yang berbeda?{' '}
          <a href="upload.html?new_package=1" className="text-blue-600 hover:underline" title="Upload CV baru (memerlukan paket baru)">
            Mulai upload baru
          </a>{' '}
          (memerlukan paket baru)
        </p>
      </div>

      {/* JD input section */}
      <div
        className="rounded-[20px] p-5"
        style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}
      >
        <label htmlFor="new-job-desc" className="block font-semibold text-slate-800 mb-3">
          Job yang kamu targetkan selanjutnya
        </label>

        {/* Helper buttons */}
        <div className="flex gap-2 flex-wrap mb-3">
          <button
            type="button"
            onClick={() => { setShowUrlRow(v => !v); setUrlStatus(null); }}
            className="flex items-center gap-1.5 text-sm font-medium rounded-full px-4 py-2 transition-colors"
            style={{ background: 'white', border: '1.5px solid #E2E8F0' }}
            aria-label="Ambil job description dari URL loker seperti LinkedIn atau Glints"
          >
            🔗 Ambil dari URL Loker
          </button>
          <button
            type="button"
            onClick={() => setJobDesc(EXAMPLE_JD)}
            className="flex items-center gap-1.5 text-sm font-medium rounded-full px-4 py-2 transition-colors"
            style={{ background: 'white', border: '1.5px solid #E2E8F0' }}
            aria-label="Isi job description dengan contoh format yang ideal"
          >
            📄 Gunakan contoh
          </button>
        </div>

        {/* URL fetch row */}
        {showUrlRow && (
          <div className="mb-3">
            <div className="flex gap-2 items-center">
              <input
                type="url"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFetchUrl(); }}
                placeholder="https://www.linkedin.com/jobs/view/…"
                aria-label="URL halaman lowongan kerja"
                className="flex-1 rounded-[10px] px-3 py-2 text-sm outline-none transition-colors"
                style={{ border: '1.5px solid #BFDBFE' }}
              />
              <button
                type="button"
                onClick={handleFetchUrl}
                disabled={fetchingUrl}
                className="rounded-[10px] px-4 py-2 text-sm font-semibold text-white whitespace-nowrap disabled:opacity-60"
                style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)' }}
                aria-label="Ambil job description dari URL"
              >
                {fetchingUrl ? 'Mengambil...' : 'Ambil'}
              </button>
              <button
                type="button"
                onClick={() => { setShowUrlRow(false); setUrlStatus(null); }}
                className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-lg px-2"
                aria-label="Tutup form URL"
              >
                ✕
              </button>
            </div>
            {urlStatus && (
              <p className="text-sm mt-1" style={{ color: urlStatus.ok ? '#059669' : '#DC2626' }}>
                {urlStatus.text}
              </p>
            )}
          </div>
        )}

        {/* Textarea */}
        <div className="relative">
          <textarea
            id="new-job-desc"
            rows={5}
            maxLength={5000}
            value={jobDesc}
            onChange={e => { setJobDesc(e.target.value); setTextDir(e.target); }}
            placeholder="Paste bagian Requirements dan Responsibilities dari loker selanjutnya..."
            aria-label="Job description untuk loker berikutnya"
            className="w-full rounded-[16px] px-4 py-3 text-sm resize-y outline-none transition-colors block"
            style={{
              border:           nearLimit ? '1.5px solid #F59E0B' : '1.5px solid #E2E8F0',
              background:       'white',
              fontFamily:       'inherit',
              unicodeBidi:      'plaintext',
            }}
          />
          <div className={`text-right text-sm mt-1 ${nearLimit ? 'text-amber-600' : 'text-slate-400'}`}>
            {charCount.toLocaleString('id-ID')} / 5.000 karakter
          </div>
          {nearLimit && (
            <p className="text-sm text-amber-600 mt-0.5">Mendekati batas karakter</p>
          )}
        </div>

        {/* Generate button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !jobDesc.trim() || overLimit}
          aria-label="Generate CV yang disesuaikan untuk loker berikutnya"
          className="mt-4 w-full min-h-[56px] rounded-[16px] font-bold text-white text-base transition-all hover:-translate-y-[1px] disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0"
          style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: SHADOW }}
        >
          {generating ? '⏳ Menghubungi server...' : '🚀 Generate CV untuk Loker Ini'}
        </button>
      </div>

      {/* Trust footer */}
      <div
        className="rounded-[20px] text-center text-sm text-slate-500 py-3 px-4 mt-5"
        style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}
      >
        🔒 CV aslimu tersimpan aman · Link berlaku 30 hari · Generate kapan saja tanpa login
      </div>
    </div>
  );
}
