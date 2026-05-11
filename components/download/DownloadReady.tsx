import { useState, useRef } from 'react';
import MobileFallback       from '@/components/download/MobileFallback';
import UpgradeNudge         from '@/components/download/UpgradeNudge';
import MultiCreditSection   from '@/components/download/MultiCreditSection';
import ScoreBars            from '@/components/6d/ScoreBars';
import ScoreDisplay         from '@/components/result/ScoreDisplay';
import { isBilingual }      from '@/lib/sessionUtils';
import { DIM_LABELS }       from '@/lib/resultUtils';

// ── Design tokens — identical to hasil page ───────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background:     'rgba(255,255,255,0.92)',
  borderRadius:   24,
  boxShadow:      '0 18px 44px rgba(15,23,42,0.07), 0 1px 2px rgba(15,23,42,0.04)',
  padding:        '2rem',
  border:         '1px solid rgba(148,163,184,0.14)',
  backdropFilter: 'blur(14px)',
  marginBottom:   '1.75rem',
};

const SECTION_HEADING: React.CSSProperties = {
  fontSize:      '1.1rem',
  fontWeight:    700,
  color:         '#0F172A',
  margin:        '0 0 1.25rem',
  lineHeight:    1.3,
  letterSpacing: '-0.01em',
};

// ── Types ────────────────────────────────────────────────────────────────────

type FeedbackType = 'ya' | 'proses' | 'tidak';

interface Props {
  tier:               string;
  filename:           string;
  expiryText:         string;
  cvTextId:           string;
  cvTextEn:           string | null;
  creditsRemaining:   number;
  totalCredits:       number;
  showDownloadGrid:   boolean;
  onDownload:         (lang: 'id' | 'en', format: 'docx' | 'pdf') => void;
  onFeedback:         (type: FeedbackType) => void;
  onGenerateNext:     (jobDesc: string) => Promise<void> | void;
  onUrlFetch:         (url: string) => Promise<string>;
  showMobileFallback: boolean;
  dimensions?:        Record<string, number>;
  primaryIssue?:      string | null;
  isTrusted?:         boolean;
}

// ── DownloadButton ────────────────────────────────────────────────────────────

interface DownloadButtonProps {
  lang:      'id' | 'en';
  fmt:       'docx' | 'pdf';
  label:     string;
  size:      string;
  ariaLabel: string;
  onClick:   () => void;
}

function DownloadButton({ fmt, label, size, ariaLabel, onClick }: DownloadButtonProps) {
  const primary = fmt === 'docx';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-full min-h-[44px] rounded-full flex items-center justify-between px-4 py-2 text-sm font-semibold transition-all hover:translate-x-1"
      style={primary
        ? { background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', border: 'none', color: 'white', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }
        : { background: 'white', border: '1px solid rgba(37,99,235,0.2)', color: '#1E3A8A' }
      }
    >
      <span>{label}</span>
      <span className={`text-sm ${primary ? 'text-blue-200' : 'text-slate-400'}`}>{size}</span>
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
      <div className="rounded-[20px] p-5 mb-7 relative" style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE' }}>
        <button
          onClick={onDismiss}
          aria-label="Tutup notifikasi"
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-base leading-none p-1"
        >
          ✕
        </button>
        <div className="font-bold text-slate-900 mb-1 pr-6">🎯 Lamaran pertama sudah siap!</div>
        <p className="text-sm text-slate-600 mb-4">
          Kamu masih punya <strong>{creditsRemaining} kredit</strong> tersisa. Tailor CV untuk loker lain — masukkan job description baru di bawah.
        </p>
        <button
          onClick={onScrollToMulti}
          className="inline-flex items-center min-h-[40px] px-4 rounded-[14px] font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
          style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}
        >
          ✍️ Siapkan CV Lain
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] p-5 mb-7 relative" style={{ background: '#F0FDF4', border: '1.5px solid #86EFAC' }}>
      <button
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-base leading-none p-1"
      >
        ✕
      </button>
      <div className="font-bold text-slate-900 mb-1 pr-6">🚀 CV kamu sudah siap dikirim!</div>
      <p className="text-sm text-slate-600 mb-4">
        Kalau kamu mau lanjut, ini langkah opsional untuk aplikasi berikutnya.
      </p>
      <div className="flex gap-2 flex-wrap">
        <a
          href="/?tier=3pack"
          className="inline-flex items-center min-h-[40px] px-4 rounded-[14px] font-semibold text-slate-700 text-sm transition-colors"
          style={{ background: 'white', border: '1.5px solid #E2E8F0' }}
        >
          📦 Beli Paket Hemat
        </a>
        <button
          onClick={onShowTips}
          className="inline-flex items-center min-h-[40px] px-4 rounded-[14px] font-bold text-white text-sm transition-all hover:-translate-y-[1px]"
          style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}
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
  dimensions,
  primaryIssue,
  isTrusted = false,
}: Props) {
  const bilingual = isBilingual(tier);

  // Read analysis data persisted by useResultData before gaslamar_scoring was cleared
  const [scoreBefore] = useState<number | null>(() => {
    const n = parseInt(sessionStorage.getItem('gaslamar_skor') || '');
    return isNaN(n) ? null : n;
  });
  const [scoreAfter] = useState<number | null>(() => {
    const n = parseInt(sessionStorage.getItem('gaslamar_skor_sesudah') || '');
    return isNaN(n) ? null : n;
  });
  const [gaps] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem('gaslamar_gap');
      return raw ? JSON.parse(raw) as string[] : [];
    } catch { return []; }
  });

  const [feedbackDone,     setFeedbackDone]     = useState(false);
  const [postDlDismissed,  setPostDlDismissed]  = useState(
    () => !!sessionStorage.getItem('gaslamar_post_dl_dismissed'),
  );
  const [showTipsModal,    setShowTipsModal]    = useState(false);
  const [showAllGaps,      setShowAllGaps]      = useState(false);
  const multiRef = useRef<HTMLDivElement>(null);

  // Two weakest dimensions — mirrors hasil page "Yang paling bikin HR ragu"
  const priorityWeaknesses = dimensions
    ? Object.entries(DIM_LABELS)
        .map(([key, meta]) => ({
          key,
          label: meta.label,
          hint:  meta.hint,
          score: Math.min(10, Math.max(0, Math.round(dimensions[key] ?? 0))),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 2)
    : [];

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

  const showMultiCredit  = creditsRemaining > 0;
  const showUpgradeNudge = creditsRemaining <= 0;
  const showUpsell       = showUpgradeNudge && (tier === 'coba' || tier === 'single');
  const hasDimensions    = dimensions && Object.keys(dimensions).length > 0;

  return (
    <>
      {/* Hidden CV text for E2E assertions */}
      <pre data-testid="cv-content" className="sr-only" aria-hidden="true">{cvTextId}</pre>

      {/* Breadcrumb — matches hasil page style */}
      <div style={{ textAlign: 'center', marginBottom: '0.75rem', fontSize: '0.78rem', color: '#94A3B8', fontWeight: 500 }}>
        CV dianalisis dan dioptimasi untuk posisi yang kamu incar
      </div>

      {/* ── SECTION 1: Score Hero — mirrors hasil page BLOCK 1 ── */}
      {showDownloadGrid && scoreBefore !== null && (
        <div style={{ ...CARD_STYLE, textAlign: 'center', padding: '2.5rem 2rem 2rem' }}>
          <ScoreDisplay score={scoreBefore} />
          <div style={{ textAlign: 'center', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(148,163,184,0.14)' }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#111827', marginBottom: '0.35rem' }}>
              {scoreBefore >= 75
                ? 'CV kamu sudah kompetitif — dioptimasi lebih jauh'
                : scoreBefore >= 60
                ? 'Gap kecil sudah diperbaiki — CV siap bersaing'
                : scoreBefore >= 50
                ? 'Gap utama sudah dioptimasi di CV ini'
                : 'Semua gap utama sudah diperbaiki di CV ini'}
            </div>
            <p style={{ fontSize: '0.88rem', color: '#64748B', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
              Keyword, struktur, dan pencapaian di CV kamu sudah disesuaikan dengan kebutuhan posisi yang kamu lamar.
            </p>
            {scoreAfter !== null && (
              <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 0.1rem', fontWeight: 500 }}>
                  Estimasi skor dengan CV yang sudah di-tailor
                </p>
                <p style={{ fontSize: '3.5rem', fontWeight: 800, color: '#15803D', lineHeight: 1, margin: '0 0 0.2rem' }}>
                  {scoreAfter}%
                </p>
                <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0 }}>
                  naik dari {scoreBefore}% sebelum optimasi
                </p>
              </div>
            )}
            {isTrusted && (
              <div style={{ marginTop: '1rem' }}>
                <span
                  data-testid="trust-badge"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '4px 12px', fontSize: '0.875rem', color: '#15803D', fontWeight: 600 }}
                >
                  ✅ CV divalidasi — tidak ada klaim baru yang ditambahkan
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION 2: 6D Analysis — mirrors hasil page "Kenapa HR masih ragu" ── */}
      {hasDimensions && (
        <div style={CARD_STYLE}>
          <h2 style={SECTION_HEADING}>Ini yang paling dilihat HR</h2>

          {/* Two weakest dimensions — same callout pattern as hasil page */}
          {priorityWeaknesses.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.75rem' }}>
                Yang paling perlu diperhatikan
              </p>
              {priorityWeaknesses.map(dim => (
                <div
                  key={dim.key}
                  style={{
                    padding:      '0.85rem 1rem',
                    background:   dim.score < 4 ? '#FFF7F7' : '#FFFBEB',
                    border:       `1px solid ${dim.score < 4 ? '#FECACA' : '#FDE68A'}`,
                    borderRadius: 12,
                    marginBottom: '0.65rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#111827' }}>
                      {dim.score < 4 ? '❌' : '⚠️'} {dim.label}
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: dim.score < 4 ? '#DC2626' : '#92400E', flexShrink: 0, marginLeft: 8 }}>
                      {dim.score}/10
                    </span>
                  </div>
                  <div style={{ background: dim.score < 4 ? '#FEE2E2' : '#FEF3C7', borderRadius: 3, height: 4, marginBottom: 8 }}>
                    <div style={{
                      width:      `${dim.score * 10}%`,
                      background: dim.score < 4 ? '#F87171' : '#F59E0B',
                      borderRadius: 3,
                      height:     4,
                      transition: 'width 0.7s cubic-bezier(0.22,1,0.36,1)',
                    }} />
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0, lineHeight: 1.55 }}>
                    {dim.hint}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Full 6D breakdown */}
          <ScoreBars dimensions={dimensions!} mode="full" primaryKey={primaryIssue ?? undefined} />

          {/* Gap list — what was addressed in the tailored CV */}
          {gaps.length > 0 && (
            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.14)' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.75rem' }}>
                Gap yang sudah dioptimasi di CV ini
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {gaps.slice(0, showAllGaps ? gaps.length : 3).map((g, i) => (
                  <li key={i} style={{ fontSize: '0.875rem', color: '#374151', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <span style={{ color: '#22C55E', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>✓</span>
                    <span style={{ lineHeight: 1.5 }}>{g}</span>
                  </li>
                ))}
              </ul>
              {gaps.length > 3 && (
                <button
                  onClick={() => setShowAllGaps(v => !v)}
                  style={{ background: 'none', border: 'none', padding: '0.35rem 0', fontSize: '0.82rem', color: '#2563EB', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: '0.4rem', display: 'block' }}
                >
                  {showAllGaps ? 'Sembunyikan ↑' : `Lihat ${gaps.length - 3} gap lainnya →`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SECTION 3: Download card ── */}
      {showDownloadGrid && (
        <div style={CARD_STYLE}>
          <h2 style={SECTION_HEADING}>Download CV kamu</h2>

          {/* Trust badge — shown here when the score hero section is hidden */}
          {isTrusted && scoreBefore === null && (
            <div style={{ marginBottom: '1.25rem' }}>
              <span
                data-testid="trust-badge"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '4px 12px', fontSize: '0.875rem', color: '#15803D', fontWeight: 600 }}
              >
                ✅ CV divalidasi — tidak ada klaim baru yang ditambahkan
              </span>
            </div>
          )}

          {/* Download grid */}
          <div className={`grid gap-5 mb-5 ${bilingual && cvTextEn ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 max-w-xs mx-auto'}`}>
            {/* Indonesian */}
            <div className="rounded-[20px] p-4" style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}>
              <div className="text-base font-semibold flex items-center gap-2 mb-3 text-slate-900">
                🇮🇩 Bahasa Indonesia
              </div>
              <div className="flex flex-col gap-2">
                <DownloadButton lang="id" fmt="docx" label="📄 CV Indonesia — DOCX" size="Untuk diedit di Word"  ariaLabel="Download CV Bahasa Indonesia format DOCX untuk diedit di Word" onClick={() => onDownload('id', 'docx')} />
                <DownloadButton lang="id" fmt="pdf"  label="📑 CV Indonesia — PDF"  size="Siap dikirim ke HRD" ariaLabel="Download CV Bahasa Indonesia format PDF siap kirim ke HRD"   onClick={() => onDownload('id', 'pdf')} />
              </div>
            </div>

            {/* English — bilingual tiers only */}
            {bilingual && cvTextEn && (
              <div className="rounded-[20px] p-4" style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}>
                <div className="text-base font-semibold flex items-center gap-2 mb-3 text-slate-900">
                  🇬🇧 English
                </div>
                <div className="flex flex-col gap-2">
                  <DownloadButton lang="en" fmt="docx" label="📄 CV English — DOCX" size="For editing in Word"            ariaLabel="Download CV English format DOCX for editing in Word"           onClick={() => onDownload('en', 'docx')} />
                  <DownloadButton lang="en" fmt="pdf"  label="📑 CV English — PDF"  size="For international applications" ariaLabel="Download CV English format PDF for international applications"  onClick={() => onDownload('en', 'pdf')} />
                </div>
              </div>
            )}
          </div>

          {/* Expiry date */}
          {expiryText && expiryText.split('\n').map((line, i) => (
            <p key={i} className="text-center text-sm text-slate-500 mb-1 last:mb-5">{line}</p>
          ))}

          {/* Tips box */}
          <div className="rounded-[20px] p-4" style={{ background: 'rgba(37,99,235,0.04)', borderLeft: '3px solid rgba(37,99,235,0.4)' }}>
            <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em', margin: '0 0 0.5rem' }}>💡 Tips Submit CV</h4>
            <ul className="text-sm text-slate-600 space-y-1 list-none m-0 p-0">
              <li>✅ Kirim PDF ke HRD via email — lebih rapi dari DOCX</li>
              <li>✅ Gunakan format nama file: "Nama-Posisi-Perusahaan.pdf"</li>
              <li>✅ Cek sekali lagi nama, no. HP, dan email sebelum kirim</li>
              {bilingual && <li>✅ CV Bahasa Inggris untuk loker MNC dan remote job internasional</li>}
            </ul>
          </div>
        </div>
      )}

      {/* Mobile fallback */}
      {showMobileFallback && (
        <MobileFallback cvTextId={cvTextId} cvTextEn={cvTextEn} bilingual={bilingual} />
      )}

      {/* ── SECTION 4: Feedback — mirrors hasil's survey style ── */}
      {showDownloadGrid && (
        <div style={CARD_STYLE}>
          <h2 style={SECTION_HEADING}>Dapat panggilan interview?</h2>
          <p className="text-sm text-slate-500 mb-4" style={{ marginTop: '-0.5rem' }}>
            Bantu kami tingkatkan kualitas layanan dengan satu klik — hanya butuh 2 detik.
          </p>
          {feedbackDone ? (
            <p className="text-sm font-semibold text-emerald-600">Terima kasih! Feedback kamu sangat berarti. 🙏</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {([['ya', '#059669', '✅ Ya, dapat!'], ['proses', '#D97706', '⏳ Masih proses'], ['tidak', '#6B7280', '❌ Belum']] as const).map(([type, bg, label]) => (
                <button
                  key={type}
                  onClick={() => handleFeedback(type)}
                  className="rounded-full px-4 py-2 font-bold text-white text-sm cursor-pointer border-none min-h-[44px]"
                  style={{ background: bg }}
                  aria-label={label}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
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
