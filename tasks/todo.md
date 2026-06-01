# Fix: session not persisted across page navigation to /hasil

## Root cause
`hasil-guard.js` blocks page load by checking `gaslamar_analyze_time` in sessionStorage.
SessionStorage can be absent/cleared (privacy settings, new tab, iOS Safari ITP, or upstream page
clearing it on upload page load). The fix moves session validation to the HttpOnly `cv_key` cookie.

## Changes

- [x] `worker/src/handlers/checkSession.js` — validate cv_key cookie; return `{valid:true, authenticated:true, type:'analysis'}` when analysis session is active
- [x] `js/hasil-guard.js` — remove sessionStorage check; URL-param validation only
- [x] `hasil.html` — rebuild minified inline guard to match
- [x] `hooks/useResultData.ts` — remove `gaslamar_analyze_time` dependency; call /check-session for primary auth on fast path
- [x] `hooks/useAnalysisPolling.ts` — remove `sessionStorage.setItem('gaslamar_analyze_time', ...)`
- [x] `pages/Analyzing.tsx` — update refresh-redirect logic (no longer reads cv_key/analyze_time from sessionStorage)
- [x] `js/analyzing-page.js` — same cleanup
- [x] `worker/test/worker.test.js` — add tests for cv_key path in /check-session
