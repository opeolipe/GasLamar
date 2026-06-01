# QA Test Plan: CORS Security Headers

## Scope

This plan covers two distinct surfaces with different expected CORS behaviour. They must **never** be conflated.

---

## Surface 1 — API Endpoints (authenticated)

**Test via:** `https://gaslamar.com` (prod) or `https://gaslamar-worker-staging.carolineratuolivia.workers.dev` (staging)  
**Do NOT test via:** `gaslamar.pages.dev`, `*.workers.dev` direct URLs, or any URL not in the canonical user flow.

### Endpoints in scope
`/health`, `/analyze`, `/get-scoring`, `/generate`, `/get-session`, `/validate-coupon`, `/resend-access`, `/interview-kit`, `/fetch-job-url`

### Expected headers

| Header | Expected value |
|---|---|
| `Access-Control-Allow-Origin` | Echo of the request's `Origin` if it is in the allowlist — never `*` |
| `Access-Control-Allow-Credentials` | `true` |
| `Vary` | Must include `Origin` |

### Test assertions

**TC-CORS-1:** Request with allowlisted `Origin: https://gaslamar.com`
- `Access-Control-Allow-Origin` = `https://gaslamar.com` ✓

**TC-CORS-2:** Request with staging origin `Origin: https://staging.gaslamar.pages.dev` (staging worker only)
- `Access-Control-Allow-Origin` = `https://staging.gaslamar.pages.dev` ✓

**TC-CORS-3:** Request with unknown `Origin: https://evil.example.com`
- No `Access-Control-Allow-Origin` header present ✓

**TC-CORS-4:** Any request — wildcard check
- `Access-Control-Allow-Origin` must never equal `*` ✓

**TC-CORS-5:** `Access-Control-Allow-Credentials` must be `true` when `Allow-Origin` is present ✓

---

## Surface 2 — Static Assets (public, no auth)

**Test via:** `https://gaslamar.com/` (prod) — the worker-proxied path only.

### Expected headers

| Header | Expected value |
|---|---|
| `Access-Control-Allow-Origin` | **Absent** — the worker strips it |

### Test assertions

**TC-STATIC-1:** `GET https://gaslamar.com/` with any `Origin`
- No `Access-Control-Allow-Origin` header ✓

---

## Out of Scope

`staging.gaslamar.pages.dev` and `gaslamar.pages.dev` are **internal Cloudflare Pages deployment surfaces**, not the production or staging path. Cloudflare Pages serves static assets with `Access-Control-Allow-Origin: *` by default — this is platform behaviour outside GasLamar's control and is not a security concern because:

1. Static assets contain no credentials, session tokens, or user data.
2. The worker strips this header on the public-facing domains.
3. No browser will send cookies or `Authorization` headers to a cross-origin request that returns `*` — the Fetch spec forbids `credentials: 'include'` with a wildcard response.

Any finding observed on `*.pages.dev` or `*.workers.dev` direct URLs must be re-tested on the canonical domain before being filed.

---

## Automated CI Verification

Both `deploy.yml` and `deploy-staging.yml` now run a `CORS security header check` step after every deploy. This step executes TC-CORS-1 through TC-CORS-4 and fails the pipeline if any assertion breaks. CI run logs serve as the audit trail for CORS compliance.

---

## Finding Closure: Medium #3 — CORS Allows `*` on Frontend

**Status:** CLOSED — Non-Finding (INFO)

**Root cause:** QA tested `staging.gaslamar.pages.dev` directly. Cloudflare Pages serves all static assets with `Access-Control-Allow-Origin: *` by default. This is the Pages platform's behaviour, not a GasLamar misconfiguration.

**Why this is not a vulnerability:**
- The `*` header appears only on static HTML/CSS/JS assets with no credentials or session data.
- The worker at `api-staging.gaslamar.com` strips this header on all public-facing responses (see `router.js:349`).
- No authenticated API endpoint (`/analyze`, `/get-session`, etc.) ever returns `*`. The API uses an origin allowlist and returns `Access-Control-Allow-Origin: <specific-origin>` only for requests from `STAGING_ORIGINS` or `PRODUCTION_ORIGINS`.
- A browser cannot send cookies or `Authorization` headers to an endpoint that returns `Access-Control-Allow-Origin: *` — the Fetch spec makes this a hard error. There is no credential-leakage vector.

**Evidence:** `CORS security header check` step in CI (added in this fix). On every deploy to `staging` and `main`, the check asserts the worker never returns `*` and correctly echoes the allowlisted origin with `Access-Control-Allow-Credentials: true`.

**Action taken:** No code change required. CI regression gates added. QA test plan updated to exclude `*.pages.dev` from CORS security scope.
