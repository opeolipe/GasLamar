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

  return (
    <div className="mt-6">
      <button
        type="button"
        id="submit-btn"
        data-testid="submit-upload"
        onClick={onSubmit}
        disabled={isLoading}
        className="min-h-[56px] w-full rounded-full px-6 py-4 text-white font-bold text-base border-0 transition-all hover:-translate-y-[2px] active:scale-[0.97] active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0 disabled:active:scale-100 flex items-center justify-center gap-2"
        style={{ background: '#1B4FE8', boxShadow: '0 8px 24px rgba(27,79,232,0.28), 0 2px 8px rgba(27,79,232,0.12)' }}
        aria-label="Mulai analisis CV kamu"
      >
        {isLoading ? (
          <>
            <span className="inline-block w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
            Menganalisis CV kamu...
          </>
        ) : 'Cek peluang saya'}
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
