import { useRef } from 'react';

interface Props {
  isValid:   boolean;
  isLoading: boolean;
  onSubmit:  () => void;
}

export default function SubmitSection({ isValid, isLoading, onSubmit }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="mt-6">
      <button
        ref={btnRef}
        type="button"
        id="submit-btn"
        onClick={onSubmit}
        disabled={!isValid || isLoading}
        className="min-h-[56px] w-full rounded-full px-6 py-4 text-white font-bold text-base border-0 transition-all bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 hover:shadow-md hover:-translate-y-[1px] disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0 flex items-center justify-center gap-2"
        aria-label="Mulai analisis CV kamu"
      >
        {isLoading ? (
          <>
            <span className="inline-block w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
            Menganalisis CV kamu...
          </>
        ) : '👉 Analisis CV Saya'}
      </button>

      <p className="text-center text-xs text-slate-400 mt-4">
        CV tidak disimpan • tanpa registrasi • hasil dalam ±30 detik
      </p>
    </div>
  );
}
