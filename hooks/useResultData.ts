import { useState, useEffect } from 'react';
import type { ScoringData }    from '@/lib/resultUtils';
import { WORKER_URL }          from '@/lib/resultUtils';

export type NoSessionReason = 'expired' | 'missing' | 'data_missing';

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
    const time       = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');

    const fail = (noSession: NoSessionReason) =>
      setState({ data: null, cvKey: '', analyzeTime: 0, loading: false, error: null, noSession });

    // Guard already classified the error synchronously — propagate it.
    const guardError = (window as any).__hasilSessionError;
    if (guardError === 'no_session') { fail('missing'); return; }
    if (guardError === 'expired')    { fail('expired'); return; }

    // Reject foreign URL session parameters
    if (urlSession !== null && !urlSession.startsWith('cvtext_')) { fail('expired'); return; }

    // Always fetch from server using the HttpOnly cv_key cookie set by /analyze.
    // sessionStorage is never used as a fast path — scoring data must not persist
    // client-side where XSS can read it.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchScoring = () =>
      fetch(`${WORKER_URL}/get-scoring`, { credentials: 'include' })
        .then(async r => {
          if (cancelled) return;
          if (r.status === 404) {
            // Cookie exists (guard passed) but KV entry is gone — data not found.
            try { sessionStorage.removeItem('gaslamar_analyze_time'); } catch (_) {}
            fail('data_missing');
            return;
          }
          if (r.status === 401) {
            try { sessionStorage.removeItem('gaslamar_analyze_time'); } catch (_) {}
            fail('expired');
            return;
          }
          if (!r.ok) throw new Error(`server_${r.status}`);
          const body = await r.json() as { scoring?: ScoringData; valid?: boolean };
          if (!body?.scoring) throw new Error('no_scoring_field');
          const s = body.scoring;
          const skor = parseInt(String(s?.skor));
          if (isNaN(skor) || skor < 0 || skor > 100) { if (!cancelled) fail('missing'); return; }
          if (time > 0 && (Date.now() - time) / 1000 > 86400) { if (!cancelled) fail('expired'); return; }

          // Persist minimal derived numbers for the Download page score badge.
          // These are plain numbers, not the full scoring blob or any CV content.
          if (s.skor_6d) {
            try { sessionStorage.setItem('gaslamar_6d_scores', JSON.stringify(s.skor_6d)); } catch (_) {}
          }
          if (typeof s.skor === 'number') {
            try { sessionStorage.setItem('gaslamar_skor', String(s.skor)); } catch (_) {}
          }
          if (typeof s.skor_sesudah === 'number') {
            try { sessionStorage.setItem('gaslamar_skor_sesudah', String(s.skor_sesudah)); } catch (_) {}
          }
          if (Array.isArray(s.gap) && s.gap.length > 0) {
            try { sessionStorage.setItem('gaslamar_gap', JSON.stringify((s.gap as string[]).slice(0, 5))); } catch (_) {}
          }

          // Analytics
          try {
            sessionStorage.setItem('gaslamar_score_displayed_at', String(Date.now()));
            (window as any).Analytics?.track?.('score_displayed', {
              score:        skor,
              score_bucket: skor >= 70 ? 'high' : skor >= 50 ? 'medium' : 'low',
              has_jd:       sessionStorage.getItem('gaslamar_had_jd') === '1',
              gap_count:    (s.gap || []).length,
            });
          } catch (_) {}

          if (!cancelled) setState({ data: s ?? null, cvKey: '', analyzeTime: time, loading: false, error: null, noSession: null });

          // Defence-in-depth: verify server-side session validity (cookie-based, fail-open).
          fetch(`${WORKER_URL}/validate-session`, { credentials: 'include' })
            .then(r => (r.ok ? r.json() : Promise.reject()))
            .then((result: { valid: boolean }) => {
              if (!result.valid) {
                try { sessionStorage.removeItem('gaslamar_analyze_time'); } catch (_) {}
                if (!cancelled) setState(prev => ({ ...prev, data: null, loading: false, noSession: 'expired' }));
              }
            })
            .catch(() => {}); // network unavailable — fail open
        });

    // One automatic retry after a transient server/network error.
    fetchScoring().catch(() => {
      if (cancelled) return;
      retryTimer = setTimeout(() => fetchScoring().catch(() => { if (!cancelled) fail('missing'); }), 1500);
    });
    return () => { cancelled = true; if (retryTimer !== null) clearTimeout(retryTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
