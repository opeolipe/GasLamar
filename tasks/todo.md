# Fix: Payment Session Expiry During Redirect to Mayar

## Root Cause
Two compounding issues cause "session expired" error when user returns from Mayar:

1. **Frontend** (`payment.js` line 424): Explicitly removes `gaslamar_cv_key` from
   sessionStorage after payment initiation. When user returns to `/hasil`,
   `hasil-guard.js` can't find the key → redirects to `upload.html?reason=no_session`.

2. **Backend** (`createPayment.js` line 139): Deletes the `cvtext_` KV entry after
   creating the Mayar invoice. Even if guard passes (Fix 1 applied), `scoring.js`
   calls `GET /get-scoring` which reads the deleted KV entry → 404 → redirects to
   `access.html?expired=1&source=hasil`.

## Fix Plan

- [x] **createPayment.js**: Before deleting `cvtext_`, preserve scoring snapshot
  under `scoring_<token>` with 24h TTL (same as original cvtext_ window).
  Non-critical write — errors are logged but don't abort payment creation.

- [x] **getScoring.js**: After failing to find `cvtext_<token>`, fall back to
  `scoring_<token>` key. Returns same `{ valid: true, scoring }` response.
  Security: still returns only scoring, never cv_text/job_desc/ip.

- [x] **payment.js**: Remove `sessionStorage.removeItem('gaslamar_cv_key')`.
  Keep the key so hasil-guard.js passes when user returns from Mayar.
  The actual KV entry is already deleted server-side; the sessionStorage key
  just lets the guard pass.

- [x] **worker.test.js**: Add tests for scoring snapshot preservation and
  getScoring fallback behavior.

- [x] **tasks/lessons.md**: Document pattern.

## Invariants to Preserve
- No raw CV text or job_desc ever returned by /get-scoring
- Payment creation still deletes cvtext_ (prevents re-use)
- Scoring snapshot write failure does NOT abort payment
- All existing tests still pass
