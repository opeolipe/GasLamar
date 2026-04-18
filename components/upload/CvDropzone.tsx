import { useRef } from 'react';

interface Props {
  fileName:     string | null;
  fileSize:     string | null;
  error:        string;
  scanWarning:  boolean;
  onFileSelect: (file: File) => void;
  onRemove:     () => void;
}

export default function CvDropzone({ fileName, fileSize, error, scanWarning, onFileSelect, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.add('!border-blue-400/50', '!bg-blue-50/50');
  }
  function onDragLeave(e: React.DragEvent) {
    e.currentTarget.classList.remove('!border-blue-400/50', '!bg-blue-50/50');
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.remove('!border-blue-400/50', '!bg-blue-50/50');
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
        tabIndex={0}
        role="button"
        aria-label="Area upload CV — klik atau tekan Enter untuk memilih file"
        className={`min-h-[160px] rounded-[16px] border border-dashed border-slate-300/40 bg-slate-50/80 grid place-items-center p-5 text-center transition-all hover:border-blue-400/50 hover:bg-blue-50/50 ${!fileName ? 'cursor-pointer' : ''}`}
        onClick={() => { if (!fileName) inputRef.current?.click(); }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        {fileName ? (
          <div className="flex items-center justify-between gap-3 w-full text-left">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-2xl flex-shrink-0">📄</span>
              <div className="min-w-0">
                <div className="font-semibold text-sm text-slate-800 truncate">{fileName}</div>
                {fileSize && <div className="text-xs text-slate-400 mt-0.5">{fileSize}</div>}
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
            <div className="font-semibold text-slate-700 mb-1">Drag &amp; drop CV di sini</div>
            <div className="text-sm text-slate-400 mb-3">atau</div>
            <button
              type="button"
              className="min-h-[44px] px-5 py-2 rounded-full bg-slate-900 text-white text-sm font-medium inline-flex items-center"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
              aria-label="Pilih file CV dari komputer kamu"
            >
              Pilih file
            </button>
            <div className="text-xs text-slate-400 mt-3">PDF, DOCX, atau TXT &nbsp;•&nbsp; maks 5MB</div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          id="cv-file"
          className="hidden"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          aria-label="Upload file CV (PDF, DOCX, atau TXT, maks 5MB)"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f); e.target.value = ''; }}
        />
      </div>

      <p className="text-xs text-amber-700 mt-2">
        ⚠️ Gunakan CV berbentuk teks (bukan scan/foto) agar analisis lebih akurat
      </p>

      {scanWarning && (
        <div className="mt-2 rounded-[12px] px-4 py-2.5 text-sm text-amber-800 bg-amber-50 border border-amber-200">
          <strong>CV tidak bisa dibaca.</strong> CV kamu sepertinya file gambar atau hasil scan. Coba download ulang CV kamu dari Canva/Word sebagai PDF teks, lalu upload lagi.
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-[12px] px-4 py-2.5 text-sm text-red-700 bg-red-50 border border-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
