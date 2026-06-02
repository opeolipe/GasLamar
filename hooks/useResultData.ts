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
    const rawScoring = sessionStorage.getItem('gaslamar_scoring');
    // Legacy: old sessions may still have cv_key in sessionStorage — query param fallback only
    const cvKeyVal   = sessionStorage.getItem('gaslamar_cv_key') || '';
    // analyzeTime is kept for countdown UX only — not used for auth decisions
    const analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');

    const fail = (noSession: NoSessionReason) =>
      setState({ data: null, cvKey: '', analyzeTime: 0, loading: false, error: null, noSession });

    // Guard already classified the error synchronously — propagate it.
    const guardError = (window as any).__hasilSessionError;
    if (guardError === 'no_session') { fail('missing'); return; }
    if (guardError === 'expired')    { fail('expired'); return; }

    // Reject foreign URL session parameters
    if (urlSession !== null && !urlSession.startsWith('cvtext_')) { fail('expired'); return; }

    // Scoring data may be absent when sessionStorage was cleared or on a fresh new-tab.
    // For new sessions: cv_key is an HttpOnly cookie sent automatically with credentials.
    // For old sessions: cv_key is in sessionStorage and sent as a query param fallback.
    if (!rawScoring) {
      // Cookie-first URL: new sessions use the HttpOnly cv_key cookie (no query param);
      // old sessions fall back to the query param for backward compatibility.
      const scoringUrl = cvKeyVal.startsWith('cvtext_')
        ? `${WORKER_URL}/get-scoring?key=${encodeURIComponent(cvKeyVal)}`
        : `${WORKER_URL}/get-scoring`;

      let cancelled = false;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      // Validate session via HttpOnly cv_key cookie first, then fetch scoring data.
      // /check-session returns {valid:true, type:'analysis'} for active analysis sessions.
      const validateAndFetch = () =>
        fetch(`${WORKER_URL}/check-session`, { credentials: 'include' })
          .then(async r => {
            if (cancelled) return null;
            const body = await r.json() as { valid?: boolean; authenticated?: boolean; reason?: string };
            if (!body?.valid && !body?.authenticated) {
              const reason = body?.reason;
              fail(reason === 'expired' ? 'expired' : 'missing');
              return null;
            }
            return fetch(scoringUrl, { credentials: 'include' });
          })
          .then(async r => {
            if (!r || cancelled) return;
            if (r.status === 404) {
              // Cookie exists but KV entry is gone — data not found.
              try {
                sessionStorage.removeItem('gaslamar_cv_key');
                sessionStorage.removeItem('gaslamar_analyze_time');
              } catch (_) {}
              fail('data_missing');
              return;
            }
            if (!r.ok) throw new Error(`server_${r.status}`);
            const body = await r.json() as { scoring?: ScoringData; valid?: boolean };
            if (!body?.scoring) throw new Error('no_scoring_field');
            const s = body.scoring;
            const skor = parseInt(String(s?.skor));
            if (isNaN(skor) || skor < 0 || skor > 100) { if (!cancelled) fail('missing'); return; }
            try { sessionStorage.setItem('gaslamar_scoring', JSON.stringify(s)); } catch (_) {}
            if (!cancelled) setState({ data: s ?? null, cvKey: cvKeyVal, analyzeTime, loading: false, error: null, noSession: null });
          });

      // One automatic retry after transient error — skip check-session on retry
      validateAndFetch().catch(() => {
        if (cancelled) return;
        retryTimer = setTimeout(() =>
          fetch(scoringUrl, { credentials: 'include' })
            .then(async r => {
              if (cancelled) return;
              if (!r.ok) { fail('missing'); return; }
              const body = await r.json() as { scoring?: ScoringData };
              if (!body?.scoring) { fail('missing'); return; }
              const s = body.scoring;
              try { sessionStorage.setItem('gaslamar_scoring', JSON.stringify(s)); } catch (_) {}
              if (!cancelled) setState({ data: s ?? null, cvKey: cvKeyVal, analyzeTime, loading: false, error: null, noSession: null });
            })
            .catch(() => { if (!cancelled) fail('missing'); }),
          1500,
        );
      });
      return () => { cancelled = true; if (retryTimer !== null) clearTimeout(retryTimer); };
    }

    let parsed: ScoringData;
    try { parsed = JSON.parse(rawScoring); } catch { fail('missing'); return; }

    const skor = parseInt(String(parsed?.skor));
    if (isNaN(skor) || skor < 0 || skor > 100) { fail('missing'); return; }

    // cv_key format check (legacy sessionStorage value — harmless if absent)
    if (cvKeyVal && !cvKeyVal.startsWith('cvtext_')) { fail('expired'); return; }

    // URL session must match storage
    if (urlSession && urlSession !== cvKeyVal) { fail('expired'); return; }

    // Persist 6D scores + summary data so Download page can access them after gaslamar_scoring is cleared
    if (parsed.skor_6d) {
      try { sessionStorage.setItem('gaslamar_6d_scores', JSON.stringify(parsed.skor_6d)); } catch (_) {}
    }
    if (typeof parsed.skor === 'number') {
      try { sessionStorage.setItem('gaslamar_skor', String(parsed.skor)); } catch (_) {}
    }
    if (typeof parsed.skor_sesudah === 'number') {
      try { sessionStorage.setItem('gaslamar_skor_sesudah', String(parsed.skor_sesudah)); } catch (_) {}
    }
    if (Array.isArray(parsed.gap) && parsed.gap.length > 0) {
      try { sessionStorage.setItem('gaslamar_gap', JSON.stringify((parsed.gap as string[]).slice(0, 5))); } catch (_) {}
    }

    // Clear CV text fragments no longer needed on this page
    ['gaslamar_cv_draft', 'gaslamar_sample_fallback'].forEach(k => {
      try { sessionStorage.removeItem(k); } catch (_) {}
    });

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

    setState({ data: parsed, cvKey: cvKeyVal, analyzeTime, loading: false, error: null, noSession: null });

    // Defense-in-depth: validate cv_key cookie via /check-session (fail-open on network error).
    // /check-session now validates both analysis (cv_key) and payment (sess_) sessions.
    fetch(`${WORKER_URL}/check-session`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((result: { valid?: boolean; authenticated?: boolean }) => {
        if (!result.valid && !result.authenticated) {
          try { sessionStorage.removeItem('gaslamar_cv_key'); } catch (_) {}
          setState(prev => ({ ...prev, data: null, loading: false, noSession: 'expired' }));
        }
      })
      .catch(() => {}); // network unavailable — fail open
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
