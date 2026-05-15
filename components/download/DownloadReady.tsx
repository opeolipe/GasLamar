import { useEffect } from 'react';
import type { ReactNode } from 'react';
import MobileFallback from '@/components/download/MobileFallback';
import UpgradeNudge from '@/components/download/UpgradeNudge';
import MultiCreditSection from '@/components/download/MultiCreditSection';
import ResendEmail from '@/components/download/ResendEmail';
import ScoreBars from '@/components/6d/ScoreBars';
import { isBilingual, isMultiCredit, TIER_LABELS } from '@/lib/sessionUtils';
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
  expiresAt?: number | null;
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
  label: string;
  sublabel: string;
  ariaLabel: string;
  onClick: () => void;
}

function DownloadButton({ label, sublabel, ariaLabel, onClick }: DownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-full min-h-[44px] rounded-xl flex items-center justify-between px-4 py-3 text-sm font-semibold transition-all hover:-translate-y-[1px] hover:shadow-sm active:translate-y-0"
      style={{
        background: 'white',
        border: '1px solid #DCE3F1',
        color: '#0F172A',
      }}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="text-xs flex-shrink-0 ml-3 font-medium" style={{ color: '#94A3B8' }}>{sublabel}</span>
    </button>
  );
}

export default function DownloadReady({
  tier,
  expiryText,
  expiresAt,
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
  const bilingual      = isBilingual(tier);
  const multiCredit    = isMultiCredit(tier);
  const tierLabel      = TIER_LABELS[tier] ?? tier;
  const showMultiCredit  = creditsRemaining > 0;
  const hasNextTierUpsell = tier === 'coba' || tier === 'single' || tier === '3pack';
  const showUpgradeNudge = creditsRemaining <= 0;
  const showUpsell = showUpgradeNudge && hasNextTierUpsell;
  const hasDimensions    = dimensions && Object.keys(dimensions).length > 0;

  useEffect(() => {
    if (!showUpgradeNudge) return;
    (window as any).Analytics?.track?.('upsell_shown_zero_credit', {
      tier,
      credits_remaining: creditsRemaining,
      has_next_tier_upsell: showUpsell,
    });
  }, [showUpgradeNudge, showUpsell, tier, creditsRemaining]);

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

  // ── Credit status bar ──────────────────────────────────────────────────────

  // For multi-credit tiers with remaining credits: show "3-Pack · 2 dari 3 CV tersisa · Aktif sampai 14 Juni"
  // For single/coba: show subtle access-duration note
  const expiryDateStr = expiresAt && expiresAt > Date.now()
    ? new Date(expiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const creditStatusBar = (() => {
    if (multiCredit && creditsRemaining > 0) {
      const parts = [`Paket aktif: ${tierLabel}`, `${creditsRemaining} dari ${totalCredits} CV tersisa`];
      if (expiryDateStr) parts.push(`Aktif sampai ${expiryDateStr}`);
      return { text: parts.join(' · '), variant: 'credits' as const };
    }
    if (multiCredit && creditsRemaining <= 0) {
      const parts = [`${tierLabel}`, `Semua ${totalCredits} kredit sudah terpakai`];
      if (expiryDateStr) parts.push(`Aktif sampai ${expiryDateStr}`);
      return { text: parts.join(' · '), variant: 'info' as const };
    }
    if (!multiCredit) {
      return { text: 'CV bisa diakses kembali selama 7 hari', variant: 'info' as const };
    }
    return null;
  })();

  // ── Scroll helpers ─────────────────────────────────────────────────────────

  function jumpTo(sectionId: string) {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (sectionId === 'multi-credit-section') {
      setTimeout(() => (el.querySelector('textarea') as HTMLTextAreaElement | null)?.focus(), 500);
    }
  }

  function handleTailorCta() {
    if (showMultiCredit) {
      jumpTo('multi-credit-section');
    } else {
      window.location.href = tier
        ? `upload.html?new_package=1&tier=${encodeURIComponent(tier)}`
        : 'upload.html?new_package=1';
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
        .gl-next-card {
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }
        .gl-next-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(15,23,42,0.10);
          border-color: #93C5FD !important;
        }
        .gl-next-card:active {
          transform: translateY(0);
        }
        @media (prefers-reduced-motion: reduce) {
          .gl-fade-up { animation: none; opacity: 1; transform: none; }
          .gl-next-card { transition: none; }
          .gl-next-card:hover { transform: none; }
        }
      `}</style>
      <pre data-testid="cv-content" className="sr-only" aria-hidden="true">{cvTextId}</pre>

      <div style={{ textAlign: 'center', marginBottom: '0.9rem', fontSize: '0.8rem', color: '#94A3B8', fontWeight: 500 }}>
        CV dianalisis dan dioptimasi untuk posisi yang kamu incar
      </div>

      {showDownloadGrid && (
        <section className="gl-fade-up" style={{ ...CARD_STYLE, padding: '2.15rem 2rem 1.8rem', marginBottom: '3.5rem' }}>
          <p className="text-xs uppercase tracking-[0.12em] text-emerald-600 font-bold mb-2">Sukses</p>
          <h1 style={{ ...SECTION_HEADING, fontSize: '1.5rem', marginBottom: '0.35rem' }}>CV kamu sudah siap dikirim</h1>
          <p className="text-sm text-slate-500 mb-4">Pilih format yang kamu butuhkan sekarang.</p>

          {/* Credit / session status bar */}
          {creditStatusBar && (
            <div
              className="inline-flex items-center gap-1.5 mb-5 text-xs font-semibold rounded-full px-3 py-1.5"
              style={
                creditStatusBar.variant === 'credits'
                  ? { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }
                  : { background: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' }
              }
            >
              <span aria-hidden="true">{creditStatusBar.variant === 'credits' ? '🎯' : '📅'}</span>
              {creditStatusBar.text}
            </div>
          )}

          {isTrusted && (
            <span data-testid="trust-badge" style={{ display: 'inline-flex', maxWidth: '100%', wordBreak: 'break-word', alignItems: 'center', gap: 6, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '4px 12px', fontSize: '0.83rem', color: '#15803D', fontWeight: 600, marginBottom: '1.25rem' }}>
              ✅ CV divalidasi — tidak ada klaim baru yang ditambahkan
            </span>
          )}

          <div className={`grid gap-6 ${bilingual && cvTextEn ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#64748B' }}>🇮🇩 Bahasa Indonesia</p>
              <div className="flex flex-col gap-2">
                <DownloadButton
                  label="📄 DOCX"
                  sublabel="Editable di Word"
                  ariaLabel="Download CV Bahasa Indonesia format DOCX"
                  onClick={() => onDownload('id', 'docx')}
                />
                <DownloadButton
                  label="📑 PDF"
                  sublabel="Siap kirim"
                  ariaLabel="Download CV Bahasa Indonesia format PDF"
                  onClick={() => onDownload('id', 'pdf')}
                />
              </div>
            </div>

            {bilingual && cvTextEn && (
              <div lang="en">
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#64748B' }}>🇬🇧 English</p>
                <div className="flex flex-col gap-2">
                  <DownloadButton
                    label="📄 DOCX"
                    sublabel="For editing"
                    ariaLabel="Download CV English format DOCX"
                    onClick={() => onDownload('en', 'docx')}
                  />
                  <DownloadButton
                    label="📑 PDF"
                    sublabel="For applying"
                    ariaLabel="Download CV English format PDF"
                    onClick={() => onDownload('en', 'pdf')}
                  />
                </div>
              </div>
            )}
          </div>

          {deliveryEmail && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.14)' }}>
              <p className="text-sm text-slate-500 mb-0.5">Link download dikirim ke:</p>
              <p className="text-sm font-semibold text-slate-700 mb-0 break-all">{deliveryEmail}</p>
              <ResendEmail sessionSecret={sessionSecret} compact />
            </div>
          )}

          {expiryText && (
            <div style={{ marginTop: '1rem' }}>
              {expiryText.split('\n').map((line, i) => (
                <p key={i} className="text-sm text-slate-500 mb-1 last:mb-0">{line}</p>
              ))}
            </div>
          )}
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

      {showMultiCredit && (
        <section className="gl-fade-up gl-fade-up-d3" style={CARD_STYLE}>
          <h2 style={SECTION_HEADING}>Langkah berikutnya</h2>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => {
                (window as any).Analytics?.track?.('tailor_next_click', {
                  tier,
                  credits_remaining: creditsRemaining,
                  total_credits: totalCredits,
                });
                handleTailorCta();
              }}
              className="gl-next-card text-left rounded-[14px] p-4"
              style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}
            >
              <div className="font-semibold text-slate-900 text-sm">Tailor CV untuk posisi lain</div>
              <p className="text-xs text-slate-600 mt-1 mb-0">
                Gunakan sisa {creditsRemaining} kredit untuk posisi berbeda.
              </p>
            </button>
          </div>
        </section>
      )}

      {showMultiCredit && (
        <div id="next-applications" style={{ marginBottom: '1.5rem' }}>
          <MultiCreditSection creditsRemaining={creditsRemaining} totalCredits={totalCredits} onGenerate={onGenerateNext} onUrlFetch={onUrlFetch} />
        </div>
      )}

      {showUpgradeNudge && (
        <div id="upgrade-nudge" className="mb-5">
          <UpgradeNudge showUpsell={showUpsell} tier={tier} expiresAt={expiresAt} />
        </div>
      )}
    </>
  );
}
