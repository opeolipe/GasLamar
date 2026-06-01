# Fix: router reads wrong cv_key cookie name

## Root Cause
`router.js` `getProtectedPageState` calls `getCvTextKeyFromCookie` (reads `cv_text_key`),
but `analyze.js` now sets `cv_key` via `makeCvKeyCookie`. Name mismatch means
`analysisActive` is always false in production → `/hasil.html` redirects to
`upload.html?reason=no_session` even for valid fresh sessions.

## Changes

- [x] `worker/src/router.js` — import `getCvKeyFromCookie`; check `cv_key` first,
      fall back to `cv_text_key` for backward compat
- [ ] `worker/test/worker.test.js` — update 4 router tests that send `cv_text_key`
      cookie to send `cv_key` (matching what analyze.js actually sets); add a backward-
      compat test that still accepts `cv_text_key`
- [ ] Run `npm test` — all tests pass

## Verification
After fix: test sending `cv_key` cookie → hasil.html proxied (200)
After fix: test sending `cv_text_key` cookie → hasil.html still proxied (backward compat)
After fix: no cookie → upload.html redirect (no_session)
