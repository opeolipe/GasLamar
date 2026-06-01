# Fix: router reads wrong cv_key cookie name

## Root Cause
`router.js` `getProtectedPageState` calls `getCvTextKeyFromCookie` (reads `cv_text_key`),
but `analyze.js` now sets `cv_key` via `makeCvKeyCookie`. Name mismatch means
`analysisActive` is always false in production → `/hasil.html` redirects to
`upload.html?reason=no_session` even for valid fresh sessions.

## Changes

- [x] `worker/src/router.js` — import `getCvKeyFromCookie`; check `cv_key` first,
      fall back to `cv_text_key` for backward compat
- [x] `worker/test/worker.test.js` — updated router tests now send `cv_key` cookie;
      backward-compat test at line 442 still accepts `cv_text_key`. Verified with grep:
      no remaining `cv_text_key` cookie sends in router test block except the compat test.
- [x] Run `npm test` — all 589 tests pass

## Verification
After fix: test sending `cv_key` cookie → hasil.html proxied (200)
After fix: test sending `cv_text_key` cookie → hasil.html still proxied (backward compat)
After fix: no cookie → upload.html redirect (no_session)
