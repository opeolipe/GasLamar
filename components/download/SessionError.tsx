import StateCard from '@/components/ui/StateCard';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

interface Props {
  title:      string;
  message:    string;
  retryable?: boolean;
  reason?:    string;
  onRetry?:   () => void;
  onRestart:  () => void;
}

export default function SessionError({ title, message, retryable = false, reason, onRetry, onRestart }: Props) {
  const recoveryLine = reason === 'auth_failure'
    ? 'Akses kamu belum hilang. Buka halaman akses dan masukkan email pembayaran.'
    : 'Kamu belum kehilangan hasil. Coba lanjutkan dengan tombol di bawah.';

  return (
    <StateCard
      icon={(
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 8v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
      title={title}
      message={message}
      helper={recoveryLine}
      tone="danger"
    >
      <div className="flex flex-col gap-3 items-center">
        {retryable && onRetry && (
          <button
            data-testid="generate-cv-button"
            onClick={onRetry}
            className="min-h-[48px] px-6 rounded-[16px] font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
            style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: SHADOW }}
          >
            Coba Lagi
          </button>
        )}
        {!retryable && reason === 'auth_failure' && (
          <a
            href="access.html"
            className="min-h-[48px] px-6 rounded-full font-bold text-white text-sm inline-flex items-center transition-all hover:-translate-y-[1px]"
            style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          >
            Buka Halaman Akses
          </a>
        )}
        {!retryable && reason !== 'auth_failure' && (
          <a
            href="upload.html"
            onClick={onRestart}
            className="min-h-[48px] px-6 rounded-full font-bold text-white text-sm inline-flex items-center transition-all hover:-translate-y-[1px]"
            style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          >
            Mulai Ulang
          </a>
        )}
        <a
          href="mailto:support@gaslamar.com"
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          Butuh bantuan? Hubungi support
        </a>
      </div>
    </StateCard>
  );
}
