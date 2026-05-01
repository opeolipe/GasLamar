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

## Non-Obvious Files

Routes → `router.js`. Handlers → `worker/src/handlers/<endpoint>.js`. Pipeline stages → `worker/src/pipeline/`. LLM prompts → `worker/src/prompts/`.

| File | Why non-obvious |
|---|---|
| `worker/src/analysis.js` | Cache key versions live here (`extract_v2`, `analysis_v6`) — bump here, not in pipeline files |
| `worker/src/tailoring.js` | Gen key prefixes live here (`gen_id_`, `gen_en_`) — bump here when changing tailor prompts |
| `worker/src/roleProfiles.js` | Role-weighted scoring inputs — not in `score.js` |
| `worker/src/pipeline/archetypes.js` | Archetype detection called from `analyze.js` |
| `worker/src/pipeline/roleInference.js` | Role inference called from `analyze.js` |
| `js/config.js` | Staging vs prod worker URL selected by hostname at runtime |
| `js/hasil-guard.js` | NOT bundled — must stay as synchronous inline `<script>` or auth flash occurs |

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

## Invariants (never break)

- Scoring/verdict logic stays in pure JS (`pipeline/analyze.js` + `pipeline/score.js`) — never in LLM prompts.
- Webhook HMAC-SHA256 (Mayar) must always be verified.
- CORS: only `gaslamar.com` + `www.gaslamar.com`.
- File validation: magic bytes (PDF `%PDF`, DOCX `PK`) + 5MB — server-side.
- Rate limiting: Cloudflare native binding + KV fallback — **both** must allow.

## Gotchas (common bug sources)

- **Stale cache** — change prompt or scoring formula? Bump version in `analysis.js` (extract/analyze) or `tailoring.js` (gen). Old key = old result.
- **IP mismatch** — `cv_text_key` is bound to the uploading IP. Testing across IPs or proxies will reject with mismatch.
- **Frontend not updating** — `js/dist/` and `js/vendor/` are gitignored. Run `npm run build` before testing; CI builds them fresh.
- **Double-gen race** — session lock `lock_<id>` TTL 120s. Retrying within that window will silently block.
- **Wrong env deployed** — `wrangler deploy` without `--env production` goes to sandbox, not prod.
- **Auth flash** — `js/hasil-guard.js` must stay as synchronous inline `<script>`. If it gets deferred/bundled, unauthenticated content flashes.

---

## Deploy

- CI: push to `main` → test → deploy worker → build frontend → deploy pages
- Staging: `staging.gaslamar.pages.dev` → staging worker (Mayar sandbox)
- Health check: `GET https://gaslamar-worker.carolineratuolivia.workers.dev/health`

---

## gstack Skills

`/browse` for all web browsing. Never use `mcp__claude-in-chrome__*`.

`/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/design-consultation` `/design-shotgun` `/review` `/ship` `/land-and-deploy` `/canary` `/benchmark` `/browse` `/connect-chrome` `/qa` `/qa-only` `/design-review` `/setup-browser-cookies` `/setup-deploy` `/retro` `/investigate` `/document-release` `/codex` `/cso` `/autoplan` `/careful` `/freeze` `/guard` `/unfreeze` `/gstack-upgrade`
