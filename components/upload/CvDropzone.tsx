import { useRef, useEffect } from 'react';
import { MIN_CV_TEXT_LENGTH, MAX_CV_PASTE_CHARS } from '@/lib/uploadValidation';

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
  const inputRef   = useRef<HTMLInputElement>(null);
  const pasteRef   = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onManualCvChange);
  onChangeRef.current = onManualCvChange;

  // Catch programmatic `.value` assignments (e.g. dev-tools injection) that bypass
  // React's synthetic onChange. Without this listener the character counter stays
  // stale and the 60 000-char hard cap isn't enforced via React state.
  useEffect(() => {
    const el = pasteRef.current;
    if (!el) return;
    function onNativeInput() {
      const capped = el!.value.length > MAX_CV_PASTE_CHARS ? el!.value.slice(0, MAX_CV_PASTE_CHARS) : el!.value;
      if (el!.value !== capped) el!.value = capped;
      onChangeRef.current(capped);
    }
    el.addEventListener('input', onNativeInput);
    return () => el.removeEventListener('input', onNativeInput);
  }, []);

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.add('!border-blue-400', '!bg-blue-50/30');
  }
  function onDragLeave(e: React.DragEvent) {
    e.currentTarget.classList.remove('!border-blue-400', '!bg-blue-50/30');
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.remove('!border-blue-400', '!bg-blue-50/30');
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
        tabIndex={fileName ? -1 : 0}
        role={fileName ? undefined : 'button'}
        aria-label={fileName ? undefined : 'Area upload CV — klik atau tekan Enter untuk memilih file'}
        className={`rounded-2xl border transition-all ${
          fileName
            ? 'border-slate-200 bg-slate-50/40 px-4 py-3'
            : 'min-h-[110px] border-2 border-dashed border-slate-200 bg-transparent grid place-items-center p-5 text-center hover:border-blue-300 hover:bg-blue-50/20 cursor-pointer'
        }`}
        onClick={() => { if (!fileName) inputRef.current?.click(); }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        {fileName ? (
          <div data-testid="file-preview" className="flex items-center justify-between gap-3 w-full text-left">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-base flex-shrink-0" aria-hidden="true">📄</span>
              <div className="min-w-0">
                <div className="font-medium text-sm text-slate-800 truncate">{fileName}</div>
                {fileSize && <div className="text-xs text-slate-400">{fileSize}</div>}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="min-h-[44px] px-3 text-blue-600 font-medium text-sm whitespace-nowrap hover:underline flex-shrink-0"
              aria-label="Ganti file CV yang sudah dipilih"
            >
              Ganti
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              className="min-h-[44px] px-6 py-2 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-[0.97] text-white text-sm font-semibold inline-flex items-center gap-1.5 transition-all"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
              aria-label="Pilih file CV dari komputer kamu"
            >
              Pilih CV
            </button>
            <p className="text-sm text-slate-400">
              atau seret file ke sini &nbsp;·&nbsp; PDF, DOCX, TXT &nbsp;·&nbsp; maks 5MB
            </p>
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

      <p className="text-xs text-slate-400 mt-2">
        Gunakan CV yang bisa dicopy, bukan foto/scan.
      </p>

      <div className="mt-4 w-full max-w-full">
        <label htmlFor="cv-paste" className="block text-sm font-semibold text-slate-700 mb-1">
          Atau paste isi CV di sini
        </label>
        <textarea
          ref={pasteRef}
          id="cv-paste"
          value={manualCvText}
          onChange={(e) => onManualCvChange(e.target.value)}
          maxLength={MAX_CV_PASTE_CHARS}
          className="block w-full max-w-full min-h-[140px] rounded-2xl border border-slate-200 bg-transparent p-4 text-sm text-slate-900 resize-y outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:ring-offset-1"
          placeholder="Paste isi CV kamu di sini..."
          aria-label="Paste isi CV secara manual"
        />
        <div className="flex items-center justify-between mt-1 text-xs">
          {manualCvText.trim().length > 0 && manualCvText.trim().length < MIN_CV_TEXT_LENGTH ? (
            <span className="text-amber-600 font-medium">
              ⚠️ Terlalu singkat — tambahkan detail pengalaman &amp; skill
            </span>
          ) : (
            <span />
          )}
          <span className="text-slate-400 ml-auto">
            {manualCvText.length.toLocaleString('id-ID')}
            {manualCvText.trim().length < MIN_CV_TEXT_LENGTH && manualCvText.length > 0
              ? ` / min. ${MIN_CV_TEXT_LENGTH}`
              : ` / ${MAX_CV_PASTE_CHARS.toLocaleString('id-ID')}`} karakter
          </span>
        </div>
      </div>

      {scanWarning && (
        <div className="mt-2 rounded-[10px] px-3 py-2.5 text-sm font-medium bg-amber-50 border border-amber-200 text-amber-800">
          ⚠️ PDF ini sepertinya hasil scan atau gambar — teks tidak bisa dibaca. Coba upload versi DOCX atau PDF yang bisa di-copy.
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-[10px] px-3 py-2.5 text-sm font-medium bg-red-50 border border-red-200 text-red-700">
          ⚠️ {error}
        </div>
      )}

      {!error && !scanWarning && fileName && cvReady && (
        <p className="text-sm text-emerald-600 mt-2 font-medium">✓ CV berhasil dibaca</p>
      )}
    </div>
  );
}
