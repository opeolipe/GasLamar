import { useRef } from 'react';

interface Props {
  fileName:     string | null;
  fileSize:     string | null;
  error:        string;
  cvReady:      boolean;
  scanWarning:  boolean;
  manualCvText: string;
  onManualCvChange: (value: string) => void;
  onFileSelect: (file: File) => void;
  onRemove:     () => void;
}

export default function CvDropzone({ fileName, fileSize, error, cvReady, scanWarning, manualCvText, onManualCvChange, onFileSelect, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.add('!border-blue-500', '!bg-blue-50/40');
  }
  function onDragLeave(e: React.DragEvent) {
    e.currentTarget.classList.remove('!border-blue-500', '!bg-blue-50/40');
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.remove('!border-blue-500', '!bg-blue-50/40');
    const f = e.dataTransfer.files[0];
    if (f) onFileSelect(f);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ' ') && !fileName) {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div>
      <div
        data-testid="dropzone"
        tabIndex={0}
        role="button"
        aria-label="Area upload CV — klik atau tekan Enter untuk memilih file"
        className={`min-h-[160px] rounded-2xl border-2 border-dashed border-slate-300 bg-transparent grid place-items-center p-5 text-center transition-all hover:border-blue-400 hover:bg-blue-50/30 ${!fileName ? 'cursor-pointer' : ''}`}
        onClick={() => { if (!fileName) inputRef.current?.click(); }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        {fileName ? (
          <div data-testid="file-preview" className="flex items-center justify-between gap-3 w-full text-left">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-2xl flex-shrink-0">📄</span>
              <div className="min-w-0">
                <div className="font-semibold text-sm text-slate-800 truncate">{fileName}</div>
                {fileSize && <div className="text-sm text-slate-400 mt-0.5">{fileSize}</div>}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="min-h-[44px] px-3 text-blue-600 font-medium text-sm whitespace-nowrap hover:underline"
              aria-label="Ganti file CV yang sudah dipilih"
            >
              Ganti file
            </button>
          </div>
        ) : (
          <div>
            <div className="text-3xl mb-2">📁</div>
            <div className="font-semibold text-slate-700 mb-3">Upload CV kamu</div>
            <button
              type="button"
              className="min-h-[44px] px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center transition-colors"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
              aria-label="Pilih file CV dari komputer kamu"
            >
              Pilih file
            </button>
            <div className="text-sm text-slate-400 mt-3">PDF, DOCX, atau TXT &nbsp;•&nbsp; maks 5MB</div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          id="cv-file"
          data-testid="file-input"
          className="hidden"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          aria-label="Upload file CV (PDF, DOCX, atau TXT, maks 5MB)"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f); e.target.value = ''; }}
        />
      </div>

      <p className="text-sm text-slate-400 mt-2">Pastikan CV kamu berisi teks yang bisa di-copy (bukan hasil scan/foto) untuk hasil analisis terbaik.</p>

      <div className="mt-4 w-full max-w-full">
        <label htmlFor="cv-paste" className="block text-sm font-semibold text-slate-700 mb-2">
          Atau copy-paste langsung isi CV Anda di sini
        </label>
        <textarea
          id="cv-paste"
          value={manualCvText}
          onChange={(e) => onManualCvChange(e.target.value)}
          className="block w-full max-w-full min-h-[150px] rounded-2xl border border-slate-300 bg-transparent p-4 text-sm text-slate-900 resize-y outline-none transition-all focus:border-blue-500/50 focus:ring-2 focus:ring-slate-200 focus:ring-offset-2"
          placeholder="Paste isi CV kamu jika upload file bermasalah. Sertakan pengalaman, pendidikan, skill, dan kontak utama."
          aria-label="Paste isi CV secara manual"
        />
        <div className="text-right text-sm mt-1 text-slate-400">
          {manualCvText.length.toLocaleString('id-ID')} karakter
        </div>
      </div>

      {scanWarning && (
        <div className="mt-2 rounded-[10px] px-3 py-2.5 text-sm font-medium bg-amber-50 border border-amber-200 text-amber-800">
          ⚠️ PDF ini sepertinya hasil scan atau gambar — teks tidak bisa dibaca. Coba upload versi DOCX atau PDF yang bisa di-copy.
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 mt-2">{error}</p>
      )}

      {!error && !scanWarning && fileName && cvReady && (
        <p className="text-sm text-emerald-600 mt-2">✓ CV siap dianalisis</p>
      )}
    </div>
  );
}
