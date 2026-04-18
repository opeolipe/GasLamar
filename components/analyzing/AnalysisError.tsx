interface Props {
  message: string;
  onRetry: () => void;
}

export default function AnalysisError({ message, onRetry }: Props) {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-3">⚠️</div>
      <h3 className="text-[#991B1B] font-bold text-lg mb-2">Analisis Gagal</h3>
      <p className="text-[#B91C1C] text-[0.9rem] mb-6 max-w-sm mx-auto leading-relaxed">
        {message}
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <button
          onClick={onRetry}
          className="bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors min-h-[44px] cursor-pointer"
        >
          Coba Lagi
        </button>
        <a
          href="upload.html"
          className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-5 py-2.5 rounded-xl transition-colors inline-flex items-center min-h-[44px]"
        >
          Ganti CV / Job
        </a>
      </div>
    </div>
  );
}
