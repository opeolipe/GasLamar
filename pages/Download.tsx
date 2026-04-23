import { useState, useEffect, useRef, useCallback } from 'react';
import { useDownloadSession }  from '@/hooks/useDownloadSession';
import { useGenerateCV }       from '@/hooks/useGenerateCV';
import {
  isBilingual,
  isMultiCredit,
  buildCVFilename,
  generateDOCXBlob,
  generatePDFBlob,
  triggerDownload,
  getCountdownInfo,
  formatExpiryDate,
  WORKER_URL,
  buildSecretHeaders,
} from '@/lib/downloadUtils';
import { buildResultData } from '@/lib/resultUtils';
import type { ResultData } from '@/types/result';
import SessionError   from '@/components/download/SessionError';
import WaitingPayment from '@/components/download/WaitingPayment';
import GeneratingCV   from '@/components/download/GeneratingCV';
import DownloadReady  from '@/components/download/DownloadReady';
import ResendEmail    from '@/components/download/ResendEmail';

// ── Types ─────────────────────────────────────────────────────────────────────

type PageView     = 'waiting' | 'generating' | 'ready' | 'credits-dashboard' | 'error';
type FeedbackType = 'ya' | 'proses' | 'tidak';

// ── Component ─────────────────────────────────────────────────────────────────

export default function Download() {
  const session  = useDownloadSession();
  const generate = useGenerateCV();

  const [view,           setView]           = useState<PageView>('waiting');
  const [countdownText,  setCountdownText]  = useState<string | null>(null);
  const [countdownWarn,  setCountdownWarn]  = useState(false);
  const [expiryText,     setExpiryText]     = useState('');
  const [showMobileFb,   setShowMobileFb]   = useState(false);

  // Read delivery state from localStorage once on mount
  const [delivery] = useState<{ sessionId: string; email: string; sentAt: number } | null>(() => {
    try {
      const raw = localStorage.getItem('gaslamar_delivery');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const viewRef           = useRef<PageView>('waiting');
  viewRef.current         = view;

  // ── Redirect guard ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!delivery && !localStorage.getItem('gaslamar_session')) {
      window.location.href = '/';
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session → view transitions ────────────────────────────────────────────

  useEffect(() => {
    if (session.phase === 'confirmed' && viewRef.current === 'waiting') {
      const { sessionId, sessionSecret } = session;
      if (!sessionId) return;
      setView('generating');
      generate.startGeneration({ sessionId, sessionSecret });
    }
  }, [session.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session.phase === 'returning' && viewRef.current === 'waiting') {
      setView('credits-dashboard');
      const data = session.sessionData;
      if (data?.expiresAt) {
        setExpiryText(formatExpiryDate(data.expiresAt));
        startCountdown(data.expiresAt, data.totalCredits);
      }
      if (data) session.startHeartbeat(data.totalCredits);
    }
  }, [session.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session.phase === 'error' && viewRef.current === 'waiting') {
      setView('error');
    }
  }, [session.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate → view transitions ───────────────────────────────────────────

  useEffect(() => {
    if (generate.status === 'done' && generate.content) {
      const { expiresAt, totalCredits } = session.sessionData ?? { expiresAt: null, totalCredits: 1 };
      if (expiresAt) {
        setExpiryText(formatExpiryDate(expiresAt));
        startCountdown(expiresAt, totalCredits);
      }
      session.startHeartbeat(generate.content.totalCredits);
      setView('ready');

      ;(window as any).Analytics?.track?.('download_page_ready', {
        tier:              generate.content.tier,
        credits_remaining: generate.content.creditsRemaining,
        is_trusted:        generate.content.isTrusted,
        resultId:          sessionStorage.getItem('gaslamar_result_id') || undefined,
      });
    }
  }, [generate.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (generate.status === 'error') {
      setView('error');
    }
  }, [generate.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Countdown helpers ─────────────────────────────────────────────────────

  function startCountdown(expiresAtMs: number, totalCredits: number) {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    updateCountdown(expiresAtMs, totalCredits);
    countdownTimerRef.current = setInterval(
      () => updateCountdown(expiresAtMs, totalCredits),
      60_000,
    );
  }

  function updateCountdown(expiresAtMs: number, totalCredits: number) {
    const info = getCountdownInfo(expiresAtMs, totalCredits);
    if (info.variant === 'expired') {
      setCountdownText(null);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    } else {
      setCountdownText(info.text);
      setCountdownWarn(info.variant === 'warning');
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      session.stopHeartbeat();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleDownload = useCallback(async (lang: 'id' | 'en', format: 'docx' | 'pdf') => {
    const content = generate.content;
    if (!content) return;
    // Use the DOCX-specific text (with guidance notes) for DOCX downloads
    const cvText = format === 'docx'
      ? (lang === 'en' ? (content.cvEnDocx ?? content.cvEn ?? '') : (content.cvIdDocx ?? content.cvId))
      : (lang === 'en' ? (content.cvEn ?? '')                     : content.cvId);
    if (!cvText) return;

    const filename = buildCVFilename(cvText, content.jobTitle, content.company, lang, format);

    try {
      if (format === 'docx') {
        const blob = await generateDOCXBlob(cvText);
        triggerDownload(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      } else {
        const blob = generatePDFBlob(cvText);
        triggerDownload(blob, filename, 'application/pdf');
      }
      ;(window as any).Analytics?.track?.('cv_downloaded', {
        lang,
        format,
        tier:       content.tier,
        is_trusted: content.isTrusted,
        resultId:   sessionStorage.getItem('gaslamar_result_id') || undefined,
      });
    } catch (err) {
      setShowMobileFb(true);
      console.error('[GasLamar] Download failed:', err);
    }
  }, [generate.content]);

  const handleFeedback = useCallback(async (type: FeedbackType) => {
    const { sessionId, sessionSecret } = session;
    if (!sessionId) return;
    try {
      await fetch(`${WORKER_URL}/feedback`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json', ...buildSecretHeaders(sessionSecret) },
        credentials: 'include',
        body:        JSON.stringify({ type }),
      });
      ;(window as any).Analytics?.track?.('interview_feedback', { type });
    } catch (_) { /* non-critical */ }
  }, [session.sessionId, session.sessionSecret]);

  const handleGenerateForNewJob = useCallback(async (jobDesc: string) => {
    const { sessionId, sessionSecret } = session;
    if (!sessionId) return;
    setView('generating');
    generate.startGeneration({ sessionId, sessionSecret, jobDesc });
  }, [session.sessionId, session.sessionSecret]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUrlFetch = useCallback(async (url: string): Promise<string> => {
    const { sessionId, sessionSecret } = session;
    const res = await fetch(`${WORKER_URL}/fetch-jd`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json', ...buildSecretHeaders(sessionSecret) },
      credentials: 'include',
      body:        JSON.stringify({ url }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({} as Record<string, unknown>));
      throw new Error(
        typeof (errData as any).message === 'string'
          ? (errData as any).message
          : 'Gagal mengambil job description. Coba copy-paste manual.',
      );
    }
    const data = await res.json() as { job_description?: string; text?: string };
    return data.job_description || data.text || '';
  }, [session.sessionId, session.sessionSecret]);

  const handleCancelGeneration = useCallback(() => {
    const prev = session.sessionData;
    if (prev && (prev.creditsRemaining < prev.totalCredits)) {
      setView('credits-dashboard');
    } else {
      window.location.href = 'hasil.html';
    }
  }, [session.sessionData]);

  // ── Derived values ────────────────────────────────────────────────────────

  const content    = generate.content;
  const tier       = content?.tier ?? session.sessionData?.tier ?? null;

  const [resultData] = useState<ResultData | null>(() => {
    try {
      const raw6d  = sessionStorage.getItem('gaslamar_6d_scores');
      if (!raw6d) return null;
      const skor6d = JSON.parse(raw6d) as Record<string, number>;
      const cvText = sessionStorage.getItem('gaslamar_cv_pending') || '';
      return buildResultData({ skor6d, cvText: cvText || undefined });
    } catch { return null; }
  });

  const dimensions = resultData?.scores;
  const creditsRemaining = content?.creditsRemaining ?? session.sessionData?.creditsRemaining ?? 1;
  const totalCredits     = content?.totalCredits     ?? session.sessionData?.totalCredits     ?? 1;
  const bilingual        = tier ? isBilingual(tier) : false;

  const filename = content
    ? buildCVFilename(content.cvId, content.jobTitle, content.company, 'id', 'docx')
    : 'CV.docx';

  const sessionError = view === 'error'
    ? (session.error ?? generate.error ?? { title: 'Terjadi Kesalahan', message: 'Terjadi kesalahan. Coba refresh halaman.', retryable: false })
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen text-gray-900 font-sans"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.08), transparent)' }}
    >
      {/* Skip link */}
      <a
        href="#download-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-0 focus:left-0 focus:z-[9999] focus:bg-slate-900 focus:text-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:rounded-br-lg"
      >
        Langsung ke download CV
      </a>

      {/* Countdown banner */}
      {countdownText && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-0 left-0 right-0 z-[60] text-center text-sm font-medium px-4 py-[7px]"
          style={{
            background:   countdownWarn ? '#FFFBEB' : 'rgba(255,255,255,0.92)',
            borderBottom: `1px solid ${countdownWarn ? '#FDE68A' : 'rgba(148,163,184,0.18)'}`,
            color:        countdownWarn ? '#92400E' : '#475569',
            backdropFilter: 'blur(12px)',
          }}
        >
          {countdownText}
        </div>
      )}

      {/* Navbar */}
      <nav
        className="sticky z-50 flex items-center px-6 py-4"
        style={{
          top:          countdownText ? '34px' : '0',
          background:   'rgba(255,255,255,0.88)',
          borderBottom: '1px solid rgba(148,163,184,0.18)',
          backdropFilter: 'blur(14px)',
        }}
        aria-label="Site navigation"
      >
        <a
          href="index.html"
          className="font-extrabold text-[1.1rem] text-slate-900 no-underline tracking-[-0.02em]"
        >
          GasLamar
        </a>
      </nav>

      {/* Main content */}
      <main
        id="download-main"
        className="px-4 py-8"
        style={{ paddingTop: countdownText ? 'calc(2rem + 34px)' : '2rem' }}
      >
        {view === 'error' && sessionError && !delivery && (
          <div className="max-w-[480px] mx-auto">
            <SessionError
              title={sessionError.title}
              message={sessionError.message}
              retryable={sessionError.retryable}
              onRetry={generate.error?.retryable ? generate.retryGeneration : undefined}
            />
          </div>
        )}

        {view === 'waiting' && (
          <div className="max-w-[480px] mx-auto">
            <WaitingPayment
              statusText={session.statusText}
              showCheckButton={session.showCheckButton}
              onCheckNow={session.onCheckNow}
            />
          </div>
        )}

        {view === 'generating' && (
          <div className="max-w-[720px] mx-auto">
            <GeneratingCV
              progress={generate.progress}
              status={generate.status === 'done' ? 'done' : 'running'}
              filename={filename}
              tier={tier}
              onCancel={handleCancelGeneration}
            />
          </div>
        )}

        {(view === 'ready' || view === 'credits-dashboard') && (
          <div className="max-w-[980px] mx-auto">
            <DownloadReady
              tier={tier ?? 'single'}
              filename={filename}
              expiryText={expiryText}
              cvTextId={content?.cvId ?? ''}
              cvTextEn={content?.cvEn ?? null}
              creditsRemaining={creditsRemaining}
              totalCredits={totalCredits}
              showDownloadGrid={view === 'ready'}
              onDownload={handleDownload}
              onFeedback={handleFeedback}
              onGenerateNext={handleGenerateForNewJob}
              onUrlFetch={handleUrlFetch}
              showMobileFallback={showMobileFb}
              dimensions={dimensions}
              primaryIssue={resultData?.primaryIssue ?? null}
              isTrusted={content?.isTrusted ?? false}
            />
          </div>
        )}

        {/* Delivery section — always rendered when delivery exists in localStorage */}
        {delivery && (
          <div className="max-w-[480px] mx-auto" style={{ marginTop: '2rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '1.25rem', marginBottom: '0.5rem', color: '#111827' }}>
              CV kamu sudah siap digunakan
            </h2>
            <ResendEmail sessionSecret={session?.sessionSecret ?? null} />
          </div>
        )}
      </main>

      <footer className="text-center py-8 text-xs text-slate-400">
        <a href="privacy.html" className="text-slate-500 no-underline hover:underline mx-2">Kebijakan Privasi</a>
        ·
        <a href="terms.html"   className="text-slate-500 no-underline hover:underline mx-2">Syarat Layanan</a>
      </footer>
    </div>
  );
}
