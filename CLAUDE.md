# GasLamar — Claude Code Instructions

**Stack:** Cloudflare Workers (API) + Cloudflare Pages (frontend) + Claude claude-haiku-3-5 + Mayar (payment) + Cloudflare KV  
**Pages flow:** `index.html` → `upload.html` → `analyzing.html` → `hasil.html` → `download.html`  
**URLs:** prod `gaslamar.com` / worker `gaslamar-worker.carolineratuolivia.workers.dev` / staging `gaslamar-worker-staging.carolineratuolivia.workers.dev`

---

## Pipeline (`POST /analyze`)

LLM = extraction + text only. All scoring is pure JS.

| Stage | What |
|---|---|
| 1. EXTRACT | LLM → structured CV+JD data. Cache: `extract_v2_<hash>` 24h |
| 2. ANALYZE | pure JS — skill match, format, archetype, red flags |
| 3. SCORE | formula → 6D scores, verdict (DO/TIMED/DO NOT), timebox. Cache: `analysis_v6_<hash>` 48h |
| 4. DIAGNOSE | LLM → human-readable gap explanation only (cannot change scores) |
| 5. REWRITE | LLM via `/generate` → tailored CV in ID + EN. Cache: `gen_id_<hash>` / `gen_en_<hash>` 48h |
| 6. VALIDATE | schema check + 1 retry after every LLM call |

**Cache bump rule:** when changing a prompt or scoring formula, bump the version suffix in `analysis.js` / `tailoring.js`.

---

## Key Files

| File | Purpose |
|---|---|
| `worker/src/router.js` | Route dispatch — add endpoints here |
| `worker/src/handlers/` | One file per endpoint |
| `worker/src/pipeline/` | `extract.js`, `analyze.js`, `archetypes.js`, `roleInference.js`, `score.js`, `diagnose.js`, `validate.js` |
| `worker/src/prompts/` | `extract.js`, `diagnose.js`, `tailorId.js`, `tailorEn.js`, `interviewKit.js` |
| `worker/src/analysis.js` | Cache orchestration for analyze pipeline — cache key versions live here |
| `worker/src/tailoring.js` | Cache orchestration for generate pipeline — gen key prefixes live here |
| `worker/src/constants.js` | `TIER_PRICES`, `TIER_CREDITS`, `SESSION_TTL`, `ALLOWED_ORIGINS` |
| `worker/src/claude.js` | `callClaude()` — 40s timeout |
| `worker/src/sessions.js` | KV session CRUD |
| `worker/src/roleProfiles.js` | Role-weighted scoring profiles |
| `js/config.js` | `WORKER_URL` — auto-selects staging vs prod by hostname |
| `js/dist/` | Generated bundles — gitignored, run `npm run build:js` |
| `js/vendor/` | Vendored libs — gitignored, run `npm run build:vendor` |
| `css/main.css` | Tailwind + custom styles (generated) |

---

## API Routes

| Method | Path | Handler |
|---|---|---|
| GET | `/health` | inline — no auth |
| POST | `/analyze` | `analyze.js` — rate 3/min |
| POST | `/generate` | `generate.js` — rate 5/min |
| POST | `/create-payment` | `createPayment.js` — rate 5/min |
| POST | `/webhook/mayar` | `mayarWebhook.js` — HMAC-SHA256 verified |
| POST | `/session/ping` | `sessionPing.js` |
| GET | `/check-session` | `checkSession.js` |
| GET | `/validate-session` | `validateSession.js` |
| POST | `/get-session` | `getSession.js` — requires `paid` status |
| POST | `/submit-email` | `submitEmail.js` |
| POST | `/fetch-job-url` | `fetchJobUrl.js` — rate 5/min |
| POST | `/exchange-token` | `exchangeToken.js` |
| POST | `/resend-email` | `resendEmail.js` |
| POST | `/interview-kit` | `interviewKit.js` |
| POST | `/bypass-payment` | `bypassPayment.js` — dev/admin only |

---

## Pricing Tiers (`constants.js`)

| Tier | Price | Credits | Languages |
|---|---|---|---|
| coba | Rp 29.000 | 1 | ID only |
| single | Rp 59.000 | 1 | ID + EN |
| 3pack | Rp 149.000 | 3 | ID + EN |
| jobhunt | Rp 299.000 | 10 | ID + EN |

Session TTL: 7 days (coba/single), 30 days (3pack/jobhunt).

---

## Dev Commands

```bash
# Worker
cd worker && npm test           # vitest (all tests must pass)
cd worker && npm run dev        # local dev
cd worker && npm run tail       # prod log stream

# Frontend (repo root)
npm run build                   # vendor + JS bundles + React + Tailwind
npm run build:js                # esbuild bundles only
npm run build:react             # React build only
npm run build:vendor            # vendor libs + Tailwind only
npm run dev                     # watch mode
```

---

## Conventions & Invariants

- Worker: pure ES modules, no TypeScript.
- Never put scoring/verdict logic in LLM prompts — keep in `pipeline/analyze.js` + `pipeline/score.js`.
- Rate limiting: Cloudflare native binding (atomic) + KV fallback — **both** must allow.
- `js/hasil-guard.js` is NOT bundled — runs as synchronous inline `<script>` (prevents auth flash). All other scripts use `defer`.
- Session IDs: `sess_<crypto.randomUUID()>`. `cv_text_key` is IP-bound — reject if IP mismatches.
- Session lock (`lock_<session_id>`, TTL 30s) prevents double-generation races.
- `/get-session` rejects unless session has `paid` status.
- Webhook HMAC-SHA256 (Mayar) must never be bypassed.
- CORS: only `gaslamar.com` and `www.gaslamar.com`.
- File validation: magic bytes (PDF `%PDF`, DOCX `PK`) + 5MB limit — server-side.
- Never run `wrangler deploy` without `--env production` for prod.

---

## Deploy

- CI: push to `main` → test → deploy worker → build frontend → deploy pages
- Staging: `staging.gaslamar.pages.dev` → staging worker (Mayar sandbox)
- Health check: `GET https://gaslamar-worker.carolineratuolivia.workers.dev/health`

---

## gstack Skills

`/browse` for all web browsing. Never use `mcp__claude-in-chrome__*`.

`/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/design-consultation` `/design-shotgun` `/review` `/ship` `/land-and-deploy` `/canary` `/benchmark` `/browse` `/connect-chrome` `/qa` `/qa-only` `/design-review` `/setup-browser-cookies` `/setup-deploy` `/retro` `/investigate` `/document-release` `/codex` `/cso` `/autoplan` `/careful` `/freeze` `/guard` `/unfreeze` `/gstack-upgrade`
