# Audit Fix Plan — 2026-05-25

## BLOCKER
- none

## HIGH
- [ ] H1: generate.js:319 — fix comment "60s KV TTL" → "120s KV TTL"
- [ ] H2: router.js — document (or handle) /api/webhook/mayar 404 gap
- [ ] H3: resendEmail.js — remove SESSION_STATES.PAID from PAID_STATUSES

## MEDIUM
- [ ] M1: CLAUDE.md — change analysis_v16_ → analysis_v17_
- [ ] M2: router.js:50 — remove dead /bypass-payment from API_METHODS
- [ ] M4: generate.js:249,274 — send CV-ready email unconditionally when session.email exists
- [ ] M5: generate.js — add KV fallback rate-limiter (5 req/min per IP) matching analyze.js pattern

## LOW
- [ ] L3: interviewKit.js:79 — log cache-read errors instead of swallowing
- [ ] L4: CLAUDE.md — fix truncation gotcha (threshold + strategy)
- [ ] L5: router.js:240-245 — add comment about gaslamar_delivery being client-side only

## SKIP (test-coverage gaps — deferred)
- M3: resend-email tests (401, 403, 400, 200, 404)
- generate.js multi-credit / rollback tests
- webhook ENVIRONMENT=undefined test
