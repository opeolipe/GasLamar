# Security: Remove Sensitive Data from sessionStorage

## Status: IN PROGRESS

## Findings
- Auth tokens (`__Host-cv_key`, `sessionToken`, `__Host-session_id`) are already HttpOnly cookies — not in sessionStorage.
- `gaslamar_session` and `gaslamar_result_id` are not written anywhere in active code.
- Legacy JS files (`scoring.js`, `payment.js`, etc.) are NOT loaded by any HTML page (only React bundles are active).

## Actual items to fix
- [ ] `gaslamar_user_id` — written by `js/analytics.js` as anonymous analytics ID; change to in-memory only
- [ ] `gaslamar_skor` — written by `hooks/useResultData.ts`; remove write and update consumers
- [ ] `gaslamar_pending_invoice` — written by `pages/Result.tsx` for payment resumption UX; remove and accept re-create on return
- [ ] Security test — add the 6 forbidden keys to `tests/e2e/security-invariants.spec.ts`

## Steps
- [x] Audit codebase (done)
- [ ] Fix `js/analytics.js`: use in-memory ID only
- [ ] Fix `hooks/useResultData.ts`: remove `sessionStorage.setItem('gaslamar_skor', ...)`
- [ ] Fix `hooks/useGenerateCV.ts`: remove read of `gaslamar_skor` from sessionStorage (remove `score` from /generate body)
- [ ] Fix `pages/Result.tsx`: remove `gaslamar_pending_invoice` write and resume-invoice UX block
- [ ] Update `tests/e2e/security-invariants.spec.ts`: add forbidden keys
- [ ] Run `cd worker && npm test` to verify worker tests pass
- [ ] Run frontend typecheck to verify no type errors
