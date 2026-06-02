# Fix: session not persisted across page navigation to /hasil + remove sensitive data from sessionStorage

## Root cause
`hasil-guard.js` blocked page load by checking `gaslamar_analyze_time` in sessionStorage.
SessionStorage can be absent/cleared (privacy settings, new tab, iOS Safari ITP, or upstream page
clearing it on upload page load). The fix moves session validation to the HttpOnly `cv_key` cookie.

Staging also removed scoring JSON, result_id, raw CV text, and extracted claims from sessionStorage —
these data now live server-side only, retrieved via HttpOnly cookie-authenticated API calls.

## Files changed

- [x] `worker/src/handlers/checkSession.js` — validate cv_key cookie; return `{valid:true, authenticated:true, type:'analysis'}` when analysis session is active
- [x] `js/hasil-guard.js` — remove sessionStorage check; URL-param validation only; sets `__hasilSessionError` for inline errors
- [x] `hasil.html` — rebuild minified inline guard to match
- [x] `hooks/useResultData.ts` — always fetch /get-scoring via cookie (no sessionStorage fast path); /check-session for defense-in-depth
- [x] `hooks/useAnalysisPolling.ts` — remove setItem for scoring, result_id, candidate_name, entitas_klaim, sample_*, preview_after
- [x] `pages/Analyzing.tsx` — remove gaslamar_cv_key from freshness check; keep analyze_time
- [x] `js/analyzing-page.js` — same cleanup
- [x] `worker/test/worker.test.js` — add tests for cv_key path in /check-session
