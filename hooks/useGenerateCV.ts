import { useState, useRef, useCallback } from 'react';
import {
  WORKER_URL,
  clearClientSessionData,
  buildSecretHeaders,
} from '@/lib/sessionUtils';
import { getPrimaryIssue } from '@/lib/resultUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CVContent {
  cvId:             string;
  cvIdDocx:         string;
  cvEn:             string | null;
  cvEnDocx:         string | null;
  jobTitle:         string | null;
  company:          string | null;
  creditsRemaining: number;
  totalCredits:     number;
  tier:             string;
  isTrusted:        boolean;
  interviewKit:     unknown | null;
}

export interface GenerateCVError {
  title:     string;
  message:   string;
  retryable: boolean;
}

export type GenerateStatus = 'idle' | 'running' | 'done' | 'error';

export interface GenerateCVParams {
  sessionId:     string;
  sessionSecret: string | null;
  jobDesc?:      string;
}

export interface UseGenerateCVReturn {
  status:          GenerateStatus;
  progress:        number;
  tier:            string | null;
  content:         CVContent | null;
  error:           GenerateCVError | null;
  startGeneration: (params: GenerateCVParams) => void;
  retryGeneration: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGenerateCV(): UseGenerateCVReturn {
  const [status,   setStatus]   = useState<GenerateStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [tier,     setTier]     = useState<string | null>(null);
  const [content,  setContent]  = useState<CVContent | null>(null);
  const [error,    setError]    = useState<GenerateCVError | null>(null);

  const paramsRef   = useRef<GenerateCVParams | null>(null);
  const mountedRef  = useRef(true);
  const abortRef    = useRef<AbortController | null>(null);

  // ── showError helper ──────────────────────────────────────────────────────

  function showError(title: string, message: string, retryable = false) {
    if (!mountedRef.current) return;
    setStatus('error');
    setError({ title, message, retryable });
  }

  // ── Core generation flow ──────────────────────────────────────────────────

  const startGeneration = useCallback(async (params: GenerateCVParams) => {
    paramsRef.current  = params;
    mountedRef.current = true;
    abortRef.current?.abort(); // cancel any in-flight request

    setStatus('running');
    setProgress(10);
    setError(null);
    setContent(null);
    setTier(null);

    const baseHeaders = {
      'Content-Type': 'application/json',
      ...buildSecretHeaders(params.sessionSecret),
    };

    ;(window as any).Analytics?.track?.('cv_generation_started', {
      tier:     sessionStorage.getItem('gaslamar_tier')     || undefined,
      resultId: sessionStorage.getItem('gaslamar_result_id') || undefined,
    });

    // ── Step 1: /get-session ─────────────────────────────────────────────────
    const ctrl1   = new AbortController();
    abortRef.current = ctrl1;
    const timer1  = setTimeout(() => ctrl1.abort(), 25000);

    try {
      const res = await fetch(`${WORKER_URL}/get-session`, {
        method:      'POST',
        headers:     baseHeaders,
        credentials: 'include',
        signal:      ctrl1.signal,
      });
      clearTimeout(timer1);
      if (!mountedRef.current) return;

      if (res.status === 401) {
        showError('Sesi Tidak Ditemukan', 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies, lalu coba refresh halaman ini.');
        return;
      }
      if (res.status === 403) {
        showError('Akses Ditolak', 'Pembayaran belum dikonfirmasi atau sesi tidak valid.');
        return;
      }
      if (res.status === 404) {
        clearClientSessionData(params.sessionId);
        const errData  = await res.json().catch(() => ({} as Record<string, unknown>));
        const t        = sessionStorage.getItem('gaslamar_tier') || '';
        const validity = (t === '3pack' || t === 'jobhunt') ? '30 hari' : '7 hari';
        const msg      = (errData as any).reason === 'expired'
          ? `⏰ Sesi kamu sudah berakhir setelah ${validity}. Silakan upload ulang CV untuk analisis baru.`
          : 'Sesi tidak ditemukan atau sudah berakhir. Upload ulang CV untuk analisis baru.';
        showError('Sesi Berakhir', msg);
        return;
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const sessionData      = await res.json() as { tier: string };
      const confirmedTier    = sessionData.tier || 'single';

      // Sync tier from server — warn if client/server mismatch detected
      const stored = sessionStorage.getItem('gaslamar_tier');
      if (stored && stored !== confirmedTier) {
        console.warn(`[GasLamar] Tier mismatch: ${stored} → ${confirmedTier}. UI corrected.`);
      }
      sessionStorage.setItem('gaslamar_tier', confirmedTier);

      if (!mountedRef.current) return;
      setTier(confirmedTier);
      setProgress(25);

      // ── Step 2: /generate ────────────────────────────────────────────────
      const ctrl2 = new AbortController();
      abortRef.current = ctrl2;
      const timer2 = setTimeout(() => ctrl2.abort(), 60000);

      try {
        setProgress(40);

        const reqBody: Record<string, unknown> = {};
        if (params.jobDesc) reqBody.job_desc = params.jobDesc;

        // Pass score + gaps for the worker's post-generate email.
        // Scoring object uses `skor` and `gap` (not `score`/`gaps`).
        try {
          const scoring = JSON.parse(sessionStorage.getItem('gaslamar_scoring') || '{}') as Record<string, unknown>;
          if (typeof scoring.skor === 'number')                         reqBody.score = scoring.skor;
          if (Array.isArray(scoring.gap) && scoring.gap.length > 0)   reqBody.gaps  = (scoring.gap as unknown[]).slice(0, 3);
        } catch (_) { /* ignore malformed sessionStorage */ }

        // Pass preview data for Hasil→Download consistency.
        // gaslamar_sample and gaslamar_preview_after are persisted in useAnalysisPolling
        // before gaslamar_cv_pending is cleared, so they are always available here.
        try {
          const rawSample    = sessionStorage.getItem('gaslamar_sample');
          const previewAfter = sessionStorage.getItem('gaslamar_preview_after');
          const raw6d        = sessionStorage.getItem('gaslamar_6d_scores');
          const rawKlaim     = sessionStorage.getItem('gaslamar_entitas_klaim');
          if (rawSample) {
            const sample = JSON.parse(rawSample) as { text: string; index: number; section: string };
            if (sample.text) reqBody.preview_sample = sample.text;
            // Only send validated personalized preview_after — never generic templates
            if (previewAfter) reqBody.preview_after = previewAfter;
            if (raw6d) {
              const primaryIssue = getPrimaryIssue(JSON.parse(raw6d) as Record<string, number>);
              if (primaryIssue) reqBody.primary_issue = primaryIssue;
            }
          }
          if (rawKlaim) {
            const klaim = JSON.parse(rawKlaim) as string[];
            if (Array.isArray(klaim) && klaim.length > 0) reqBody.entitas_klaim = klaim;
          }
        } catch (_) { /* ignore */ }

        // Attach resultId for analytics correlation across analyze→generate
        const resultId = sessionStorage.getItem('gaslamar_result_id') || undefined;
        if (resultId) reqBody.result_id = resultId;

        const genRes = await fetch(`${WORKER_URL}/generate`, {
          method:      'POST',
          headers:     baseHeaders,
          credentials: 'include',
          body:        JSON.stringify(reqBody),
          signal:      ctrl2.signal,
        });
        clearTimeout(timer2);
        if (!mountedRef.current) return;

        if (!genRes.ok) {
          let serverMsg = `Gagal generate CV (${genRes.status})`;
          try {
            const errData = await genRes.json() as Record<string, unknown>;
            if (typeof errData.message === 'string') serverMsg = errData.message;
          } catch (_) {}

          if (genRes.status === 404) {
            showError(
              'Sesi Tidak Ditemukan',
              'Sesi tidak ditemukan atau sudah berakhir. Sesi berbayar berlaku 7 hari — jika kamu masih dalam periode ini, coba refresh. Jika sudah lebih dari 7 hari, upload ulang CV untuk analisis baru.',
            );
            return;
          }
          if (genRes.status === 403) {
            showError('Akses Ditolak', serverMsg);
            return;
          }
          // 500 / 429 — server resets session to 'paid', so retry is valid
          showError('Gagal Generate CV', `${serverMsg} Klik "Coba Lagi" untuk mencoba ulang.`, true);
          return;
        }

        setProgress(75);

        const {
          cv_id,
          cv_id_docx,
          cv_en,
          cv_en_docx,
          isTrusted,
          credits_remaining,
          total_credits,
          job_title,
          company,
          interview_kit,
        } = await genRes.json() as {
          cv_id:             string;
          cv_id_docx:        string;
          cv_en?:            string;
          cv_en_docx?:       string;
          isTrusted?:        boolean;
          credits_remaining: number;
          total_credits:     number;
          job_title?:        string;
          company?:          string;
          interview_kit?:    unknown;
        };

        ;(window as any).Analytics?.track?.('cv_generated', {
          tier:              confirmedTier,
          is_bilingual:      confirmedTier !== 'coba',
          has_english:       !!cv_en,
          credits_remaining: credits_remaining ?? 0,
          is_trusted:        isTrusted ?? false,
          resultId:          sessionStorage.getItem('gaslamar_result_id') || undefined,
        });

        // Clear session storage when all credits are exhausted
        if (!credits_remaining || credits_remaining <= 0) {
          localStorage.removeItem('gaslamar_session');
          localStorage.removeItem('gaslamar_tier');
          sessionStorage.removeItem('gaslamar_tier');
        }

        // Clear analysis-derived data — no longer needed now that generation succeeded.
        // For multi-credit users making a second generation these degrade gracefully
        // (email omits score, entitas_klaim guard is skipped — both are acceptable).
        [
          'gaslamar_scoring', 'gaslamar_6d_scores', 'gaslamar_skor', 'gaslamar_skor_sesudah', 'gaslamar_gap',
          'gaslamar_entitas_klaim', 'gaslamar_sample', 'gaslamar_preview_after',
          'gaslamar_sample_context', 'gaslamar_sample_fallback',
        ].forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });

        if (!mountedRef.current) return;
        setProgress(90);

        setTimeout(() => {
          if (!mountedRef.current) return;
          setProgress(100);
          setContent({
            cvId:             cv_id,
            cvIdDocx:         cv_id_docx || cv_id,
            cvEn:             cv_en      || null,
            cvEnDocx:         cv_en_docx || cv_en || null,
            jobTitle:         job_title  || null,
            company:          company    || null,
            creditsRemaining: credits_remaining ?? 0,
            totalCredits:     total_credits     ?? 1,
            tier:             confirmedTier,
            isTrusted:        isTrusted  ?? false,
            interviewKit:     interview_kit     ?? null,
          });
          setStatus('done');
        }, 500);

      } catch (err) {
        clearTimeout(timer2);
        if (!mountedRef.current) return;
        if ((err as Error).name === 'AbortError') {
          showError('Timeout', 'Generate CV timeout. Refresh halaman untuk coba lagi.');
        } else {
          showError('Terjadi Kesalahan', (err as Error).message || 'Gagal memproses CV. Coba refresh halaman.', true);
        }
      }

    } catch (err) {
      clearTimeout(timer1);
      if (!mountedRef.current) return;
      if ((err as Error).name === 'AbortError') {
        showError('Timeout', 'Koneksi timeout. Coba refresh halaman ini.');
      } else {
        showError('Terjadi Kesalahan', (err as Error).message || 'Gagal memproses CV. Coba refresh halaman.');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const retryGeneration = useCallback(() => {
    if (!paramsRef.current) { window.location.reload(); return; }
    startGeneration(paramsRef.current);
  }, [startGeneration]);

  return { status, progress, tier, content, error, startGeneration, retryGeneration };
}
