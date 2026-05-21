# Fix: Mayar Callback Not Processed + Payment Flow Blocked

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
