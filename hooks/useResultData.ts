import { useState, useEffect } from 'react';
import type { ScoringData }    from '@/lib/resultUtils';
import { WORKER_URL }          from '@/lib/resultUtils';

export type NoSessionReason = 'expired' | 'missing' | 'data_missing';

export interface ResultDataState {
  data:             ScoringData | null;
  cvKey:            string;
  analyzeTime:      number;
  scoreDisplayedAt: number;
  loading:          boolean;
  error:            string | null;
  noSession:        NoSessionReason | null;
}

export function useResultData(): ResultDataState {
  const [state, setState] = useState<ResultDataState>({
    data: null, cvKey: '', analyzeTime: 0, scoreDisplayedAt: 0, loading: true, error: null, noSession: null,
  });

  useEffect(() => {
    const params     = new URLSearchParams(location.search);
    const urlSession = params.get('session') || params.get('sessionId');
    // analyzeTime was previously stored in sessionStorage; now defaults to 0 (countdown hidden).
    const time = 0;

    const fail = (noSession: NoSessionReason) =>
      setState({ data: null, cvKey: '', analyzeTime: 0, scoreDisplayedAt: 0, loading: false, error: null, noSession });

    // Guard already classified the error synchronously — propagate it.
    const guardError = (window as any).__hasilSessionError;
    if (guardError === 'no_session') { fail('missing'); return; }
    if (guardError === 'expired')    { fail('expired'); return; }

    // Reject foreign URL session parameters
    if (urlSession !== null && !urlSession.startsWith('cvtext_')) { fail('expired'); return; }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Step 1: validate the analysis session cookie via /check-session.
    // Accepts both sessionToken (new) and cv_key (legacy) cookies.
    // Returns { valid: true, resultId } on success; 401 / valid:false on failure.
    const fetchScoring = () =>
      fetch(`${WORKER_URL}/check-session`, { credentials: 'include' })
        .then(async checkRes => {
          if (cancelled) return;

          if (checkRes.status === 401) {
            try { sessionStorage.removeItem('gaslamar_analyze_time'); } catch (_) {}
            fail('expired');
            return;
          }

          const checkBody = await checkRes.json() as {
            valid?: boolean;
            authenticated?: boolean;
            reason?: string;
            type?: string;
          };

          // Payment session — don't interfere with the download flow.
          if (checkBody?.valid && checkBody?.type !== 'analysis') return;

          if (!checkBody?.valid && !checkBody?.authenticated) {
            try { sessionStorage.removeItem('gaslamar_analyze_time'); } catch (_) {}
            const reason = checkBody?.reason;
            fail(reason === 'expired' ? 'expired' : 'missing');
            return;
          }

          // Step 2: fetch the scoring data using the same cookie.
          return fetch(`${WORKER_URL}/get-scoring`, { credentials: 'include' })
            .then(async r => {
              if (cancelled) return;
              if (r.status === 404) {
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

              const now = Date.now();
              try {
                (window as any).Analytics?.track?.('score_displayed', {
                  score:        skor,
                  score_bucket: skor >= 70 ? 'high' : skor >= 50 ? 'medium' : 'low',
                  has_jd:       sessionStorage.getItem('gaslamar_had_jd') === '1',
                  gap_count:    (s.gap || []).length,
                });
              } catch (_) {}

              if (!cancelled) setState({ data: s ?? null, cvKey: '', analyzeTime: time, scoreDisplayedAt: now, loading: false, error: null, noSession: null });
            });
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
