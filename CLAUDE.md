# GasLamar — Claude Code Instructions

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
