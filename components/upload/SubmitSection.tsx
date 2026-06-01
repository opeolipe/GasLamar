interface Props {
  isLoading:   boolean;
  hasCv?:      boolean;
  showJdHint:  boolean;
  jdHintText?: string;
  onSubmit:    () => void;
}

export default function SubmitSection({ isLoading, hasCv = false, showJdHint, jdHintText, onSubmit }: Props) {
  const showCvHint = !hasCv;
  const showChecklist = showCvHint && showJdHint;

  const isFormIncomplete = !hasCv || showJdHint;
  const isDisabled = isLoading || isFormIncomplete;
  const ariaLabel = isLoading
    ? 'Sedang menganalisis CV kamu'
    : isFormIncomplete
      ? 'Lengkapi CV dan job description sebelum analisis dimulai'
      : 'Mulai analisis CV kamu';

  return (
    <div className="mt-6">
      <button
        type="button"
        id="submit-btn"
        data-testid="submit-upload"
        onClick={onSubmit}
        disabled={isDisabled}
        aria-label={ariaLabel}
        className={`min-h-[56px] w-full rounded-full px-6 py-4 text-white font-bold text-base border-0 transition-all flex items-center justify-center gap-2 ${
          isDisabled
            ? 'opacity-60 cursor-not-allowed'
            : 'hover:-translate-y-[2px] active:scale-[0.97] active:translate-y-0 cursor-pointer'
        }`}
        style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
      >
        {isLoading ? (
          <>
            <span className="inline-block w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
            Menganalisis CV kamu...
          </>
        ) : isDisabled ? 'Lengkapi CV & job description dulu'
        : 'Cek peluang saya'}
      </button>

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
          Upload atau paste CV kamu untuk memulai analisis.
        </p>
      ) : showJdHint ? (
        <p className="text-center text-sm text-slate-500 mt-3">
          {jdHintText || 'Job description wajib diisi sebelum analisis dimulai.'}
        </p>
      ) : null}
    </div>
  );
}
