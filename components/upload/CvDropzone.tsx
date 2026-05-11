import { useRef, useEffect, useState } from 'react';
import { MIN_CV_TEXT_LENGTH, MAX_CV_PASTE_CHARS } from '@/lib/uploadValidation';

interface Props {
  fileName:         string | null;
  fileSize:         string | null;
  error:            string;
  cvReady:          boolean;
  scanWarning:      boolean;
  manualCvText:     string;
  onManualCvChange: (value: string) => void;
  onFileSelect:     (file: File) => void;
  onRemove:         () => void;
  onTabChange?:     (tab: 'upload' | 'paste') => void;
}

export default function CvDropzone({ fileName, fileSize, error, cvReady, scanWarning, manualCvText, onManualCvChange, onFileSelect, onRemove, onTabChange }: Props) {
  const inputRef    = useRef<HTMLInputElement>(null);
  const pasteRef    = useRef<HTMLTextAreaElement>(null);
  const onChangeRef    = useRef(onManualCvChange);
  onChangeRef.current  = onManualCvChange;
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;

  const [tab, setTab] = useState<'upload' | 'paste'>('upload');

  function switchTab(next: 'upload' | 'paste') {
    setTab(next);
    onTabChangeRef.current?.(next);
  }

  const isPastedCv = fileSize === '(teks ditempel)';
  const isFileCv   = !!fileName && !isPastedCv && cvReady;

  // Catch programmatic `.value` assignments that bypass React's synthetic onChange.
  // Depends on `tab` so it re-registers each time the paste textarea mounts
  // (the textarea is conditionally rendered — pasteRef.current is null on upload tab).
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
  }, [tab]);

  // Follow the active CV source when it changes externally (e.g. session restore).
  useEffect(() => {
    if (isPastedCv) switchTab('paste');
    else if (isFileCv) switchTab('upload');
  }, [isPastedCv, isFileCv]);

  function handleFileSelect(file: File) {
    switchTab('upload');
    onFileSelect(file);
  }

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
    if (f) handleFileSelect(f);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  const pasteReady = manualCvText.trim().length >= MIN_CV_TEXT_LENGTH;
  const pasteShort = manualCvText.trim().length > 0 && !pasteReady;

  return (
    <div className="w-full max-w-full overflow-hidden">
      <p className="text-sm font-semibold mb-2">CV kamu</p>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-3" role="tablist" aria-label="Cara input CV">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upload'}
          onClick={() => switchTab('upload')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
            tab === 'upload'
              ? 'bg-white shadow-sm text-slate-900'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Upload file
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'paste'}
          onClick={() => switchTab('paste')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
            tab === 'paste'
              ? 'bg-white shadow-sm text-slate-900'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Paste CV
        </button>
      </div>

      {/* Upload tab */}
      {tab === 'upload' && (
        isFileCv ? (
          /* Compact success state */
          <div
            data-testid="file-preview"
            className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-base flex-shrink-0" aria-hidden="true">📄</span>
              <div className="min-w-0">
                <div className="font-medium text-sm text-slate-800 truncate">{fileName}</div>
                {fileSize && <div className="text-xs text-slate-400">{fileSize}</div>}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-sm text-emerald-600 font-medium"><span aria-hidden="true">✓</span> Siap</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="min-h-[44px] px-3 text-blue-600 font-medium text-sm whitespace-nowrap hover:underline inline-flex items-center"
                aria-label="Ganti file CV yang sudah dipilih"
              >
                Ganti
              </button>
            </div>
          </div>
        ) : (
          /* Dropzone */
          <div
            data-testid="dropzone"
            tabIndex={0}
            role="button"
            aria-label="Area upload CV — klik atau tekan Enter untuk memilih file"
            className="min-h-[110px] rounded-2xl border-2 border-dashed border-slate-200 bg-transparent grid place-items-center p-5 text-center hover:border-blue-300 hover:bg-blue-50/20 cursor-pointer transition-all"
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onKeyDown={onKeyDown}
          >
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
          </div>
        )
      )}

      {/* Paste tab */}
      {tab === 'paste' && (
        <div className="w-full max-w-full">
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
          <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-1 mt-1 text-xs min-w-0">
            {pasteShort ? (
              <span className="text-amber-600 font-medium min-w-0 break-words" style={{ overflowWrap: 'anywhere' }}>
                <span aria-hidden="true">⚠️</span><span className="sr-only">Peringatan: </span> Terlalu singkat — tambahkan detail pengalaman &amp; skill
              </span>
            ) : pasteReady ? (
              <span className="text-emerald-600 font-medium"><span aria-hidden="true">✓</span> CV siap</span>
            ) : (
              <span />
            )}
            <span className="text-slate-400 flex-shrink-0">
              {manualCvText.length.toLocaleString('id-ID')}
              {pasteShort
                ? ` / min. ${MIN_CV_TEXT_LENGTH}`
                : ` / ${MAX_CV_PASTE_CHARS.toLocaleString('id-ID')}`} karakter
            </span>
          </div>
        </div>
      )}

      {/* Hidden file input — always mounted so it survives tab switches */}
      <input
        ref={inputRef}
        type="file"
        id="cv-file"
        data-testid="file-input"
        className="hidden"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        aria-label="Upload file CV (PDF, DOCX, atau TXT, maks 5MB)"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }}
      />

      {tab === 'upload' && !isFileCv && (
        <p className="text-xs text-slate-400 mt-2">
          Gunakan CV yang bisa dicopy, bukan foto/scan.
        </p>
      )}

      {scanWarning && (
        <div className="mt-2 rounded-[10px] px-3 py-2.5 text-sm font-medium bg-amber-50 border border-amber-200 text-amber-800">
          <span aria-hidden="true">⚠️</span><span className="sr-only">Peringatan: </span> PDF ini sepertinya hasil scan atau gambar — teks tidak bisa dibaca. Coba upload versi DOCX atau PDF yang bisa di-copy.
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-[10px] px-3 py-2.5 text-sm font-medium bg-red-50 border border-red-200 text-red-700">
          <span aria-hidden="true">⚠️</span> {error}
        </div>
      )}
    </div>
  );
}
