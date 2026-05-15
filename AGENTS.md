# GasLamar — Agent Instructions

GasLamar is an AI-powered CV tailoring web app for Indonesian job seekers. Users upload a CV (PDF/DOCX/TXT) and paste a job description; the backend scores the fit, explains gaps, and generates a tailored CV in Bahasa Indonesia and English for download.

**Live URL:** https://gaslamar.com  
**Worker URL (client-facing):** `https://gaslamar.com` (prod) / `https://api-staging.gaslamar.com` (staging) — routed via Cloudflare, configured in `js/config.js`  
**Worker URL (direct / health check):** `https://gaslamar-worker.carolineratuolivia.workers.dev`  
**Stack:** Cloudflare Workers + Cloudflare Pages + Anthropic Claude (`claude-sonnet-4-6` prod / `claude-haiku-4-5-20251001` staging + all tailoring) + Mayar (payment) + Cloudflare KV

---

## Repository Layout

```
/
├── index.html / upload.html / analyzing.html / hasil.html / download.html
├── access.html             # Session-expired / access-link page
├── exchange-token.html     # Handles email download-link token exchange
├── accessibility.html / privacy.html / terms.html / 404.html
├── css/                    # main.css (Tailwind + custom, generated)
├── js/
│   ├── config.js           # WORKER_URL — single place to change the API URL
│   ├── dist/               # Generated bundles — gitignored, run `npm run build:js`
│   └── vendor/             # Vendored docx.js + jsPDF — gitignored, run `npm run build:vendor`
├── worker/
│   ├── worker.js           # Entry point — thin CORS wrapper
│   └── src/
│       ├── router.js       # Route dispatch — add new endpoints here
│       ├── constants.js    # TIER_PRICES, TIER_CREDITS, VALID_TIERS, SESSION_TTL, PRODUCTION_ORIGINS, KV_CV_RESULT_PREFIX
│       ├── cacheVersions.js    # Cache-key version constants — bump here when prompt/scoring/tailor changes
│       ├── claude.js       # callClaude() — Anthropic API wrapper, 40s timeout
│       ├── sessions.js     # KV session CRUD
│       ├── cookies.js      # Cookie set/clear utilities for session management
│       ├── sanitize.js     # Input sanitization (XSS, control chars, Latin-1)
│       ├── interviewKitPdf.js # pdf-lib PDF generation for interview kit
│       ├── cvPdf.js            # Server-side PDF generation for CV email delivery
│       ├── sessionStates.js # Canonical session state machine — states, transitions, helper functions
│       ├── handlers/       # One file per API endpoint
│       ├── pipeline/       # extract.js, analyze.js, score.js, diagnose.js, validate.js, roleInference.js
│       └── prompts/        # LLM prompts: extract.js, analyze.js, diagnose.js, interviewKit.js, tailorId.js, tailorEn.js
├── scripts/                # build.js (esbuild), vendor.js (Tailwind + lib copy)
├── package.json            # Root — frontend build scripts
└── wrangler.toml           # Cloudflare Worker config + KV + rate limiter bindings
```

---

## Architecture — 6-Stage Deterministic Pipeline

`POST /analyze` is the core endpoint. LLM handles only extraction and text formatting; all scoring is deterministic JS.

```
POST /analyze
  │
  ├─ Stage 1: EXTRACT (LLM — claude-haiku-4-5)
  │    Verbatim copy of data from CV and JD into structured schema.
  │    Validated by validate.js; retried once on schema failure.
  │    Cached: extract_v5_<hash> — 24h TTL
  │
  ├─ Stage 2: ANALYZE (pure JS — pipeline/analyze.js)
  │    Skill matching, format detection, archetype detection, red flags.
  │
  ├─ Stage 2.5: ROLE INFERENCE (pure JS — pipeline/roleInference.js)
  │    Classifies role, seniority, industry from Stage 1+2 output.
  │    Feeds scoring weights (Stage 3), diagnose context (Stage 4), tailoring guidance (Stage 5).
  │
  ├─ Stage 3: SCORE (formula — pipeline/score.js)
  │    6-dimension scoring: north_star, recruiter_signal, effort,
  │    opportunity_cost, risk, portfolio.
  │    Outputs: total score, verdict (DO / TIMED / DO NOT), timebox_weeks.
  │    Cached: analysis_v15_<hash> — 48h TTL
  │
  ├─ Stage 4: DIAGNOSE (LLM — claude-haiku-4-5)
  │    Receives gap list + scores from Stages 2/3. Writes human-readable
  │    explanations ONLY — cannot change scores or add new gaps.
  │    Validated + retried on failure.
  │
  ├─ Stage 5: REWRITE (LLM — called from POST /generate)
  │    tailorCVID / tailorCVEN: rewrites CV to match JD in ID and EN.
  │    Cached: gen_id_v4_<hash> / gen_en_v4_<hash> — 48h TTL
  │
  └─ Stage 6: VALIDATE (code — pipeline/validate.js)
       Schema validation embedded after every LLM call.
       validateExtractOutput(), validateDiagnoseOutput().
```

**Cache key versioning:** Bump the version suffix (`v5_`, `v15_`, `v4_`, etc.) whenever a prompt or scoring formula changes significantly to avoid stale cache hits. Versions live in `cacheVersions.js` — imported by `analysis.js` and `tailoring.js`. Do not bump in those files.

**Session state machine** (defined in `sessionStates.js`):

| State | Meaning |
|---|---|
| `pending_payment` | Created, awaiting Mayar webhook (old sessions may carry `'pending'`) |
| `paid` | Payment confirmed, no generation started yet |
| `generating` | CV tailoring in progress (lock held) |
| `ready` | Generation succeeded; result stored; credits remain |
| `exhausted` | All credits consumed; session preserved (not deleted) for audit/recovery |

`/get-session` accepts `paid`, `ready`, or `generating` (retry). `/generate` transitions to `ready` (credits remain) or `exhausted` (last credit).

---

## API Routes

| Method | Path | File | Notes |
|---|---|---|---|
| GET | /health | inline in router.js | No auth, no rate limit |
| POST | /analyze | handlers/analyze.js | Rate: 3/min (native binding + KV fallback) |
| POST | /create-payment | handlers/createPayment.js | Rate: 5/min |
| POST | /webhook/mayar | handlers/mayarWebhook.js | HMAC-SHA256 verified |
| GET, POST | /session/ping (alias: /api/session/ping) | handlers/sessionPing.js | Keepalive |
| GET | /check-session | handlers/checkSession.js | |
| GET | /validate-session | handlers/validateSession.js | |
| GET | /get-scoring | handlers/getScoring.js | Returns scoring snapshot for a cvtext_ key; rate: 10/min |
| POST | /get-session | handlers/getSession.js | Requires `paid` or `ready` status |
| POST | /generate | handlers/generate.js | Rate: 5/min |
| POST | /get-result | handlers/getResult.js | |
| POST | /submit-email | handlers/submitEmail.js | |
| POST | /fetch-job-url | handlers/fetchJobUrl.js | Rate: 5/min |
| POST | /exchange-token | handlers/exchangeToken.js | Single-use email token → session cookie |
| POST | /resend-email | handlers/resendEmail.js | |
| POST | /resend-access | handlers/resendAccess.js | Rate: 10/min per IP |
| POST | /interview-kit (alias: /api/interview-kit) | handlers/interviewKit.js | |
| POST | /bypass-payment | handlers/bypassPayment.js | 404 in production — sandbox/E2E only |
| POST | /validate-coupon | handlers/validateCoupon.js | Rate: 10/min per IP |
| POST | /api/log | inline in router.js | Client error logging |
| POST | /feedback | inline in router.js | User survey, fire-and-forget |

---

## Dev Commands

```bash
# Worker tests (4 test files: worker.test.js, pipeline.test.js, sanitize.test.js, boundary.test.js)
cd worker && npm test            # vitest run — all tests must pass
cd worker && npm run test:watch  # watch mode
cd worker && npm run dev         # local dev via wrangler
cd worker && npm run tail        # stream live production logs

# Frontend build (from repo root)
npm run build          # all: CSP hash + vendor + JS bundles + React + bundle hash
npm run build:vendor   # docx.js, jsPDF, Tailwind CSS only
npm run build:js       # esbuild bundles only (js/dist/)
npm run build:react    # React build only (hasil page)
npm run build:csp      # update CSP hash in _headers after HTML changes
npm run build:hash     # update bundle hashes in HTML after JS build
npm run check:cache    # verify cache version strings are consistent
npm run dev            # watch mode for JS bundles
```

**CI pipeline (on push to main):**
1. `cd worker && npm test`
2. `wrangler deploy --env production`
3. `npm run vendor` (builds js/vendor/)
4. Cloudflare Pages deploy

---

## Key Conventions

**Worker (Cloudflare Workers ES modules):**
- Pure JavaScript, no TypeScript.
- All LLM responses are schema-validated in `pipeline/validate.js` and retried once on failure.
- Session IDs: `sess_<crypto.randomUUID()>`. CV text keys are IP-bound.
- Rate limiting: Cloudflare native bindings (atomic, no TOCTOU) + KV counter fallback. Both must allow a request.
- `ENVIRONMENT=sandbox` by default; production deploys use `--env production`.
- Never run `wrangler deploy` without `--env production` for production.
- New scoring/verdict logic must stay in pure JS (pipeline/analyze.js or pipeline/score.js) — not in LLM prompts.

**Frontend (vanilla JS + React for hasil page):**
- `js/config.js` is the single source of truth for `WORKER_URL`.
- `js/dist/` and `js/vendor/` are gitignored — always build before testing.
- `js/hasil-guard.js` is NOT bundled — it must run as a synchronous `<script>` mid-body to prevent flash of unauthenticated content.
- All other page scripts use `defer`.

---

## Security Invariants

Do not break these:
- Webhook HMAC-SHA256 verification (Mayar) in `mayarWebhook.js`
- CORS: `gaslamar.com`, `www.gaslamar.com`, and `gaslamar.pages.dev` (Pages canonical) — defined in `constants.js` `PRODUCTION_ORIGINS`
- Server-side file validation: magic bytes (PDF: `%PDF`, DOCX: `PK`) + 5MB limit
- `cv_text_key` is IP-bound — reject if request IP doesn't match
- `/get-session` rejects sessions without `paid` status
- Session lock (`lock_<session_id>`, TTL 120s) prevents double-generation races
- Sessions transition to `exhausted` state after last credit — never deleted by `generate.js`
- `bypassPayment.js` must return 404 in production — `ENVIRONMENT === 'production'` guard must never be removed
- Webhook idempotency sentinel `payment_processed_<session_id>` (48h TTL) written BEFORE session update

---

## Pricing Tiers

Defined in `worker/src/constants.js`:

| Tier | Price (IDR) | Credits | Languages |
|---|---|---|---|
| Coba Dulu | 29,000 | 1 | Bahasa Indonesia only |
| Single | 59,000 | 1 | ID + EN |
| 3-Pack | 149,000 | 3 | ID + EN |
| Job Hunt Pack | 299,000 | 10 | ID + EN |

---

## Environments & Secrets

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API |
| `MAYAR_API_KEY` | Mayar production |
| `MAYAR_API_KEY_SANDBOX` | Mayar sandbox |
| `MAYAR_WEBHOOK_SECRET` | Webhook HMAC verification |
| `RESEND_API_KEY` | Email confirmations (optional) |

`ENVIRONMENT=sandbox` → uses Mayar sandbox keys.  
`ENVIRONMENT=production` → set via `[env.production.vars]` in wrangler.toml, active only with `--env production`.
