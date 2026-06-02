# GasLamar Deployment Architecture

## Overview

GasLamar has two independently deployable components:

| Component | Prod | Staging |
|-----------|------|---------|
| **Cloudflare Worker** (API) | `gaslamar.com/*` | `api-staging.gaslamar.com/*` |
| **Cloudflare Pages** (Frontend) | `gaslamar.com` (via Worker) | `staging.gaslamar.pages.dev` |

Both use the same Cloudflare Pages project (`gaslamar`). Production deploys to the `main` branch alias; staging deploys to the `staging` branch preview alias.

---

## Triggers

| Event | Workflow | What runs |
|-------|----------|-----------|
| Push to `main` | `deploy.yml` | Tests → typecheck → deploy worker (prod) → build frontend → deploy Pages (prod) |
| Push to `staging` | `deploy-staging.yml` | Tests → typecheck → deploy worker (staging) + build frontend → deploy Pages (staging) → smoke test |
| Push to any other branch | `deploy.yml` | Tests + typecheck only (no deploy) |

---

## Build Steps

### Frontend (`npm run build`)

Executed in order:

1. `build:csp` — recompute CSP hash for inline scripts, write to `_headers`
2. `build:vendor` — bundle third-party libs into `js/vendor/`
3. `build:js` — esbuild bundles into `js/dist/`
4. `build:react` — compile React pages into `js/dist/`
5. `build:hash` — write content-fingerprint `?v=` query strings into each HTML file

The `?v=` fingerprints are **critical**: every HTML file references its bundles with a hash. If the HTML is stale (old `?v=`) but the bundle file changed, the browser loads the old bundle from cache.

### Output Directory

The frontend is served directly from the repository root (no separate `dist/` at source). In CI, the artifact is downloaded to a `dist/` folder for the Pages deploy step.

HTML files (`*.html`) live at the repo root and are included in the artifact. They are **not** generated — they are checked into the repo and only their `?v=` attributes are updated at build time.

---

## Caching Strategy

### `_headers` rules (Cloudflare Pages)

| Path | Cache-Control |
|------|---------------|
| `/*.html` | `public, max-age=0, must-revalidate` — always revalidate HTML at CDN edge |
| `/js/dist/*` | `public, max-age=31536000, immutable` — fingerprinted; safe to cache forever |
| `/js/vendor/*` | `public, max-age=31536000, immutable` — versioned vendor bundles |
| `/css/*` | `public, max-age=86400` — short TTL for CSS |
| `/*` (fallback) | Cloudflare Pages default (short TTL) |

**HTML must have `max-age=0, must-revalidate`**. Without this, browsers apply heuristic caching and may serve HTML pointing to old `?v=` bundle versions for minutes to hours after a deploy.

### Cloudflare Pages CDN Invalidation

Cloudflare Pages **automatically invalidates** the CDN for the `*.pages.dev` domain after every successful deploy. No manual cache purge is needed for staging.

For custom domains on production (`gaslamar.com`), Cloudflare Workers serve the static assets, so the Workers KV/cache invalidates on deploy.

---

## Smoke Tests (Staging Only)

After every staging Pages deploy, CI runs two verification steps:

### 1. Bundle Fingerprint Check (`verify-staging-bundle.js`)

- Reads `?v=` hashes from the just-built local HTML files.
- Fetches each deployed HTML page from the staging URL.
- Asserts that deployed `?v=` values match the local build.
- Retries up to 5 times (total ~90 s wait) for CDN propagation.

### 2. Structural Smoke Test (inline CI step)

For `hasil.html`, `upload.html`, `analyzing.html`, `download.html`:

- Asserts HTTP 200.
- Asserts the correct React root element ID (`result-root`, `upload-root`, etc.) is present.
- Asserts the page loads its own dedicated React bundle and not a foreign one.
- Asserts title keywords are present where applicable.

Both checks must pass for a staging deploy to be marked successful.

---

## Manual Re-Deploy

### Re-deploy staging Pages

```bash
# From repo root
npm run build
npx wrangler@3 pages deploy . \
  --project-name=gaslamar \
  --branch=staging \
  --commit-dirty=true
```

### Re-deploy staging Worker

```bash
cd worker
npx wrangler deploy --env staging
```

### Re-deploy production (use CI — never run locally unless emergency)

```bash
cd worker
npx wrangler deploy --env production
```

---

## Debugging Stale Staging Builds

If staging looks stale, check in order:

1. **Check CI** — did the `deploy-staging.yml` workflow run and pass the smoke tests?
2. **Check wrangler output** — did `Deploy preview to Cloudflare Pages` step show a successful URL?
3. **Check browser cache** — hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) to bypass browser cache.
4. **Check HTML `?v=` values** — compare the `?v=` in your browser's `hasil.html` source against the latest commit's `hasil.html`. If they differ, the browser is serving a cached copy.
5. **Check Cloudflare Pages dashboard** — confirm the latest deployment on the `staging` branch is active.
6. **Check `_headers`** — `/*.html` must have `Cache-Control: public, max-age=0, must-revalidate`. If this is missing, browser heuristic caching causes stale HTML.

> See also: `CONTRIBUTING.md` section "Debugging Stale Staging Builds".

---

## Environment Variable Separation

| Secret | Prod Worker | Staging Worker |
|--------|-------------|----------------|
| `ANTHROPIC_API_KEY` | same key | same key |
| `MAYAR_API_KEY` | production Mayar key | — |
| `MAYAR_API_KEY_SANDBOX` | — | sandbox Mayar key |
| `MAYAR_WEBHOOK_SECRET` | production webhook secret | sandbox webhook secret |
| `RESEND_API_KEY` | optional | optional |

KV namespaces are **strictly separated**: staging uses `7f5d5810bbcd42f2a30dc630265dfa13`, production uses `6524fffd3c574f92a16c655bc82dec8d`. Never cross-populate.
