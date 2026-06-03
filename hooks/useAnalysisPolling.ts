import { useState, useEffect, useRef, useMemo } from 'react';
import {
  WORKER_URL,
  ESTIMATED_MS,
  FETCH_TIMEOUT_MS,
  TOTAL_STEPS,
  STEP_INTERVAL,
  STEP_DEFS,
  getTimerText,
} from '@/lib/analysisUtils';

export type StepStatus = 'pending' | 'active' | 'done';

export interface AnalysisStep {
  id:          number;
  icon:        string;
  label:       string;
  activeDesc?: string;
  status:      StepStatus;
}

export interface UseAnalysisResult {
  progress:              number;
  steps:                 AnalysisStep[];
  timerText:             string;
  error:                 string | null;
  isFileError:           boolean;
  isRateLimit:           boolean;
  rateLimitSecsLeft:     number;
  isComplete:            boolean;
  retry:                 () => void;
  cancel:                () => void;
}

const INIT_TIMER = `⏱️ Estimasi selesai: sekitar ${Math.ceil(ESTIMATED_MS / 1000)} detik`;

export function useAnalysis(cvData: string, jobDesc: string): UseAnalysisResult {
  const [activeStep,  setActiveStep]  = useState(0);
  const [progress,    setProgress]    = useState(0);
  const [timerText,   setTimerText]   = useState(INIT_TIMER);
  const [error,            setError]            = useState<string | null>(null);
  const [isFileError,      setIsFileError]      = useState(false);
  const [isRateLimit,      setIsRateLimit]      = useState(false);
  const [rateLimitSecsLeft, setRateLimitSecsLeft] = useState(0);
  const [isComplete,       setIsComplete]       = useState(false);

  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for mutable values accessed inside timer callbacks (avoids stale closures)
  const doneRef         = useRef(false);
  const timedOutRef     = useRef(false);
  const startRef        = useRef(Date.now());
  const abortRef        = useRef(new AbortController());
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const steps = useMemo<AnalysisStep[]>(() =>
    STEP_DEFS.map((def, i) => {
      const n = i + 1;
      let status: StepStatus = 'pending';
      if (activeStep > TOTAL_STEPS) status = 'done';
      else if (n < activeStep)       status = 'done';
      else if (n === activeStep)     status = 'active';
      return { id: n, ...def, status };
    }),
    [activeStep],
  );

  function clearAllTimers() {
    if (timerRef.current)          { clearInterval(timerRef.current);        timerRef.current = null; }
    if (fetchTimeoutRef.current)   { clearTimeout(fetchTimeoutRef.current);   fetchTimeoutRef.current = null; }
    if (rateLimitTimerRef.current) { clearInterval(rateLimitTimerRef.current); rateLimitTimerRef.current = null; }
    stepTimeoutsRef.current.forEach(clearTimeout);
    stepTimeoutsRef.current = [];
  }

  function startCountdown() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (doneRef.current) return;
      setTimerText(getTimerText(Date.now() - startRef.current));
    }, 1000);
  }

  function scheduleSteps() {
    stepTimeoutsRef.current.forEach(clearTimeout);
    stepTimeoutsRef.current = [];

    // Step 1 active immediately
    setActiveStep(1);
    setProgress(Math.round((1 / (TOTAL_STEPS + 1)) * 90));

    for (let i = 1; i < TOTAL_STEPS; i++) {
      const step = i + 1;
      const id = setTimeout(() => {
        if (doneRef.current) return;
        setActiveStep(step);
        setProgress(Math.round((step / (TOTAL_STEPS + 1)) * 90));
      }, i * STEP_INTERVAL);
      stepTimeoutsRef.current.push(id);
    }
  }

  async function runAnalysis() {
    timedOutRef.current = false;
    abortRef.current    = new AbortController();

    fetchTimeoutRef.current = setTimeout(() => {
      timedOutRef.current = true;
      abortRef.current.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      (window as any).Analytics?.track?.('analysis_started', {
        has_jd: !!(jobDesc?.trim().length >= 50),
      });

      // Strip HTML tags from the job description before sending — defense-in-depth
      // alongside server-side validation. Equivalent to DOMPurify with ALLOWED_TAGS:[].
      const sanitizedJobDesc = jobDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      const res = await fetch(`${WORKER_URL}/analyze`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ cv: cvData, job_desc: sanitizedJobDesc }),
        signal:      abortRef.current.signal,
        // credentials:'include' is required so the browser saves the HttpOnly cv_key cookie
        // returned in the Set-Cookie header. Without this, cross-origin cookies are discarded.
        credentials: 'include',
      });

      if (fetchTimeoutRef.current) { clearTimeout(fetchTimeoutRef.current); fetchTimeoutRef.current = null; }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const secs = err.retryAfter || 900;
          const waitText = secs >= 60 ? `${Math.ceil(secs / 60)} menit` : `${secs} detik`;
          const rlErr = new Error(`Terlalu banyak permintaan. Silakan coba lagi dalam ${waitText}.`);
          (rlErr as any).isRateLimit  = true;
          (rlErr as any).retryAfter   = secs;
          throw rlErr;
        }
        if (res.status === 422) {
          const fileErr = new Error(err.message || 'CV tidak bisa dibaca. Coba konversi ke format DOCX atau TXT terlebih dahulu.');
          (fileErr as any).isFileError = true;
          throw fileErr;
        }
        throw new Error(err.message || `Server error: ${res.status}`);
      }

      const result = await res.json();
      // cv_text_key is no longer returned in the response body — it is sent as an HttpOnly
      // cookie (cv_key) by the server, preventing XSS from reading the analysis token.
      const { ...scoringOnly } = result;

      // cv_key is now an HttpOnly cookie set by /analyze — not readable from JS.

      // result_id is used inline for analytics only — never written to sessionStorage.
      const resultId = (result.result_id && typeof result.result_id === 'string')
        ? result.result_id : undefined;

      (window as any).Analytics?.track?.('analysis_completed', {
        score:      result.skor        || null,
        confidence: result.konfidensitas || null,
        resultId,
        time_ms: (() => {
          const t = sessionStorage.getItem('gaslamar_upload_start');
          return t ? Date.now() - parseInt(t, 10) : undefined;
        })(),
      });

      ['gaslamar_cv_pending', 'gaslamar_jd_pending', 'gaslamar_filename', 'gaslamar_jd_draft',
       'gaslamar_cv_draft', 'gaslamar_filename_draft']
        .forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });

      doneRef.current = true;
      clearAllTimers();
      setActiveStep(TOTAL_STEPS + 1);
      setProgress(100);
      setTimerText('✅ Analisis selesai! Mengarahkan ke hasil...');
      setIsComplete(true);

    } catch (err) {
      if (fetchTimeoutRef.current) { clearTimeout(fetchTimeoutRef.current); fetchTimeoutRef.current = null; }
      clearAllTimers();

      const e = err as Error;
      if (e.name === 'AbortError' && !timedOutRef.current) return; // user-initiated cancel

      (window as any).Analytics?.trackError?.('analysis_api', {
        error_message: (e.message || '').slice(0, 150),
        is_timeout:    timedOutRef.current,
        is_network:    e.name === 'TypeError',
      });

      let msg = e.message || 'Terjadi kesalahan. Coba lagi.';
      let fileError  = !!(e as any).isFileError;
      let rateLimit  = !!(e as any).isRateLimit;
      let retryAfterSecs: number = (e as any).retryAfter || 0;
      if (e.name === 'TypeError') {
        msg = 'Tidak bisa terhubung ke server. Periksa koneksi internet kamu, lalu coba lagi.';
      } else if (timedOutRef.current || e.name === 'AbortError') {
        msg = 'Analisis memakan waktu terlalu lama. Coba lagi — PDF kadang membutuhkan waktu ekstra.';
      }

      setIsFileError(fileError);
      setIsRateLimit(rateLimit);

      if (rateLimit && retryAfterSecs > 0) {
        setRateLimitSecsLeft(retryAfterSecs);
        rateLimitTimerRef.current = setInterval(() => {
          setRateLimitSecsLeft(prev => {
            if (prev <= 1) {
              if (rateLimitTimerRef.current) { clearInterval(rateLimitTimerRef.current); rateLimitTimerRef.current = null; }
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }

      setError(msg);
    }
  }

  function startFresh() {
    doneRef.current  = false;
    startRef.current = Date.now();
    setError(null);
    setIsFileError(false);
    setIsRateLimit(false);
    setRateLimitSecsLeft(0);
    if (rateLimitTimerRef.current) { clearInterval(rateLimitTimerRef.current); rateLimitTimerRef.current = null; }
    setIsComplete(false);
    setProgress(0);
    setActiveStep(0);
    setTimerText(INIT_TIMER);
    startCountdown();
    scheduleSteps();
    runAnalysis();
  }

  const retry = () => { clearAllTimers(); startFresh(); };

  const cancel = () => {
    if (fetchTimeoutRef.current) { clearTimeout(fetchTimeoutRef.current); fetchTimeoutRef.current = null; }
    abortRef.current.abort(); // isTimedOut stays false → catch returns silently
    clearAllTimers();
  };

  useEffect(() => {
    startFresh();
    return clearAllTimers;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { progress, steps, timerText, error, isFileError, isRateLimit, rateLimitSecsLeft, isComplete, retry, cancel };
}
