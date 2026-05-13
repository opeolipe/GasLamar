# GasLamar Operations Runbook (Remediation Gates)

## 1) Health Endpoints
- Production health source: `https://gaslamar.com/health`
- Staging health source: `https://api-staging.gaslamar.com/health`
- Do not use `workers.dev` health URL as production source-of-truth.

## 2) `/check-session` Fallback Monitoring (2-Week Window)
Track daily:
- `fallback_sessions / total_check_session_calls`
- Fallback success/failure rates: `200/401/403/404`
- Browser distribution: Safari vs Chromium vs Firefox
- Abuse indicators: repeated invalid `sess_` attempts, fallback rate-limit hits

Decision rule:
- If fallback usage is `<1%` for 14 consecutive days with no significant Safari recovery failures, evaluate stricter fallback gating.
- If usage remains material or failures increase, keep current fallback and continue hardening.

## 3) Tiered Verification Gates
Run after each severity tier (Critical/High, then Medium/Low):

Gate A (automated + flow):
- `cd worker && npm test`
- `npm run build`
- Endpoint checks: `/analyze`, `/create-payment`, `/check-session`, `/generate`, `/exchange-token`, `/get-result`, `/webhook/mayar`, `/fetch-job-url`, `/health`
- Core journey checks: upload → analyze → payment → download/generate

Gate B (mini double audit):
- Persona 1 (code/config): re-audit security/privacy/config drift
- Persona 2 (live/runtime): re-audit CORS, session behavior, webhook behavior, health, mobile snapshots

## 4) Rollback Procedure (Any Critical Regression)
1. Revert the phase commit(s).
2. Redeploy previous stable worker/frontend.
3. Re-run smoke checks:
   - `GET /health`
   - payment create flow
   - `GET /check-session`
   - `POST /generate`
4. Publish an incident note:
   - trigger
   - impact
   - root cause
   - blocked change ID
   - corrective action before retry

## 5) Canonical / Robots Checklist
- All public pages must use production canonical URLs (`https://gaslamar.com/...`).
- No staging URLs in canonical tags.
- Staging environment must stay non-indexed (via `robots` meta and staging robots policy).
