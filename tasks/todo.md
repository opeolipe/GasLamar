# Security: Remove Sensitive Data from sessionStorage

## Status: COMPLETE

## Findings
- Auth tokens (`__Host-cv_key`, `sessionToken`, `__Host-session_id`) are already HttpOnly cookies — not in sessionStorage.
- `gaslamar_session` and `gaslamar_result_id` are not written anywhere in active code.
- Legacy JS files (`scoring.js`, `payment.js`, etc.) are NOT loaded by any HTML page (only React bundles are active).

## Actual items fixed
- [x] `gaslamar_user_id` — `js/analytics.js` uses in-memory `window.__gaslamarEphemeralUserId` only; no storage write.
- [x] `gaslamar_skor` — `hooks/useResultData.ts` does NOT write `gaslamar_skor`; `scoring.js` writes it but that file is not loaded by any HTML page (dead code). `useGenerateCV.ts` only removes it on cleanup.
- [x] `gaslamar_pending_invoice` — not written anywhere in `pages/Result.tsx` or any active code.
- [x] Security test — `tests/e2e/security-invariants.spec.ts` exists with all forbidden keys including `gaslamar_session`, `gaslamar_user_id`, `gaslamar_skor`, `gaslamar_pending_invoice`, `gaslamar_result_id`, `gaslamar_cv_key`, `server_session_id`.

## Cookie security model (verified)
- `/analyze` sets TWO HttpOnly cookies:
  - `__Host-cv_key` — SameSite=Strict, HttpOnly, Secure, Path=/ (production same-site)
  - `sessionToken` — SameSite=None; Partitioned, HttpOnly, Secure (cross-origin staging)
- `/create-payment` sets `__Host-session_id` — SameSite=Strict, HttpOnly, Secure
- All API calls use `credentials: 'include'`
- `/get-scoring` returns 401 without a valid sessionToken or cv_key cookie
- `/check-session` validates via cookies only (no query param fallback)

## Steps completed
- [x] Audit codebase
- [x] `js/analytics.js` uses in-memory ID only
- [x] `hooks/useResultData.ts` does not write `gaslamar_skor` (the write is in dead `scoring.js`)
- [x] `hooks/useGenerateCV.ts` does not read `gaslamar_skor`; only removes it on cleanup
- [x] `pages/Result.tsx` has no `gaslamar_pending_invoice` write
- [x] `tests/e2e/security-invariants.spec.ts` covers all 6 forbidden keys
- [x] 622 worker tests passing (`cd worker && npm test`)
- [x] Frontend analysis passes (`hooks/useResultData.ts` uses `credentials: 'include'` via WORKER_URL fetches)

## Remaining non-security sessionStorage keys (acceptable)
- `gaslamar_tier` — pricing tier string ('single', 'coba', etc.); not a credential; needed for tier pre-selection UX before payment session exists
- `gaslamar_cv_pending` — user's own CV text, held temporarily for upload→analyzing page transition; cleared after analysis
- `gaslamar_6d_scores`, `gaslamar_skor_sesudah`, `gaslamar_gap` — display values for download page score badge; not credentials
- `gaslamar_score_displayed_at`, `gaslamar_analyze_time` — timing values for UX countdown; not credentials
