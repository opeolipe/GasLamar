import type { ReactNode } from 'react';
import MobileFallback from '@/components/download/MobileFallback';
import UpgradeNudge from '@/components/download/UpgradeNudge';
import MultiCreditSection from '@/components/download/MultiCreditSection';
import ResendEmail from '@/components/download/ResendEmail';
import ScoreBars from '@/components/6d/ScoreBars';
import { isBilingual } from '@/lib/sessionUtils';
import { DIM_LABELS } from '@/lib/resultUtils';

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.92)',
  borderRadius: 24,
  boxShadow: '0 18px 44px rgba(15,23,42,0.07), 0 1px 2px rgba(15,23,42,0.04)',
  padding: '2rem',
  border: '1px solid rgba(148,163,184,0.14)',
  backdropFilter: 'blur(14px)',
  marginBottom: '1.5rem',
};

const SOFT_CARD_STYLE: React.CSSProperties = {
  background: 'rgba(248,250,252,0.9)',
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: 18,
};

const OUTLINE_CARD_STYLE: React.CSSProperties = {
  background: 'white',
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: 16,
};

const SECTION_HEADING: React.CSSProperties = {
  fontSize: '1.1rem',
  fontWeight: 700,
  color: '#0F172A',
  margin: '0 0 1rem',
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
};

interface Props {
  tier: string;
  expiryText: string;
  cvTextId: string;
  cvTextEn: string | null;
  creditsRemaining: number;
  totalCredits: number;
  showDownloadGrid: boolean;
  onDownload: (lang: 'id' | 'en', format: 'docx' | 'pdf') => void;
  onGenerateNext: (jobDesc: string) => Promise<void> | void;
  onUrlFetch: (url: string) => Promise<string>;
  showMobileFallback: boolean;
  dimensions?: Record<string, number>;
  primaryIssue?: string | null;
  isTrusted?: boolean;
  deliveryEmail?: string | null;
  sessionSecret: string | null;
  interviewKitNode?: ReactNode;
}

interface DownloadButtonProps {
  fmt: 'docx' | 'pdf';
  label: string;
  size: string;
  ariaLabel: string;
  onClick: () => void;
}

function DownloadButton({ fmt, label, size, ariaLabel, onClick }: DownloadButtonProps) {
  const primary = fmt === 'docx';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-full min-h-[44px] rounded-full flex items-center justify-between px-4 py-2 text-sm font-semibold transition-all hover:translate-x-1"
      style={
        primary
          ? { background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)', border: 'none', color: 'white', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }
          : { background: 'white', border: '1px solid rgba(37,99,235,0.2)', color: '#1E3A8A' }
      }
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className={`text-sm flex-shrink-0 ml-2 ${primary ? 'text-blue-200' : 'text-slate-400'}`}>{size}</span>
    </button>
  );
}

export default function DownloadReady({
  tier,
  expiryText,
  cvTextId,
  cvTextEn,
  creditsRemaining,
  totalCredits,
  showDownloadGrid,
  onDownload,
  onGenerateNext,
  onUrlFetch,
  showMobileFallback,
  dimensions,
  primaryIssue,
  isTrusted = false,
  deliveryEmail,
  sessionSecret,
  interviewKitNode,
}: Props) {
  const bilingual = isBilingual(tier);
  const showMultiCredit = creditsRemaining > 0;
  const showUpgradeNudge = creditsRemaining <= 0;
  const showUpsell = showUpgradeNudge && (tier === 'coba' || tier === 'single');
  const hasDimensions = dimensions && Object.keys(dimensions).length > 0;

  const priorityWeaknesses = dimensions
    ? Object.entries(DIM_LABELS)
        .map(([key, meta]) => ({
          key,
          label: meta.label,
          hint: meta.hint,
          score: Math.min(10, Math.max(0, Math.round(dimensions[key] ?? 0))),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 2)
    : [];

  function jumpTo(sectionId: string) {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (sectionId === 'multi-credit-section') {
      setTimeout(() => (el.querySelector('textarea') as HTMLTextAreaElement | null)?.focus(), 500);
    }
  }

  return (
    <>
      <style>{`
        .gl-fade-up {
          animation: glFadeUp 420ms cubic-bezier(0.22,1,0.36,1) both;
        }
        .gl-fade-up-d2 { animation-delay: 60ms; }
        .gl-fade-up-d3 { animation-delay: 120ms; }
        .gl-analysis-details[open] .gl-analysis-content {
          animation: glDetailsIn 260ms ease-out both;
        }
        @keyframes glFadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes glDetailsIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <pre data-testid="cv-content" className="sr-only" aria-hidden="true">{cvTextId}</pre>

      <div style={{ textAlign: 'center', marginBottom: '0.9rem', fontSize: '0.8rem', color: '#94A3B8', fontWeight: 500 }}>
        CV dianalisis dan dioptimasi untuk posisi yang kamu incar
      </div>

      {showDownloadGrid && (
        <section className="gl-fade-up" style={{ ...CARD_STYLE, padding: '2.15rem 2rem 1.8rem' }}>
          <p className="text-xs uppercase tracking-[0.12em] text-emerald-600 font-bold mb-2">Sukses</p>
          <h1 style={{ ...SECTION_HEADING, fontSize: '1.5rem', marginBottom: '0.45rem' }}>CV kamu siap dipakai apply</h1>
          <p className="text-sm text-slate-600 mb-4">Download file final kamu dulu, lalu lanjutkan langkah berikutnya dengan tenang.</p>

          <div className="p-4 mb-4 gl-fade-up gl-fade-up-d2" style={SOFT_CARD_STYLE}>
            <h2 style={{ ...SECTION_HEADING, fontSize: '1rem', marginBottom: '0.9rem' }}>Download Center</h2>
            {isTrusted && (
              <span data-testid="trust-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '4px 12px', fontSize: '0.83rem', color: '#15803D', fontWeight: 600, marginBottom: '0.9rem' }}>
                ✅ CV divalidasi — tidak ada klaim baru yang ditambahkan
              </span>
            )}

            <div className={`grid gap-4 mb-3 ${bilingual && cvTextEn ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 max-w-xs mx-auto'}`}>
              <div className="p-4" style={OUTLINE_CARD_STYLE}>
                <div className="text-sm font-semibold mb-2 text-slate-900">🇮🇩 Bahasa Indonesia</div>
                <div className="flex flex-col gap-2">
                  <DownloadButton fmt="docx" label="📄 CV Indonesia — DOCX" size="Untuk diedit" ariaLabel="Download CV Bahasa Indonesia format DOCX" onClick={() => onDownload('id', 'docx')} />
                  <DownloadButton fmt="pdf" label="📑 CV Indonesia — PDF" size="Siap kirim" ariaLabel="Download CV Bahasa Indonesia format PDF" onClick={() => onDownload('id', 'pdf')} />
                </div>
              </div>

              {bilingual && cvTextEn && (
                <div lang="en" className="p-4" style={OUTLINE_CARD_STYLE}>
                  <div className="text-sm font-semibold mb-2 text-slate-900">🇬🇧 English</div>
                  <div className="flex flex-col gap-2">
                    <DownloadButton fmt="docx" label="📄 CV English — DOCX" size="For editing" ariaLabel="Download CV English format DOCX" onClick={() => onDownload('en', 'docx')} />
                    <DownloadButton fmt="pdf" label="📑 CV English — PDF" size="For applying" ariaLabel="Download CV English format PDF" onClick={() => onDownload('en', 'pdf')} />
                  </div>
                </div>
              )}
            </div>

            {deliveryEmail && (
              <div style={{ borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: '0.9rem' }}>
                <p className="text-sm text-slate-500 mb-1">Link download juga dikirim ke:</p>
                <p className="text-sm font-semibold text-slate-700 mb-2 break-all">{deliveryEmail}</p>
                <ResendEmail sessionSecret={sessionSecret} compact />
              </div>
            )}
          </div>

          {expiryText && expiryText.split('\n').map((line, i) => (
            <p key={i} className="text-center text-sm text-slate-500 mb-1 last:mb-0">{line}</p>
          ))}
        </section>
      )}

      {showMobileFallback && <MobileFallback cvTextId={cvTextId} cvTextEn={cvTextEn} bilingual={bilingual} />}

      {hasDimensions && (
        <section className="gl-fade-up gl-fade-up-d2" style={CARD_STYLE}>
          <h2 style={SECTION_HEADING}>Insight Recruiter (Ringkas)</h2>
          <p className="text-sm text-slate-600 mb-4">Yang paling perlu diperbaiki untuk lamaran berikutnya:</p>

          <div className="space-y-2 mb-4">
            {priorityWeaknesses.map(dim => (
              <div key={dim.key} className="rounded-[12px] px-3 py-2" style={{ background: '#FFF7ED', border: '1px solid #FED7AA', boxShadow: '0 1px 0 rgba(245,158,11,0.07)' }}>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-slate-800">{dim.label}</span>
                  <span className="text-xs font-bold text-amber-700">{dim.score}/10</span>
                </div>
                <p className="text-xs text-slate-600 mt-1 mb-0">{dim.hint}</p>
              </div>
            ))}
          </div>

          <details className="gl-analysis-details">
            <summary className="cursor-pointer text-sm font-semibold text-blue-700 transition-colors hover:text-blue-800">Lihat analisis lengkap</summary>
            <div className="mt-4 gl-analysis-content" id="analysis-full">
              <ScoreBars dimensions={dimensions!} mode="full" primaryKey={primaryIssue ?? undefined} />
            </div>
          </details>
        </section>
      )}

      {showDownloadGrid && interviewKitNode && (
        <section id="interview-kit-section" className="gl-fade-up gl-fade-up-d3" style={{ marginBottom: '1.5rem' }}>
          {interviewKitNode}
        </section>
      )}

      <section className="gl-fade-up gl-fade-up-d3" style={CARD_STYLE}>
        <h2 style={SECTION_HEADING}>Langkah berikutnya</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => jumpTo('multi-credit-section')} className="text-left rounded-[14px] p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-lg" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', boxShadow: '0 10px 22px rgba(59,130,246,0.13)' }}>
            <div className="font-semibold text-slate-900 text-sm">Tailor CV untuk loker lain</div>
            <p className="text-xs text-slate-600 mt-1 mb-0">Untuk apply ke posisi berbeda</p>
          </button>

          <button type="button" onClick={() => jumpTo('interview-kit-section')} className="text-left rounded-[14px] p-4 transition-all duration-200 hover:bg-slate-50 hover:-translate-y-[1px]" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div className="font-semibold text-slate-900 text-sm">Interview Kit</div>
            <p className="text-xs text-slate-600 mt-1 mb-0">Email, WhatsApp, dan jawaban interview</p>
          </button>

          <a href="upload.html" className="no-underline rounded-[14px] p-4 block transition-all duration-200 hover:bg-slate-50 hover:-translate-y-[1px]" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div className="font-semibold text-slate-900 text-sm">Upgrade ke 3-Pack</div>
            <p className="text-xs text-slate-600 mt-1 mb-0">Lebih hemat untuk multiple posisi</p>
          </a>
        </div>
      </section>

      {showMultiCredit && (
        <div id="next-applications" style={{ marginBottom: '1.5rem' }}>
          <MultiCreditSection creditsRemaining={creditsRemaining} totalCredits={totalCredits} onGenerate={onGenerateNext} onUrlFetch={onUrlFetch} />
        </div>
      )}

      {showUpgradeNudge && (
        <div id="upgrade-nudge" className="mb-5">
          <UpgradeNudge showUpsell={showUpsell} />
        </div>
      )}
    </>
  );
}
