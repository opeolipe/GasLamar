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

    // Safari/ITP fallback: if cross-site cookies were blocked, useAnalysisPolling stored
    // the analysisSessionId in sessionStorage. Pass it as X-Analysis-Session header.
    const sessionFallback = (() => {
      try { return sessionStorage.getItem('gaslamar_analysis_session'); } catch { return null; }
    })();

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Step 1: validate the analysis session via /check-session.
    // Primary: HttpOnly cookie (Chrome, Firefox).
    // Fallback: X-Analysis-Session header when cookies are blocked (Safari ITP).
    // extraHeaders is empty on first attempt; populated with the fallback on retry.
    const fetchScoring = (extraHeaders: Record<string, string> = {}): Promise<void> =>
      fetch(`${WORKER_URL}/check-session`, { credentials: 'include', headers: extraHeaders })
        .then(async (checkRes): Promise<void> => {
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
            // Cookies returned no_session and we haven't tried the header yet — retry once.
            if (!extraHeaders['X-Analysis-Session'] && sessionFallback) {
              return fetchScoring({ 'X-Analysis-Session': sessionFallback });
            }
            try { sessionStorage.removeItem('gaslamar_analyze_time'); } catch (_) {}
            const reason = checkBody?.reason;
            fail(reason === 'expired' ? 'expired' : 'missing');
            return;
          }

          // Step 2: fetch the scoring data, forwarding the same auth headers.
          return fetch(`${WORKER_URL}/get-scoring`, { credentials: 'include', headers: extraHeaders })
            .then(async (r): Promise<void> => {
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
