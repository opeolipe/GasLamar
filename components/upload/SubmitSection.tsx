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
        className="min-h-[56px] w-full rounded-full px-6 py-4 text-white font-bold text-base border-0 transition-all hover:-translate-y-[2px] disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0 flex items-center justify-center gap-2 group"
        style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.35), 0 2px 8px rgba(37,99,235,0.20)' }}
        aria-label="Mulai analisis CV kamu"
      >
        {isLoading ? (
          <>
            <span className="inline-block w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
            Menganalisis CV kamu...
          </>
        ) : '👉 Cek peluang saya'}
      </button>

      {showJdHint && (
        <p className="text-center text-xs text-amber-700 mt-3">
          Lengkapi job description untuk melanjutkan analisis.
        </p>
      )}

      <p className="text-center text-xs text-slate-400 mt-4">
        CV tidak disimpan • tanpa registrasi • hasil dalam ±30 detik
      </p>
    </div>
  );
}
