const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

interface Props {
  /** If true, show the 3-Pack upsell (for coba/single users) */
  showUpsell?: boolean;
}

export default function UpgradeNudge({ showUpsell = false }: Props) {
  if (showUpsell) {
    return (
      <div
        className="rounded-[24px] p-6 text-center"
        style={{
          background: 'rgba(37,99,235,0.05)',
          border:     '1.5px solid rgba(37,99,235,0.18)',
        }}
      >
        <div className="text-sm font-bold inline-block px-3 py-1 rounded-full mb-4" style={{ background: '#FEF3C7', color: '#92400E' }}>
          <span aria-hidden="true">💰</span> Hemat 40% vs beli satuan
        </div>
        <h3 className="text-base font-semibold text-slate-900 mb-2"><span aria-hidden="true">🎯</span> Apply ke beberapa posisi minggu ini?</h3>
        <p className="text-sm text-blue-700 mb-5">
          <strong>3-Pack</strong> — Rp 149.000 untuk 3 CV bilingual yang masing-masing di-tailor.
          <br />Hemat 40% dibanding beli satuan.
        </p>
        <a
          href="upload.html?new_package=1&tier=3pack"
          className="inline-flex items-center min-h-[44px] px-8 rounded-full font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
          style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          title="Mulai analisis CV baru dengan paket 3-Pack"
        >
          Upgrade ke 3-Pack →
        </a>
      </div>
    );
  }

  return (
    <div
      className="rounded-[24px] p-6 text-center"
      style={{
        background:     'rgba(255,255,255,0.88)',
        border:         '1px solid rgba(148,163,184,0.14)',
        boxShadow:      SHADOW,
        backdropFilter: 'blur(14px)',
      }}
    >
      <div className="text-3xl mb-3" aria-hidden="true">🎉</div>
      <h3 className="font-semibold text-slate-900 mb-2" style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>Semua kredit sudah terpakai!</h3>
      <p className="text-sm text-slate-500 mb-5">
        Kredit kamu sudah habis. Masih ada loker lain yang ingin kamu lamar? Beli paket baru untuk CV yang disesuaikan.
      </p>
      <a
        href="upload.html?new_package=1"
        className="inline-flex items-center min-h-[44px] px-6 rounded-full font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
        style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
        title="Beli paket baru untuk loker lain"
      >
        Beli Paket untuk Loker Baru
      </a>
      <p className="text-sm text-slate-400 mt-3">Bisa pakai CV yang sama atau upload CV yang sudah diperbarui</p>
    </div>
  );
}
