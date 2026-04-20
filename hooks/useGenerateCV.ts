import { useState, useRef, useCallback } from 'react';
import {
  WORKER_URL,
  clearClientSessionData,
  buildSecretHeaders,
} from '@/lib/downloadUtils';
import { buildResultData } from '@/lib/resultUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CVContent {
  cvId:             string;
  cvEn:             string | null;
  jobTitle:         string | null;
  company:          string | null;
  creditsRemaining: number;
  totalCredits:     number;
  tier:             string;
  isTrusted?:       boolean;
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
      tier: sessionStorage.getItem('gaslamar_tier') || undefined,
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

        // Pass score + gaps for the worker's post-generate email
        try {
          const scoring = JSON.parse(sessionStorage.getItem('gaslamar_scoring') || '{}') as Record<string, unknown>;
          if (typeof scoring.score === 'number')                          reqBody.score = scoring.score;
          if (Array.isArray(scoring.gaps) && scoring.gaps.length > 0)   reqBody.gaps  = (scoring.gaps as unknown[]).slice(0, 3);
        } catch (_) { /* ignore malformed sessionStorage */ }

        // Pass preview data for Hasil→Download consistency
        try {
          const raw6d  = sessionStorage.getItem('gaslamar_6d_scores');
          const cvText = sessionStorage.getItem('gaslamar_cv_pending') || '';
          if (raw6d && cvText) {
            const rd = buildResultData({ skor6d: JSON.parse(raw6d) as Record<string, number>, cvText });
            if (rd.primaryIssue) reqBody.primary_issue = rd.primaryIssue;
            if (rd.sampleLine)   reqBody.preview_sample = rd.sampleLine;
            if (rd.rewritePreview?.after) reqBody.preview_after = rd.rewritePreview.after;
          }
        } catch (_) { /* ignore */ }

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
          cv_en,
          is_trusted,
          credits_remaining,
          total_credits,
          job_title,
          company,
        } = await genRes.json() as {
          cv_id:             string;
          cv_en?:            string;
          is_trusted?:       boolean;
          credits_remaining: number;
          total_credits:     number;
          job_title?:        string;
          company?:          string;
        };

        ;(window as any).Analytics?.track?.('cv_generated', {
          tier:              confirmedTier,
          is_bilingual:      confirmedTier !== 'coba',
          has_english:       !!cv_en,
          credits_remaining: credits_remaining ?? 0,
        });

        // Clear session storage when all credits are exhausted
        if (!credits_remaining || credits_remaining <= 0) {
          localStorage.removeItem('gaslamar_session');
          localStorage.removeItem('gaslamar_tier');
          sessionStorage.removeItem('gaslamar_tier');
        }

        if (!mountedRef.current) return;
        setProgress(90);

        setTimeout(() => {
          if (!mountedRef.current) return;
          setProgress(100);
          setContent({
            cvId:             cv_id,
            cvEn:             cv_en || null,
            jobTitle:         job_title || null,
            company:          company   || null,
            creditsRemaining: credits_remaining ?? 0,
            totalCredits:     total_credits     ?? 1,
            tier:             confirmedTier,
            isTrusted:        is_trusted ?? false,
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
