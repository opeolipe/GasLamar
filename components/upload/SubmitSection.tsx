interface Props {
  isLoading:    boolean;
  isSubmitted?: boolean;
  hasCv?:       boolean;
  showJdHint:   boolean;
  jdHintText?:  string;
  cvHintText?:  string;
  onSubmit:     () => void;
}

export default function SubmitSection({ isLoading, isSubmitted = false, hasCv = false, showJdHint, jdHintText, cvHintText, onSubmit }: Props) {
  const showCvHint = !hasCv;
  const showChecklist = showCvHint && showJdHint;

  const isFormIncomplete = !hasCv || showJdHint;
  const isDisabled = isLoading || isSubmitted || isFormIncomplete;

  const defaultCvHint = 'Upload atau paste CV kamu dulu';

  function getButtonLabel() {
    if (isSubmitted) return 'CV berhasil dikirim, mengarahkan ke analisis';
    if (isLoading) return 'Sedang menganalisis CV kamu';
    if (!hasCv)    return cvHintText ?? defaultCvHint;
    if (showJdHint) return 'Lengkapi CV & job description sebelum analisis dimulai';
    return 'Mulai analisis CV kamu';
  }

  return (
    <div className="mt-6">
      {/* Success toast */}
      {isSubmitted && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200"
        >
          <span aria-hidden="true">✅</span>
          CV berhasil dikirim! Analisis sedang dimulai...
        </div>
      )}

      <button
        type="button"
        id="submit-btn"
        data-testid="submit-upload"
        onClick={onSubmit}
        disabled={isDisabled}
        aria-label={getButtonLabel()}
        className={`min-h-[56px] w-full rounded-full px-6 py-4 text-white font-bold text-base border-0 transition-all flex items-center justify-center gap-2 ${
          isDisabled
            ? 'opacity-60 cursor-not-allowed'
            : 'hover:-translate-y-[2px] active:scale-[0.97] active:translate-y-0 cursor-pointer'
        }`}
        style={isSubmitted
          ? { background: 'linear-gradient(180deg,#10b981,#059669)', boxShadow: '0 8px 24px rgba(5,150,105,0.30)' }
          : { background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }
        }
      >
        {isSubmitted ? (
          <>
            <span aria-hidden="true">✅</span>
            Terkirim! Mengarahkan ke analisis...
          </>
        ) : isLoading ? (
          <>
            <span className="inline-block w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
            Menganalisis CV kamu...
          </>
        ) : isFormIncomplete ? (
          !hasCv ? (cvHintText ?? defaultCvHint) : 'Isi job description dulu (min. 100 karakter)'
        ) : 'Mulai analisis CV kamu'}
      </button>

      {/* Rate limit notice — always visible near the submit button */}
      {!isFormIncomplete && (
        <p className="text-center text-xs text-slate-400 mt-2">
          Kamu bisa submit 1 analisis per menit.
        </p>
      )}

      {/* Pre-submit completion checklist — shown when multiple things are missing */}
      {showChecklist ? (
        <div className="mt-3 text-center">
          <p className="text-xs font-medium text-slate-500 mb-1.5">Sebelum lanjut, lengkapi dulu:</p>
          <div className="inline-flex flex-col items-start gap-1 text-sm">
            <span className="text-slate-500">
              <span aria-hidden="true" className="text-slate-400 mr-1">—</span>
              Upload atau paste CV kamu
            </span>
            <span className="text-slate-500">
              <span aria-hidden="true" className="text-slate-400 mr-1">—</span>
              Isi job description posisi yang dilamar
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-2">Setelah ini, analisis biasanya selesai kurang dari 1 menit.</p>
        </div>
      ) : showCvHint ? (
        <p className="text-center text-sm text-slate-500 mt-3">
          {cvHintText ?? 'Upload atau paste CV kamu untuk memulai analisis.'}
        </p>
      ) : showJdHint ? (
        <p className="text-center text-sm text-slate-500 mt-3">
          {jdHintText || 'Job description wajib diisi sebelum analisis dimulai.'}
        </p>
      ) : null}
    </div>
  );
}
