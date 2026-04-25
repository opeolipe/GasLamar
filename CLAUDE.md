# GasLamar — Claude Code Instructions

## Project Overview

GasLamar is an AI-powered CV tailoring web app for Indonesian job seekers. Users upload a CV (PDF/DOCX/TXT) and paste a job description; the app scores the CV fit, explains the gaps, and generates a tailored CV in Bahasa Indonesia and English.

**Stack:** Cloudflare Workers (API) + Cloudflare Pages (frontend, vanilla JS + React for results page) + Anthropic Claude (claude-haiku-3-5) + Mayar (Indonesian payment gateway) + Cloudflare KV (sessions/cache)

**Key pages:** `index.html` → `upload.html` → `analyzing.html` → `hasil.html` → `download.html`

## Architecture — 6-Stage Pipeline

`POST /analyze` runs a deterministic pipeline. LLM is used only for extraction and text explanation; all scoring is pure JS.

1. **EXTRACT** (LLM — claude-haiku) — verbatim copy of CV + JD data
2. **ANALYZE** (pure JS) — skill matching, format detection, archetype detection
3. **SCORE** (formula) — 6-dimension scoring, verdict (DO/TIMED/DO NOT), timebox
4. **DIAGNOSE** (LLM — claude-haiku) — human-readable explanation of gaps (cannot change scores)
5. **REWRITE** (LLM — called from `/generate`) — tailored CV in ID + EN
6. **VALIDATE** (code) — schema validation + retry after each LLM call

**Caching:** `extract_v1_<hash>` (24h TTL), `analysis_v4_<hash>` (48h TTL), `gen_id_<hash>` / `gen_en_<hash>` (48h TTL). Bump cache key version when changing prompts or scoring formulas.

## Key Files

| File | Purpose |
|---|---|
| `worker/src/router.js` | All API routes — add new endpoints here |
| `worker/src/handlers/` | One file per endpoint |
| `worker/src/pipeline/` | `extract.js`, `analyze.js`, `score.js`, `diagnose.js`, `validate.js` |
| `worker/src/prompts/` | LLM prompts — `extract.js`, `diagnose.js`, `tailorId.js`, `tailorEn.js` |
| `worker/src/constants.js` | `ALLOWED_ORIGINS`, `TIER_PRICES`, `SESSION_TTL`, tier config |
| `worker/src/sessions.js` | KV session CRUD |
| `worker/src/claude.js` | `callClaude()` wrapper — timeout 40s |
| `js/config.js` | `WORKER_URL` — **single place** to update the worker URL |
| `js/dist/` | Generated bundles — **gitignored**, must run `npm run build` |
| `js/vendor/` | Vendored docx.js + jsPDF — **gitignored**, must run `npm run build:vendor` |
| `css/main.css` | Merged Tailwind + custom styles (generated) |

## Dev Commands

```bash
# Worker
cd worker && npm test           # Run vitest (83 tests, 74 passing, 9 skipped)
cd worker && npm run dev        # Local dev with wrangler
cd worker && npm run tail       # Stream production logs

# Frontend (run from repo root)
npm run build                   # Build vendor libs + JS bundles + Tailwind CSS
npm run build:vendor            # Vendor only (docx.js, jsPDF, Tailwind)
npm run build:js                # JS bundles only (esbuild, per-page)
npm run dev                     # Watch mode — rebuild on change
```

**Important:** `js/hasil-guard.js` is NOT bundled — it runs as a synchronous inline `<script>` to prevent flash of unauthenticated content. All other page scripts use `defer`.

## Coding Conventions

- Worker is pure ES modules (no TypeScript). Frontend is vanilla JS + React (hasil page only).
- All LLM responses are schema-validated by `pipeline/validate.js` and retried once on failure.
- Session IDs are `sess_<crypto.randomUUID()>`. CV text keys are bound to requesting IP.
- Never add new LLM calls that produce scoring or verdict decisions — keep those in pure JS.
- Rate limiting uses Cloudflare native bindings (atomic) + KV fallback. Both must allow.
- Do not run `wrangler deploy` without `--env production` for production deploys.

## API Routes

| Method | Path | Handler |
|---|---|---|
| `GET` | `/health` | inline — no auth |
| `POST` | `/analyze` | `handlers/analyze.js` |
| `POST` | `/create-payment` | `handlers/createPayment.js` |
| `POST` | `/webhook/mayar` | `handlers/mayarWebhook.js` |
| `POST` | `/session/ping` | `handlers/sessionPing.js` |
| `GET` | `/check-session` | `handlers/checkSession.js` |
| `GET` | `/validate-session` | `handlers/validateSession.js` |
| `POST` | `/get-session` | `handlers/getSession.js` |
| `POST` | `/generate` | `handlers/generate.js` |
| `POST` | `/submit-email` | `handlers/submitEmail.js` |
| `POST` | `/fetch-job-url` | `handlers/fetchJobUrl.js` |
| `POST` | `/exchange-token` | `handlers/exchangeToken.js` |
| `POST` | `/resend-email` | `handlers/resendEmail.js` |
| `POST` | `/interview-kit` | `handlers/interviewKit.js` |

## Pricing Tiers

| Tier | Price | Credits | Languages |
|---|---|---|---|
| Coba Dulu | Rp 29.000 | 1 CV | Bahasa Indonesia only |
| Single | Rp 59.000 | 1 CV | ID + EN |
| 3-Pack | Rp 149.000 | 3 CV | ID + EN |
| Job Hunt Pack | Rp 299.000 | 10 CV | ID + EN |

## gstack

Use the `/browse` skill from gstack for all web browsing. **Never use `mcp__claude-in-chrome__*` tools.**

Available gstack skills:
- `/office-hours` — Review plan aplikasi, product thinking, prioritization
- `/plan-ceo-review` — CEO-level plan review
- `/plan-eng-review` — Engineering plan review
- `/plan-design-review` — Design plan review
- `/design-consultation` — Design consultation
- `/design-shotgun` — Design feedback shotgun
- `/review` — Code review
- `/ship` — Ship a feature end-to-end
- `/land-and-deploy` — Land and deploy changes
- `/canary` — Canary deploy
- `/benchmark` — Performance benchmarking
- `/browse` — Headless browser for web browsing, QA, and testing
- `/connect-chrome` — Connect to Chrome browser
- `/qa` — Full QA testing suite
- `/qa-only` — QA testing only (no code changes)
- `/design-review` — Design review
- `/setup-browser-cookies` — Setup browser cookies/auth
- `/setup-deploy` — Setup deployment pipeline
- `/retro` — Retrospective
- `/investigate` — Investigate a bug or issue
- `/document-release` — Document a release
- `/codex` — Codex agent
- `/cso` — CSO review
- `/autoplan` — Auto-generate implementation plan
- `/careful` — Extra-careful mode for risky changes
- `/freeze` — Freeze a feature/branch
- `/guard` — Guard mode
- `/unfreeze` — Unfreeze a feature/branch
- `/gstack-upgrade` — Upgrade gstack

## Deploy Configuration (configured by /setup-deploy)
- Platform: Cloudflare Workers (API) + Cloudflare Pages (frontend)
- Production URL: https://gaslamar.com
- Worker URL: https://gaslamar-worker.carolineratuolivia.workers.dev
- Deploy workflow: .github/workflows/deploy.yml (auto-deploy on push to main)
- Deploy status command: curl -s https://gaslamar-worker.carolineratuolivia.workers.dev/health
- Merge method: squash
- Project type: web app

### Jobs (in order)
1. `test` — `cd worker && npm test` (vitest, runs on all PRs + pushes to main)
2. `deploy-worker` — `wrangler deploy --env production` (main only, after test)
3. `build-frontend` — `npm run vendor` builds js/vendor/ (main only, after test)
4. `deploy-pages` — Cloudflare Pages action (main only, after build-frontend)

### GitHub Secrets required
- `CLOUDFLARE_API_TOKEN` — API token with Workers + Pages deploy permissions
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

### Custom deploy hooks
- Pre-merge: `npm test` (in /worker) — enforced by CI
- Deploy trigger: automatic on push to main
- Post-deploy health check: GET https://gaslamar-worker.carolineratuolivia.workers.dev/health → 200

### One-time setup (first deploy)
```bash
# 1. Create KV namespaces
cd worker && npx wrangler kv:namespace create GASLAMAR_SESSIONS
npx wrangler kv:namespace create GASLAMAR_SESSIONS --preview
# → Paste IDs into wrangler.toml

# 2. Set secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put MAYAR_API_KEY
npx wrangler secret put MAYAR_API_KEY_SANDBOX
npx wrangler secret put MAYAR_WEBHOOK_SECRET

# 3. Create Cloudflare Pages project (once, via dashboard)
# Project name: gaslamar
# Build command: npm install && npm run vendor
# Output directory: /

# 4. Add GitHub secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
# Then push to main — CI handles the rest
```
