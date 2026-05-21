# PR #416 Review — Fix List
> Audit date: 2026-05-21 | Branch: security/token-abuse-tests → staging

---

## BLOCKER — Must fix before merging

- [ ] **Restore Unicode bypass protection in `worker/src/sanitize.js`**
  Removed: `UNICODE_FORMAT_RE` stripping + `.normalize('NFKC')` before `hasPromptInjection()`.
  An attacker can insert zero-width chars (U+200B, U+00AD, bidi overrides) inside trigger
  words (e.g. "ig​nore previous instructions") to bypass the prompt injection filter.
  Fix: restore the `UNICODE_FORMAT_RE` constant and the `normalized = sample.replace(...).normalize('NFKC')` line.

- [ ] **Restore the 7 Unicode bypass tests in `worker/test/sanitize.test.js`**
  The tests were deleted alongside the protection they covered. Bring them back.
  They live in the `// ── Unicode bypass guards (M3: strip format chars + NFKC)` section.

---

## HIGH — Fix before merging (functional regressions)

- [ ] **Restore scoring snapshot in `worker/src/handlers/createPayment.js`**
  The `scoring_${token}` KV write was removed. After payment, if the user navigates back
  to hasil.html (cancel / back-button from Mayar), `/get-scoring` returns 404 because
  `cvtext_` was deleted and no snapshot fallback exists.
  Fix: restore the `if (stored.scoring) { await env.GASLAMAR_SESSIONS.put('scoring_...') }`
  block and the corresponding fallback in `worker/src/handlers/getScoring.js`.

- [ ] **Restore same scoring snapshot in `worker/src/handlers/bypassPayment.js`**
  Same issue — sandbox/E2E flow also lost the snapshot write.

- [ ] **Decide on `ANALYSIS_CACHE_VERSION` rollback (`worker/src/cacheVersions.js`)**
  Changed from `v17` → `v16`. If accidental, revert to `v17`.
  If intentional (e.g. v17 formula was wrong), document why and confirm no stale v16
  entries exist in KV that could serve incorrect scores.

---

## MEDIUM — Fix or explicitly accept before merging

- [ ] **Fix rate limit for `/get-session` (`worker/src/handlers/getSession.js`)**
  Rate limiter removed. The original code was broken (wrong call signature:
  `rateLimitResponse(rl.retryAfter)` instead of `rateLimitResponse(request, env, retryAfter)`).
  Fix properly: `if (!rl.allowed) return rateLimitResponse(request, env, rl.retryAfter ?? 60);`

- [ ] **Restore CF burst guard for `/resend-access` (`worker/src/handlers/resendAccess.js`)**
  `RATE_LIMITER_RESEND_ACCESS` CF-native binding removed, leaving only KV rate limiting.
  KV requires a round-trip per request; the CF edge limiter was faster under burst attacks.
  Either restore it as the first check (before any KV reads) or document the removal.

- [ ] **Verify `/api/log` sendBeacon compatibility (`worker/src/router.js`)**
  `text/plain` content-type support removed. `sendBeacon` sends `text/plain`.
  Check if any frontend path still uses `sendBeacon` for error reporting;
  if yes, restore `|| contentType.includes('text/plain')` in the content-type check.

- [ ] **Time-box the `checkSession.js` fallback path**
  `?session=` query-param fallback re-introduces session IDs in URLs (browser history,
  access logs, Referer headers). "Backward compat during rollout" — add a tracking issue
  or config flag so it gets removed once rollout is confirmed complete.

---

## LOW — Nice to have

- [ ] **Add rate limit test for `/exchange-token` burst**
  Handler reuses `RATE_LIMITER_PAYMENT` (5/min) but no test covers it.

- [ ] **Restore `capped` log field in `resendAccess.js`**
  `capped: activeIds.length > 3` removed from `resend_access_sent` log event.
  Useful for ops visibility when a user has many active sessions.

- [ ] **Add comment to `generate.js` explaining TOCTOU tradeoff**
  Nonce re-read pattern removed. Briefly document why the simpler lock is acceptable
  (Worker 30s wall clock, session state machine as secondary protection).

---

## Summary

| Priority | Count |
|---|---|
| BLOCKER | 2 — Unicode protection + tests |
| HIGH | 3 — Scoring snapshot ×2, cache version |
| MEDIUM | 4 — get-session rate limit, CF burst guard, sendBeacon, fallback TTL |
| LOW | 3 — exchange-token test, log field, TOCTOU comment |

**Do not merge until BLOCKERs and HIGH items are resolved.**

---

# Email Attachment Fix — 2026-05-18 — DONE ✓

## Root Cause Analysis

Two independent bugs block the payment and callback flow:

### Bug A — Frontend session TTL mismatch (2 h frontend vs 24 h backend)
`analyze.js` stores the `cvtext_` KV entry with a **24-hour** TTL. But every frontend
freshness check uses **2 hours**. After 2 h the pay button is disabled and the user is
redirected to `access.html` even though the backend key is still valid for 22 more hours.

Affected constants:
- `js/hasil-guard.js` — `SESSION_SECS = 7200`
- `js/hasil-page.js` — `SESSION_SECS = 7200`
- `js/analyzing-page.js` — `< 7200000`
- `js/session-controller.js` — `ANALYSIS_FRESHNESS_MS = 7200000`

### Bug B — Webhook verification rejects valid Mayar sandbox callbacks
When staging has `MAYAR_WEBHOOK_SECRET` configured **and** Mayar sandbox sends its
webhook with **no auth header** (neither `x-callback-token` nor `x-mayar-signature`),
the code falls through to the HMAC check which returns `{ valid: false }` → **401**.

Flow in `mayar.js → verifyMayarWebhook`:
1. `isSandbox = true`, secret is set → skips the `!secret` early return
2. Checks `x-callback-token` → absent → does NOT return
3. Falls through to HMAC check — looks for `x-mayar-signature`
4. No signature → returns `{ valid: false }` → 401

The fix: when in sandbox mode with a secret set, if neither auth header is present
(not a wrong signature — just *absent*), allow through with a warning. An absent header
means Mayar sandbox sent nothing to verify; a wrong value is still rejected.

## Tasks

- [x] Investigate codebase and reproduce both bugs
- [x] Fix A1: `js/hasil-guard.js` — update SESSION_SECS 7200→86400
- [x] Fix A2: `js/hasil-page.js` — update SESSION_SECS 7200→86400, fix comment
- [x] Fix A3: `js/analyzing-page.js` — update 7200000→86400000, update SYNC comment
- [x] Fix A4: `js/session-controller.js` — update ANALYSIS_FRESHNESS_MS 7200000→86400000
- [x] Fix B: `worker/src/mayar.js` — sandbox webhook: allow when no auth header present
- [x] Add test: `verifyMayarWebhook` sandbox+secret+no-headers → valid:true
- [x] Run `cd worker && npm test` — all 533 tests pass
- [ ] Commit and push to `claude/fix-mayar-callback-0NsG7`
- [ ] Append learnings to `tasks/lessons.md`
