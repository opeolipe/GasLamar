interface Props {
  message:     string;
  onRetry:     () => void;
  isFileError?: boolean;
}

export default function AnalysisError({ message, onRetry, isFileError = false }: Props) {
  return (
    <div data-testid="error-message" className="text-center py-8">
      <div className="text-4xl mb-3">⚠️</div>
      <h3
        className="font-semibold text-lg text-slate-900 mb-2"
        style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}
      >
        Analisis Gagal
      </h3>
      <p className="text-slate-500 text-[0.85rem] mb-6 max-w-sm mx-auto leading-relaxed">
        {message}
      </p>
      {isFileError && (
        <p className="text-amber-600 text-[0.8rem] mb-4 max-w-xs mx-auto">
          💡 Tip: Klik "Ganti CV / Job" untuk upload ulang dalam format DOCX atau TXT agar bisa dibaca.
        </p>
      )}
      <div className="flex gap-3 justify-center flex-wrap">
        {!isFileError && (
          <button
            onClick={onRetry}
            className="text-white font-semibold px-5 py-2.5 rounded-full transition-all hover:-translate-y-[1px] min-h-[44px] cursor-pointer border-0"
            style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          >
            Coba Lagi
          </button>
        )}
        <a
          href="upload.html"
          className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-5 py-2.5 rounded-full transition-colors inline-flex items-center min-h-[44px]"
        >
          Ganti CV / Job
        </a>
      </div>
    </div>
  );
}
