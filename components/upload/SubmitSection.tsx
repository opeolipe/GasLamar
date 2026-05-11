interface Props {
  isLoading:   boolean;
  showJdHint:  boolean;
  jdHintText?: string;
  onSubmit:    () => void;
}

export default function SubmitSection({ isLoading, showJdHint, jdHintText, onSubmit }: Props) {
  return (
    <div className="mt-6">
      <button
        type="button"
        id="submit-btn"
        data-testid="submit-upload"
        onClick={onSubmit}
        disabled={isLoading}
        className="min-h-[56px] w-full rounded-full px-6 py-4 text-white font-bold text-base border-0 transition-all hover:-translate-y-[2px] disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0 flex items-center justify-center gap-2"
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

      {showJdHint && (
        <p className="text-center text-sm text-slate-500 mt-3">
          {jdHintText || 'Job description wajib diisi sebelum analisis dimulai.'}
        </p>
      )}

    </div>
  );
}
