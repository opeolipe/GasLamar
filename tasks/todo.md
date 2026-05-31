# Audit Fix Plan — 2026-05-25

## BLOCKER
- none

## HIGH
- [x] H1: generate.js:319 — fix comment "60s KV TTL" → "120s KV TTL" (lock TTL is 120s at line 189, comment at line 331 correct)
- [x] H2: router.js — document (or handle) /api/webhook/mayar 404 gap (lines 122-124 match both /webhook/mayar and /api/webhook/mayar)
- [x] H3: resendEmail.js — remove SESSION_STATES.PAID from PAID_STATUSES (removed; comment explains PAID has no cv_result_)

## MEDIUM
- [x] M1: CLAUDE.md — change analysis_v16_ → analysis_v17_ (already v17 throughout CLAUDE.md)
- [x] M2: router.js:50 — remove dead /bypass-payment from API_METHODS (already absent from API_METHODS map)
- [x] M4: generate.js:249,274 — send CV-ready email unconditionally when session.email exists (both exhausted and ready branches call sendCVReadyEmail)
- [x] M5: generate.js — add KV fallback rate-limiter (5 req/min per IP) matching analyze.js pattern (checkRateLimitKV at line 23)

## LOW
- [x] L3: interviewKit.js:79 — log cache-read errors instead of swallowing (logError at line 92)
- [x] L4: CLAUDE.md — fix truncation gotcha (threshold + strategy + corrected "no warning" claim)
- [x] L5: router.js:240-245 — add comment about gaslamar_delivery being client-side only (comment at line 270)

## SKIP (test-coverage gaps — deferred)
- M3: resend-email tests (401, 403, 400, 200, 404)
- generate.js multi-credit / rollback tests
- webhook ENVIRONMENT=undefined test

---

# /get-scoring atomic rate limit fix — 2026-05-31

## Problem
`getScoring.js` uses only `checkRateLimitKV` (non-atomic KV counter with TOCTOU race).
15 parallel requests can all read `count=0` before any write completes → limit bypass.
No CF native atomic binding for this endpoint. No rate-limit tests.

## Steps
- [ ] Add `RATE_LIMITER_GET_SCORING` CF native binding to wrangler.toml (namespace_id 1007, 10/min) — sandbox, staging, production
- [ ] Update `getScoring.js` — import `checkRateLimit`, call CF binding first (atomic burst guard)
- [ ] Add rate limiting tests to worker.test.js (new describe block, unique IP range 10.99.3.x)
- [ ] Run tests — all must pass
- [ ] Commit and push
