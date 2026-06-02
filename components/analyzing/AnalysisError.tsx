import StateCard from '@/components/ui/StateCard';

interface Props {
  message:           string;
  onRetry:           () => void;
  isFileError?:      boolean;
  isRateLimit?:      boolean;
  rateLimitSecsLeft?: number;
}

function formatWait(secs: number): string {
  return secs >= 60 ? `${Math.ceil(secs / 60)} menit` : `${secs} detik`;
}

export default function AnalysisError({ message, onRetry, isFileError = false, isRateLimit = false, rateLimitSecsLeft = 0 }: Props) {
  const retryBlocked = isRateLimit && rateLimitSecsLeft > 0;

  const recoveryLine = isFileError
    ? 'Tenang, ini biasanya karena format file sulit dibaca.'
    : isRateLimit
      ? 'Tombol "Coba Lagi" akan aktif otomatis saat hitungan mundur selesai.'
      : 'Proses belum berhasil, tapi progres kamu aman dan bisa lanjut lagi.';

  const icon = isRateLimit ? <span className="text-3xl">⏳</span> : <span className="text-3xl">⚠️</span>;
  const title = isRateLimit ? 'Terlalu Banyak Permintaan' : 'Analisis Gagal';

  return (
    <StateCard
      icon={icon}
      title={title}
      message={isRateLimit && retryBlocked ? `⏳ Terlalu banyak permintaan. Silakan coba lagi dalam ${formatWait(rateLimitSecsLeft)}.` : message}
      helper={recoveryLine}
      tone={isFileError ? 'warning' : 'danger'}
    >
      {isFileError && (
        <p className="text-amber-600 text-[0.8rem] mb-4 max-w-xs mx-auto">
          <span aria-hidden="true">💡</span><span className="sr-only">Tip: </span> Klik "Ganti CV / Job" untuk upload ulang dalam format DOCX atau TXT agar bisa dibaca.
        </p>
      )}
      <div className="flex gap-3 justify-center flex-wrap">
        {!isFileError && (
          <button
            onClick={retryBlocked ? undefined : onRetry}
            disabled={retryBlocked}
            aria-label={retryBlocked ? `Coba lagi dalam ${rateLimitSecsLeft} detik` : 'Coba lagi'}
            className={`text-white font-semibold px-5 py-2.5 rounded-full transition-all min-h-[44px] border-0 ${retryBlocked ? 'opacity-50 cursor-not-allowed' : 'hover:-translate-y-[1px] cursor-pointer'}`}
            style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          >
            {retryBlocked ? `Tunggu ${rateLimitSecsLeft >= 60 ? Math.ceil(rateLimitSecsLeft / 60) + 'm' : rateLimitSecsLeft + 's'}...` : 'Coba Lagi'}
          </button>
        )}
        <a
          href="upload.html"
          className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-5 py-2.5 rounded-full transition-colors inline-flex items-center min-h-[44px]"
        >
          Ganti CV / Job
        </a>
      </div>
    </StateCard>
  );
}
