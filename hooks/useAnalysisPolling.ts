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
import { buildResultData } from '@/lib/resultUtils';
import { extractSampleLine } from '@/lib/cvUtils';

export type StepStatus = 'pending' | 'active' | 'done';

export interface AnalysisStep {
  id:     number;
  icon:   string;
  label:  string;
  status: StepStatus;
}

export interface UseAnalysisResult {
  progress:    number;
  steps:       AnalysisStep[];
  timerText:   string;
  error:       string | null;
  isFileError: boolean;
  isComplete:  boolean;
  retry:       () => void;
  cancel:      () => void;
}

const INIT_TIMER = `⏱️ Estimasi selesai: ~${Math.ceil(ESTIMATED_MS / 1000)} detik`;

export function useAnalysis(cvData: string, jobDesc: string): UseAnalysisResult {
  const [activeStep,  setActiveStep]  = useState(0);
  const [progress,    setProgress]    = useState(0);
  const [timerText,   setTimerText]   = useState(INIT_TIMER);
  const [error,       setError]       = useState<string | null>(null);
  const [isFileError, setIsFileError] = useState(false);
  const [isComplete,  setIsComplete]  = useState(false);

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
    if (timerRef.current)        { clearInterval(timerRef.current);       timerRef.current = null; }
    if (fetchTimeoutRef.current) { clearTimeout(fetchTimeoutRef.current);  fetchTimeoutRef.current = null; }
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

      const res = await fetch(`${WORKER_URL}/analyze`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cv: cvData, job_desc: jobDesc }),
        signal:  abortRef.current.signal,
      });

      if (fetchTimeoutRef.current) { clearTimeout(fetchTimeoutRef.current); fetchTimeoutRef.current = null; }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429)
          throw new Error(`Terlalu banyak permintaan. Coba lagi dalam ${err.retryAfter || 60} detik.`);
        if (res.status === 422) {
          const fileErr = new Error(err.message || 'CV tidak bisa dibaca. Coba konversi ke format DOCX atau TXT terlebih dahulu.');
          (fileErr as any).isFileError = true;
          throw fileErr;
        }
        throw new Error(err.message || `Server error: ${res.status}`);
      }

      const result = await res.json();
      const { cv_text_key: cvKey, ...scoringOnly } = result;

      // Extract sample context from cv_pending BEFORE clearing it (synchronous)
      try {
        const cvPending = sessionStorage.getItem('gaslamar_cv_pending') || '';
        if (cvPending) {
          const lines = cvPending.split('\n').map((text, index) => ({ text: text.trim(), index }));
          const longLines = lines.filter(l => l.text.length > 20);
          const bulletLine = longLines.find(({ text }) =>
            text.startsWith('•') || text.startsWith('-') ||
            /^(manage|develop|create|mengelola|membuat|mengembangkan)/i.test(text),
          );
          const target = bulletLine ?? longLines[0] ?? null;
          if (target) {
            const contextStart = Math.max(0, target.index - 1);
            const contextEnd   = Math.min(lines.length - 1, target.index + 1);
            const originalBlock = lines.slice(contextStart, contextEnd + 1).map(l => l.text).join('\n');
            const sampleContext = { line: target.text, index: target.index, originalBlock };
            sessionStorage.setItem('gaslamar_sample_context', JSON.stringify(sampleContext));
            sessionStorage.setItem('gaslamar_sample_line', target.text);
          }
          // Fallback: store first 500 chars in case no bullet line was found
          if (!bulletLine) {
            sessionStorage.setItem('gaslamar_sample_fallback', cvPending.slice(0, 500));
          }
        }
      } catch (_) {}

      // Persist entitas_klaim for the /generate request
      try {
        const klaim = result.entitas_klaim;
        if (Array.isArray(klaim)) {
          sessionStorage.setItem('gaslamar_entitas_klaim', JSON.stringify(klaim));
        }
      } catch (_) {}

      // Generate a deterministic-ish resultId for analytics correlation
      try {
        const cvPrefix = (sessionStorage.getItem('gaslamar_cv_pending') || '')
          .replace(/\W/g, '').slice(0, 8).toLowerCase();
        const resultId = `res_${Date.now().toString(36)}_${cvPrefix}`;
        sessionStorage.setItem('gaslamar_result_id', resultId);
      } catch (_) {}

      sessionStorage.setItem('gaslamar_scoring',      JSON.stringify(scoringOnly));
      sessionStorage.setItem('gaslamar_cv_key',       cvKey || '');
      sessionStorage.setItem('gaslamar_analyze_time', String(Date.now()));

      (window as any).Analytics?.track?.('analysis_completed', {
        score:      result.skor        || null,
        confidence: result.konfidensitas || null,
        resultId:   sessionStorage.getItem('gaslamar_result_id') || undefined,
        time_ms: (() => {
          const t = sessionStorage.getItem('gaslamar_upload_start');
          return t ? Date.now() - parseInt(t, 10) : undefined;
        })(),
      });

      // Persist sample line + preview_after BEFORE clearing cv_pending.
      // useGenerateCV reads these on the Download page to inject the exact
      // preview rewrite the user saw, ensuring preview = download consistency.
      try {
        const cvText = sessionStorage.getItem('gaslamar_cv_pending') || '';
        if (cvText && scoringOnly.skor_6d) {
          const rd = buildResultData({ skor6d: scoringOnly.skor_6d as Record<string, number>, cvText });
          if (rd.sampleLine) {
            const lines = cvText.split('\n');
            const idx   = lines.findIndex(l => l.includes(rd.sampleLine!));
            sessionStorage.setItem('gaslamar_sample', JSON.stringify({
              text:  rd.sampleLine,
              index: idx,
            }));
          }
          if (rd.rewritePreview?.after && !rd.rewritePreview.after.includes('[')) {
            sessionStorage.setItem('gaslamar_preview_after', rd.rewritePreview.after);
          }
        }
      } catch (e) {
        console.warn('[GasLamar] Failed to persist sample line for preview consistency:', e);
      }

      ['gaslamar_cv_pending', 'gaslamar_jd_pending', 'gaslamar_filename', 'gaslamar_jd_draft']
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
      let fileError = !!(e as any).isFileError;
      if (e.name === 'TypeError' && e.message?.includes('fetch')) {
        msg = 'Tidak bisa terhubung ke server. Periksa koneksi internet kamu, lalu coba lagi.';
      } else if (timedOutRef.current || e.name === 'AbortError') {
        msg = 'Analisis memakan waktu terlalu lama. Coba lagi — PDF kadang membutuhkan waktu ekstra.';
      }

      setIsFileError(fileError);
      setError(msg);
    }
  }

  function startFresh() {
    doneRef.current  = false;
    startRef.current = Date.now();
    setError(null);
    setIsFileError(false);
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

  return { progress, steps, timerText, error, isFileError, isComplete, retry, cancel };
}
