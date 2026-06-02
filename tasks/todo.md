# Fix: /hasil.html redirect loop + conflicting session messages

## Root causes identified

1. **Cookie reliability (production)**: `cv_key` uses `SameSite=None; Partitioned` (CHIPS). In production
   (same-site, gaslamar.com) the `Partitioned` attribute should be a no-op per the CHIPS spec, but some
   browser versions mishandle it and may not send the cookie on navigation. Changing to `SameSite=Strict`
   (no `Partitioned`) in production eliminates the ambiguity. Staging remains `SameSite=None; Partitioned`
   because the frontend (staging.gaslamar.pages.dev) is cross-site from the worker (api-staging.gaslamar.com).

2. **Conflicting UI messages (confirmed bug)**: When the server redirects to `/upload.html?reason=no_session`,
   `Upload.tsx` adds an "Sesi tidak ditemukan" info notice AND also checks `gaslamar_analyze_time` in
   sessionStorage and — if still valid — adds a second info notice with a "Lihat hasil →" link.
   `prioritizeNotices()` shows both (primary + secondary when both are `info`). This creates a loop:
   user clicks "Lihat hasil" → server redirect → back on upload with same contradiction.

3. **Single-message guarantee**: Result.tsx already shows only one `noSession` state inline. No change
   needed there, but verify no double-render can occur.

## Plan

- [x] `worker/src/cookies.js` — `makeCvKeyCookie(cvKey, env)`: production → SameSite=Strict (no Partitioned);
  staging/sandbox → SameSite=None; Partitioned (unchanged)
- [x] `worker/src/handlers/analyze.js` — pass `env` to `makeCvKeyCookie`
- [x] `pages/Upload.tsx` — when `reason=no_session`: clear `gaslamar_analyze_time` from sessionStorage AND
  skip adding "Lihat hasil" notice (only show the no-session error, never both)
- [x] `worker/src/router.js` — verify/strengthen: cookie present + expired → access.html (not upload);
  no cookie → upload; this logic is already correct but add inline comments for clarity
- [x] `worker/test/worker.test.js` — update cookie format assertion for production env;
  add test: cv_key cookie present + expired KV → access.html (not upload)
- [x] `tasks/lessons.md` — record pattern

## Previously completed (prior PR)

- [x] `worker/src/handlers/checkSession.js` — validate cv_key cookie
- [x] `js/hasil-guard.js` — URL-param validation only
- [x] `hasil.html` — rebuild inline guard
- [x] `hooks/useResultData.ts` — always fetch /get-scoring via cookie
- [x] `hooks/useAnalysisPolling.ts` — remove sensitive data from sessionStorage
- [x] `pages/Analyzing.tsx` — remove gaslamar_cv_key from freshness check
- [x] `js/analyzing-page.js` — same cleanup
- [x] `worker/test/worker.test.js` — add tests for cv_key path in /check-session
