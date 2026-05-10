import { useRef } from 'react';
interface Props {
  isValid:        boolean;
  isLoading:      boolean;
  showJdHint:     boolean;
  onSubmit:       () => void;
}

export default function SubmitSection({ isValid, isLoading, showJdHint, onSubmit }: Props) {
  const btnRef   = useRef<HTMLButtonElement>(null);
  const canSubmit = isValid && !isLoading;

  return (
    <div className="mt-6">
      <button
        ref={btnRef}
        type="button"
        id="submit-btn"
        data-testid="submit-upload"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="min-h-[56px] w-full rounded-full px-6 py-4 text-white font-bold text-base border-0 transition-all hover:-translate-y-[2px] disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 flex items-center justify-center gap-2"
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
          Tambahkan job description untuk hasil analisis yang lebih akurat (opsional).
        </p>
      )}

      <p className="text-center text-sm text-slate-500 mt-4 leading-relaxed">
        CV tidak disimpan&nbsp;·&nbsp;tanpa registrasi&nbsp;·&nbsp;analisis ±30 detik&nbsp;·&nbsp;hasil gratis aktif 2 jam
      </p>
    </div>
  );
}
