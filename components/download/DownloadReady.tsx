import { useState, useRef } from 'react';
import MobileFallback       from '@/components/download/MobileFallback';
import UpgradeNudge         from '@/components/download/UpgradeNudge';
import MultiCreditSection   from '@/components/download/MultiCreditSection';
import { isBilingual }      from '@/lib/downloadUtils';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

// ── Types ────────────────────────────────────────────────────────────────────

type FeedbackType = 'ya' | 'proses' | 'tidak';

interface Props {
  tier:             string;
  filename:         string;
  expiryText:       string;
  cvTextId:         string;
  cvTextEn:         string | null;
  creditsRemaining: number;
  totalCredits:     number;
  showDownloadGrid: boolean;
  onDownload:       (lang: 'id' | 'en', format: 'docx' | 'pdf') => void;
  onFeedback:       (type: FeedbackType) => void;
  onGenerateNext:   (jobDesc: string) => Promise<void> | void;
  onUrlFetch:       (url: string) => Promise<string>;
  showMobileFallback: boolean;
}

// ── DownloadSteps ────────────────────────────────────────────────────────────

function DownloadSteps() {
  return (
    <div className="relative flex justify-between mb-0">
      <div className="absolute top-[11px] left-0 right-0 h-px bg-slate-200 z-0" />
      {[
        { label: '1. Upload',   done: true,  active: false },
        { label: '2. Hasil',    done: true,  active: false },
        { label: '3. Download', done: false, active: true  },
      ].map((s, i) => (
        <div key={i} className="relative z-10 flex flex-col items-center text-center flex-1">
          <span className={`block text-[0.7rem] font-bold leading-none mb-1 ${s.done ? 'text-emerald-500' : 'text-slate-900'}`}>
            {s.done ? '✓' : '●'}
          </span>
          <span className={`text-[0.82rem] leading-tight ${s.done ? 'text-emerald-600 font-semibold' : 'text-slate-900 font-bold'}`}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── DownloadButton ────────────────────────────────────────────────────────────

interface DownloadButtonProps {
  lang:     'id' | 'en';
  fmt:      'docx' | 'pdf';
  label:    string;
  size:     string;
  ariaLabel: string;
  onClick:  () => void;
}

function DownloadButton({ label, size, ariaLabel, onClick }: DownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-full min-h-[44px] rounded-full flex items-center justify-between px-4 py-2 text-sm font-medium transition-all hover:translate-x-1"
      style={{ background: 'white', border: '1px solid rgba(37,99,235,0.2)', color: '#1E3A8A' }}
    >
      <span>{label}</span>
      <span className="text-xs text-slate-400">{size}</span>
    </button>
  );
}

// ── PostDownloadCard ──────────────────────────────────────────────────────────

interface PostDlCardProps {
  creditsRemaining: number;
  onDismiss:        () => void;
  onScrollToMulti:  () => void;
  onShowTips:       () => void;
}

function PostDownloadCard({ creditsRemaining, onDismiss, onScrollToMulti, onShowTips }: PostDlCardProps) {
  if (creditsRemaining > 0) {
    return (
      <div className="rounded-[20px] p-5 mb-4 relative" style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE' }}>
        <button
          onClick={onDismiss}
          aria-label="Tutup notifikasi"
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-base leading-none p-1"
        >
          ✕
        </button>
        <div className="font-bold text-slate-900 mb-1 pr-6">🎯 Lamaran pertama sudah siap!</div>
        <p className="text-sm text-slate-600 mb-4">
          Kamu masih punya <strong>{creditsRemaining} kredit</strong> tersisa. Tailor CV untuk loker lain — scroll ke atas dan masukkan job description baru.
        </p>
        <button
          onClick={onScrollToMulti}
          className="inline-flex items-center min-h-[40px] px-4 rounded-[14px] font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
          style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: SHADOW }}
        >
          ✍️ Siapkan CV Lain
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] p-5 mb-4 relative" style={{ background: '#F0FDF4', border: '1.5px solid #86EFAC' }}>
      <button
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-base leading-none p-1"
      >
        ✕
      </button>
      <div className="font-bold text-slate-900 mb-1 pr-6">🚀 CV kamu sudah siap dikirim!</div>
      <p className="text-sm text-slate-600 mb-4">
        Tingkatkan peluang interview dengan persiapan yang matang, atau beli paket hemat untuk loker berikutnya.
      </p>
      <div className="flex gap-2 flex-wrap">
        <a
          href="/?tier=3pack"
          className="inline-flex items-center min-h-[40px] px-4 rounded-[14px] font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
          style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: SHADOW }}
        >
          📦 Beli Paket Hemat
        </a>
        <button
          onClick={onShowTips}
          className="inline-flex items-center min-h-[40px] px-4 rounded-[14px] font-semibold text-sm text-slate-700 transition-colors"
          style={{ background: 'white', border: '1.5px solid #E2E8F0' }}
        >
          💡 Tips Interview
        </button>
      </div>
    </div>
  );
}

// ── InterviewTipsModal ────────────────────────────────────────────────────────

function InterviewTipsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tips-modal-heading"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-[20px] p-7 max-w-[480px] w-full max-h-[80vh] overflow-y-auto relative">
        <button
          onClick={onClose}
          aria-label="Tutup tips interview"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-xl"
        >
          ✕
        </button>
        <h2 id="tips-modal-heading" className="font-bold text-lg text-slate-900 mb-5 pr-8">
          💡 3 Tips Tingkatkan Peluang Interview
        </h2>
        {[
          {
            icon: '🔍',
            text: <><strong>Riset perusahaan 15 menit sebelum interview.</strong> Baca halaman "About", produk utama, dan berita terbaru mereka. Interviewer selalu terkesan dengan kandidat yang tahu konteks bisnis perusahaan.</>,
          },
          {
            icon: '📐',
            text: <><strong>Gunakan format STAR untuk jawaban behavioural.</strong> Situasi → Tugas → Aksi → Hasil. Siapkan 3–5 cerita konkret dari pengalaman kerja atau proyek.</>,
          },
          {
            icon: '❓',
            text: <><strong>Siapkan 2 pertanyaan untuk interviewer.</strong> Contoh: "Seperti apa kesuksesan di 90 hari pertama di posisi ini?" Bertanya menunjukkan kamu serius dan berpikir jangka panjang.</>,
          },
        ].map((tip, i) => (
          <div key={i} className="flex gap-3 mb-4 items-start">
            <span className="text-2xl flex-shrink-0 mt-0.5" aria-hidden="true">{tip.icon}</span>
            <p className="text-sm text-slate-600 leading-relaxed">{tip.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main DownloadReady ────────────────────────────────────────────────────────

export default function DownloadReady({
  tier,
  expiryText,
  cvTextId,
  cvTextEn,
  creditsRemaining,
  totalCredits,
  showDownloadGrid,
  onDownload,
  onFeedback,
  onGenerateNext,
  onUrlFetch,
  showMobileFallback,
}: Props) {
  const bilingual        = isBilingual(tier);
  const [feedbackDone,  setFeedbackDone]  = useState(false);
  const [postDlDismissed, setPostDlDismissed] = useState(
    () => !!sessionStorage.getItem('gaslamar_post_dl_dismissed'),
  );
  const [showTipsModal, setShowTipsModal] = useState(false);
  const multiRef = useRef<HTMLDivElement>(null);

  function handleFeedback(type: FeedbackType) {
    setFeedbackDone(true);
    onFeedback(type);
  }

  function handleDismissPostDl() {
    sessionStorage.setItem('gaslamar_post_dl_dismissed', '1');
    setPostDlDismissed(true);
  }

  function scrollToMulti() {
    const el = document.getElementById('multi-credit-section');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }

  function handleBottomCta() {
    const el = document.getElementById('multi-credit-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => (el.querySelector('textarea') as HTMLTextAreaElement | null)?.focus(), 600);
    } else {
      const upgrade = document.getElementById('upgrade-nudge');
      if (upgrade) upgrade.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  const showMultiCredit   = creditsRemaining > 0;
  const showUpgradeNudge  = creditsRemaining <= 0;
  const showUpsell        = showUpgradeNudge && (tier === 'coba' || tier === 'single');

  return (
    <>
      {/* Progress steps card */}
      <div
        className="rounded-[24px] p-5 mb-4"
        style={{
          background:     'rgba(255,255,255,0.88)',
          border:         '1px solid rgba(148,163,184,0.14)',
          boxShadow:      SHADOW,
          backdropFilter: 'blur(14px)',
        }}
      >
        <DownloadSteps />
      </div>

      {/* Main download card */}
      <div
        className="rounded-[24px] p-6 sm:p-8 mb-5"
        style={{
          background:     'rgba(255,255,255,0.88)',
          border:         '1px solid rgba(148,163,184,0.14)',
          boxShadow:      SHADOW,
          backdropFilter: 'blur(14px)',
        }}
      >
        {showDownloadGrid && (
          <>
            {/* Success header */}
            <div className="text-center mb-6">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl"
                style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.18)' }}
                aria-hidden="true"
              >
                🎉
              </div>
              <h2 className="text-2xl font-semibold text-slate-900 mb-1" style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>CV Kamu Sudah Siap!</h2>
              <p className="text-sm text-slate-500">Klik tombol di bawah untuk download file CV kamu</p>
            </div>

            {/* Download grid */}
            <div className={`grid gap-5 mb-5 ${bilingual && cvTextEn ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 max-w-xs mx-auto'}`}>
              {/* Indonesian */}
              <div className="rounded-[20px] p-4" style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}>
                <div className="text-base font-semibold flex items-center gap-2 mb-3 text-slate-900">
                  🇮🇩 Bahasa Indonesia
                </div>
                <div className="flex flex-col gap-2">
                  <DownloadButton lang="id" fmt="docx" label="📄 CV Indonesia — DOCX" size="Untuk diedit di Word" ariaLabel="Download CV Bahasa Indonesia format DOCX untuk diedit di Word" onClick={() => onDownload('id', 'docx')} />
                  <DownloadButton lang="id" fmt="pdf"  label="📑 CV Indonesia — PDF"  size="Siap dikirim ke HRD" ariaLabel="Download CV Bahasa Indonesia format PDF siap kirim ke HRD"  onClick={() => onDownload('id', 'pdf')} />
                </div>
              </div>

              {/* English (bilingual only) */}
              {bilingual && cvTextEn && (
                <div className="rounded-[20px] p-4" style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}>
                  <div className="text-base font-semibold flex items-center gap-2 mb-3 text-slate-900">
                    🇬🇧 English
                  </div>
                  <div className="flex flex-col gap-2">
                    <DownloadButton lang="en" fmt="docx" label="📄 CV English — DOCX" size="For editing in Word"              ariaLabel="Download CV English format DOCX for editing in Word"              onClick={() => onDownload('en', 'docx')} />
                    <DownloadButton lang="en" fmt="pdf"  label="📑 CV English — PDF"  size="For international applications"   ariaLabel="Download CV English format PDF for international applications"   onClick={() => onDownload('en', 'pdf')} />
                  </div>
                </div>
              )}
            </div>

            {/* Expiry date */}
            {expiryText && (
              <p className="text-center text-xs text-slate-500 mb-4">{expiryText}</p>
            )}

            {/* Tips box */}
            <div className="rounded-[20px] p-4 mb-5" style={{ background: 'rgba(37,99,235,0.04)', borderLeft: '3px solid rgba(37,99,235,0.4)' }}>
              <h4 className="flex items-center gap-2 font-semibold text-blue-900 mb-2">💡 Tips Submit CV</h4>
              <ul className="text-sm text-slate-600 space-y-1 list-none">
                <li>✅ Kirim PDF ke HRD via email — lebih rapi dari DOCX</li>
                <li>✅ Gunakan format nama file: "Nama-Posisi-Perusahaan.pdf"</li>
                <li>✅ Cek sekali lagi nama, no. HP, dan email sebelum kirim</li>
                <li>✅ CV Bahasa Inggris untuk loker MNC dan remote job internasional</li>
              </ul>
            </div>

            {/* Interview feedback */}
            <div className="rounded-[24px] p-5 text-center" style={{ background: 'rgba(255,255,255,0.84)', border: '1px solid rgba(148,163,184,0.18)' }}>
              <p className="font-bold text-slate-800 mb-1">📬 Dapat interview setelah pakai GasLamar?</p>
              <p className="text-xs text-slate-400 mb-3">Bantu kami tingkatkan kualitas layanan dengan 1 klik.</p>
              {feedbackDone ? (
                <p className="text-sm font-semibold text-emerald-600">Terima kasih! Feedback kamu sangat berarti. 🙏</p>
              ) : (
                <div className="flex gap-2 justify-center flex-wrap">
                  {([['ya', '#059669', '✅ Ya, dapat!'], ['proses', '#D97706', '⏳ Masih proses'], ['tidak', '#6B7280', '❌ Belum']] as const).map(([type, bg, label]) => (
                    <button
                      key={type}
                      onClick={() => handleFeedback(type)}
                      className="rounded-full px-4 py-2 font-bold text-white text-sm cursor-pointer border-none"
                      style={{ background: bg }}
                      aria-label={label}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Mobile fallback */}
      {showMobileFallback && (
        <MobileFallback cvTextId={cvTextId} cvTextEn={cvTextEn} bilingual={bilingual} />
      )}

      {/* Post-download coaching card */}
      {!postDlDismissed && showDownloadGrid && (
        <PostDownloadCard
          creditsRemaining={creditsRemaining}
          onDismiss={handleDismissPostDl}
          onScrollToMulti={scrollToMulti}
          onShowTips={() => setShowTipsModal(true)}
        />
      )}

      {/* Multi-credit section */}
      {showMultiCredit && (
        <div ref={multiRef}>
          <MultiCreditSection
            creditsRemaining={creditsRemaining}
            totalCredits={totalCredits}
            onGenerate={onGenerateNext}
            onUrlFetch={onUrlFetch}
          />
        </div>
      )}

      {/* Upgrade nudge */}
      {showUpgradeNudge && (
        <div id="upgrade-nudge" className="mb-5">
          <UpgradeNudge showUpsell={showUpsell} />
        </div>
      )}

      {/* Bottom CTA */}
      <div className="text-center pb-8">
        <p className="text-sm text-slate-500 mb-3">Melamar ke tempat lain juga?</p>
        <button
          onClick={handleBottomCta}
          className="min-h-[56px] px-8 rounded-full font-bold text-white text-base transition-all hover:-translate-y-[2px]"
          style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.30)' }}
          aria-label="Tailoring CV untuk melamar ke loker lain"
        >
          🔄 Tailoring CV untuk Loker Lain →
        </button>
      </div>

      {/* Interview tips modal */}
      {showTipsModal && <InterviewTipsModal onClose={() => setShowTipsModal(false)} />}
    </>
  );
}
