# GasLamar — Claude Code Instructions

**Stack:** Cloudflare Workers (API) + Cloudflare Pages (frontend) + `claude-sonnet-4-6` (prod analyze) / `claude-haiku-4-5-20251001` (staging analyze + all tailoring) + Mayar (payment) + Cloudflare KV  
**Pages flow:** `index.html` → `upload.html` → `analyzing.html` → `hasil.html` → `download.html` (session expired/lost → `access.html`)  
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
| 5. REWRITE | LLM via `/generate` → tailored CV in ID + EN. Cache: `gen_id_v3_<hash>` / `gen_en_v3_<hash>` 48h |
| 6. VALIDATE | schema check + 1 retry after every LLM call |

**Cache bump rule:** two independent versions in `analysis.js`:
- `EXTRACT_CACHE_VERSION` (`extract_v2_*`) — bump when changing `pipeline/extract.js` or `prompts/extract.js`
- `ANALYSIS_CACHE_VERSION` (`analysis_v6_*`) — bump when changing anything else in `pipeline/` or `prompts/`
- Tailoring: bump `gen_id_v3_` / `gen_en_v3_` prefix in `tailoring.js` when changing tailor prompts

**Session state machine:**

| Transition | Trigger |
|---|---|
| `pending → paid` | `POST /webhook/mayar` confirms payment |
| `paid → generating` | First `POST /get-session` call |
| `generating → paid` | `POST /generate` completes with credits remaining |
| `generating → deleted` | `POST /generate` uses last credit |

---

## Non-Obvious Files

Routes → `router.js`. Handlers → `worker/src/handlers/<endpoint>.js`. Pipeline stages → `worker/src/pipeline/`. LLM prompts → `worker/src/prompts/`.

| File | Why non-obvious |
|---|---|
| `worker/src/analysis.js` | Cache key versions live here (`extract_v2`, `analysis_v6`) — bump here, not in pipeline files |
| `worker/src/tailoring.js` | Gen key prefixes live here (`gen_id_v3_`, `gen_en_v3_`) — bump here when changing tailor prompts |
| `worker/src/roleProfiles.js` | Role-weighted scoring inputs — not in `score.js` |
| `worker/src/pipeline/archetypes.js` | Archetype detection called from `analyze.js` |
| `worker/src/pipeline/roleInference.js` | Role inference called from `analyze.js` |
| `js/config.js` | Staging vs prod worker URL selected by hostname at runtime |
| `js/hasil-guard.js` | NOT bundled — must stay as synchronous inline `<script>` or auth flash occurs |
| `worker/src/rewriteGuard.js` | Hallucination guard — called by `postProcessCV()` in `tailoring.js`; severity-grades every rewritten bullet (high/medium/low fallback). Adding/removing patterns here affects both ID and EN rewrites |
| `worker/src/handlers/fetchJobUrl.js` | Fetches JD from a user-supplied URL. Strict domain allowlist (LinkedIn, Indeed, Glassdoor, etc.) — suffix-checked to block look-alikes. URL shorteners are intentionally blocked. |
| `worker/src/handlers/exchangeToken.js` | Exchanges a single-use `email_token` (128-bit hex, 1h TTL) for a session cookie — enables download links in emails to work cross-device. Token deleted on success. |
| `worker/src/handlers/interviewKit.js` | Generates interview prep kit (questions, email template, WhatsApp opener, elevator pitch). Cache-first: `kit_<session_id>_<language>` 24h. No caching on first call — only stored after a successful generation. |
| `router.js` (inline) | `POST /feedback` (user survey, fire-and-forget) and `POST /api/log` (client error logging) have no handler files — logic lives inline in `router.js`. |
| `worker/src/handlers/mayarWebhook.js` | HMAC-SHA256 verification + idempotency sentinel `payment_processed_<session_id>` (48h TTL) — written BEFORE session update to survive retries. Normalizes many Mayar status variants (paid/settlement/capture/SUCCESS/…). Email send via `ctx.waitUntil`. |
| `worker/src/handlers/bypassPayment.js` | Sandbox/E2E only — returns 404 if `ENVIRONMENT === 'production'`. Creates a paid session without going through Mayar. Used for automated tests. |
| `js/download-guard.js` | Blocking external `<script>` loaded in download.html `<head>` (not inline). Three valid entry paths: `?token=` (email link), localStorage `gaslamar_session` (post-payment), localStorage `gaslamar_delivery` (email-delivery flow). All others → `window.location.replace('/')`. |

---

## Pricing Tiers (`constants.js`)

| Tier | Price | Credits | Languages |
|---|---|---|---|
| coba | Rp 29.000 | 1 | ID only |
| single | Rp 59.000 | 1 | ID + EN |
| 3pack | Rp 149.000 | 3 | ID + EN |
| jobhunt | Rp 299.000 | 10 | ID + EN |

Session TTL: 7 days (coba/single), 30 days (3pack/jobhunt).

**Note:** All tiers are one-time purchases, not subscriptions. JobHunt gives 10 credits valid for 30 days — credits do not renew monthly.

---

## Dev Commands

```bash
# Worker
cd worker && npm test              # vitest (all tests must pass)
cd worker && npm run test:watch    # vitest watch mode
cd worker && npm run dev           # local dev
cd worker && npm run tail          # prod log stream
cd worker && npm run deploy:prod   # deploy to production (NOT bare `npm run deploy` — that targets sandbox)

# Frontend (repo root)
npm run build                   # vendor + JS bundles + React + Tailwind
npm run build:js                # esbuild bundles only
npm run build:react             # React build only
npm run build:vendor            # vendor libs + Tailwind only
npm run dev                     # watch mode
npm start                       # serve frontend locally on :3000
```

---

## Invariants (never break)

- Scoring/verdict logic stays in pure JS (`pipeline/analyze.js` + `pipeline/score.js`) — never in LLM prompts.
- Webhook HMAC-SHA256 (Mayar) must always be verified.
- CORS: only `gaslamar.com` + `www.gaslamar.com`.
- File validation: magic bytes (PDF `%PDF`, DOCX `PK`) + 5MB — server-side.
- Rate limiting: Cloudflare native binding + KV fallback — **both** must allow.
- `bypassPayment.js` must always return 404 in production — the `ENVIRONMENT === 'production'` guard must never be removed.

## Gotchas (common bug sources)

- **Stale cache** — change prompt or scoring formula? Bump version in `analysis.js` (extract/analyze) or `tailoring.js` (gen). Old key = old result.
- **IP mismatch** — `cv_text_key` is bound to the uploading IP. Testing across IPs or proxies will reject with mismatch.
- **Frontend not updating** — `js/dist/` and `js/vendor/` are gitignored. Run `npm run build` before testing; CI builds them fresh.
- **Double-gen race** — session lock `lock_<id>` TTL 120s. Retrying within that window will silently block.
- **Wrong env deployed** — `wrangler deploy` without `--env production` goes to sandbox, not prod.
- **Auth flash** — `js/hasil-guard.js` must stay as synchronous inline `<script>`. If it gets deferred/bundled, unauthenticated content flashes.
- **Silent email skip** — `RESEND_API_KEY` is optional. If absent, all email sending silently no-ops with no error thrown. Useful for local dev but easy to miss in staging.
- **Double-invoice race** — `invoice_lock_<cv_text_key>` TTL 60s (KV minimum) prevents duplicate invoices for the same CV upload. Mirrors the double-gen lock pattern.
- **PDF beta header prod-only** — `anthropic-beta: pdfs-2024-09-25` is sent only for Sonnet (prod). On staging (Haiku), PDFs are pre-converted to text — PDF document blocks are never sent.
- **CV download is client-side** — DOCX/PDF files are generated entirely in the browser (docx.js + jsPDF from `cvDataCache`). The worker never serves file bytes.
- **Webhook idempotency sentinel** — `payment_processed_<session_id>` (48h TTL) is written BEFORE the session update in `mayarWebhook.js`. Removing it breaks Mayar retry safety.
- **`gaslamar_scoring` deleted after render** — `scoring.js` deletes it from sessionStorage immediately after reading. This is intentional security hardening, not a bug.
- **`konfidensitas` discarded from LLM** — `diagnose.js` returns a `konfidensitas` field but the orchestrator (`analysis.js`) ignores it. Stage 2 (pure JS) is always authoritative for confidence level.
- **`opportunity_cost` is derived, not scored** — always 5 or 10, computed from `effort`. It is never independently scored. Don't add scoring logic here.
- **`skor_sesudah` is deterministic JS** — not LLM-generated. Formula: `skor + improvement`, rounded to nearest 5, clamped to [skor+10, 95]. Improvement = min(20, missing_skills × 3) + 5 if no numbers.
- **Red-flag penalty is absolute** — -15 (1 flag), -20 (2 flags), -25 max. Applied to `skor` and `skor_sesudah` only — never to `skor_6d`.
- **CV silently truncated in tailoring** — `tailoring.js` truncates CVs at 4000 chars. Old experience entries are dropped without error or warning.

---

## Workflow

- **Non-trivial tasks (3+ steps):** write a plan to `tasks/todo.md` with checkable items before starting. Re-plan if something goes sideways — don't keep pushing.
- **Verification:** never mark a task complete without proving it works. Run `cd worker && npm test`, check logs, diff behavior.
- **Bug reports:** fix autonomously. Read logs/errors, find root cause, resolve. No hand-holding needed.
- **After any correction:** append the pattern to `tasks/lessons.md` to prevent recurrence.
- **Minimal impact:** only touch what's necessary. If a fix feels hacky, find the elegant solution.

---

## Deploy

- CI: push to `main` → test → deploy worker → build frontend → deploy pages
- Staging: `staging.gaslamar.pages.dev` → staging worker (Mayar sandbox)
- Health check: `GET https://gaslamar-worker.carolineratuolivia.workers.dev/health`

---

## Reference Docs

| File | Purpose |
|---|---|
| `SETUP.md` | Dev onboarding: KV setup, secrets, deploy steps |
| `SECURITY.md` | Authorization model, session security, tier enforcement, data flow |
| `DESIGN.md` | Color tokens, typography, spacing, decoration philosophy |
| `AGENTS.md` | Architecture overview, pipeline summary for agent use |

---

## gstack Skills

`/browse` for all web browsing. Never use `mcp__claude-in-chrome__*`.

`/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/design-consultation` `/design-shotgun` `/review` `/ship` `/land-and-deploy` `/canary` `/benchmark` `/browse` `/connect-chrome` `/qa` `/qa-only` `/design-review` `/setup-browser-cookies` `/setup-deploy` `/retro` `/investigate` `/document-release` `/codex` `/cso` `/autoplan` `/careful` `/freeze` `/guard` `/unfreeze` `/gstack-upgrade`
