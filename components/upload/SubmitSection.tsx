interface Props {
  isLoading: boolean;
  onSubmit:  () => void;
}

export default function SubmitSection({ isLoading, onSubmit }: Props) {
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

      <p className="text-center text-xs text-slate-400 mt-4 leading-relaxed">
        Tanpa daftar&nbsp;·&nbsp;analisis ±30 detik&nbsp;·&nbsp;CV tidak disimpan
      </p>
    </div>
  );
}
