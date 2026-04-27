import { useState, useEffect } from 'react';
import type { ScoringData }    from '@/lib/resultUtils';
import { WORKER_URL }          from '@/lib/resultUtils';

export type NoSessionReason = 'expired' | 'missing';

export interface ResultDataState {
  data:        ScoringData | null;
  cvKey:       string;
  analyzeTime: number;
  loading:     boolean;
  error:       string | null;
  noSession:   NoSessionReason | null;
}

export function useResultData(): ResultDataState {
  const [state, setState] = useState<ResultDataState>({
    data: null, cvKey: '', analyzeTime: 0, loading: true, error: null, noSession: null,
  });

  useEffect(() => {
    const params     = new URLSearchParams(location.search);
    const urlSession = params.get('session') || params.get('sessionId');
    const rawScoring = sessionStorage.getItem('gaslamar_scoring');
    const cvKeyVal   = sessionStorage.getItem('gaslamar_cv_key') || '';
    const time       = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');

    const fail = (noSession: NoSessionReason) =>
      setState({ data: null, cvKey: '', analyzeTime: 0, loading: false, error: null, noSession });

    // Reject foreign URL session parameters
    if (urlSession !== null && !urlSession.startsWith('cvtext_')) { fail('expired'); return; }

    // Must have scoring data
    if (!rawScoring) { fail('missing'); return; }

    let parsed: ScoringData;
    try { parsed = JSON.parse(rawScoring); } catch { fail('missing'); return; }

    const skor = parseInt(String(parsed?.skor));
    if (isNaN(skor) || skor < 0 || skor > 100) { fail('missing'); return; }

    // cv_key format check
    if (cvKeyVal && !cvKeyVal.startsWith('cvtext_')) { fail('expired'); return; }

    // Session must not be older than 2 hours
    if (time > 0 && (Date.now() - time) / 1000 > 7200) { fail('expired'); return; }

    // Must have analyze_time
    if (!time) { fail('missing'); return; }

    // URL session must match storage
    if (urlSession && urlSession !== cvKeyVal) { fail('expired'); return; }

    // All checks passed — consume from sessionStorage (security: keep in memory only)
    sessionStorage.removeItem('gaslamar_scoring');
    // Persist 6D scores separately so Download page can access them after scoring is consumed
    if (parsed.skor_6d) {
      try { sessionStorage.setItem('gaslamar_6d_scores', JSON.stringify(parsed.skor_6d)); } catch (_) {}
    }

    // Analytics
    try {
      sessionStorage.setItem('gaslamar_score_displayed_at', String(Date.now()));
      (window as any).Analytics?.track?.('score_displayed', {
        score:        skor,
        score_bucket: skor >= 70 ? 'high' : skor >= 50 ? 'medium' : 'low',
        has_jd:       sessionStorage.getItem('gaslamar_had_jd') === '1',
        gap_count:    (parsed.gap || []).length,
      });
    } catch (_) {}

    setState({ data: parsed, cvKey: cvKeyVal, analyzeTime: time, loading: false, error: null, noSession: null });

    // Defense-in-depth: server-side session key validation (fail-open on network error)
    if (cvKeyVal.startsWith('cvtext_')) {
      fetch(`${WORKER_URL}/validate-session?cvKey=${encodeURIComponent(cvKeyVal)}`)
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then((result: { valid: boolean }) => {
          if (!result.valid) {
            sessionStorage.removeItem('gaslamar_cv_key');
            window.location.replace('upload.html?reason=expired');
          }
        })
        .catch(() => {}); // network unavailable — fail open
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
