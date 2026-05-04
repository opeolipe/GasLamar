# Product Requirements Document — Template
> Derived from GasLamar build experience. Fill every section before writing the first line of code.
> Sections marked `[FILL]` are blanks. Sections marked `[GASLAMAR]` show the proven pattern as a reference.

---

## 0. How To Use This Template

1. Copy this file to your new repo as `PRD.md`
2. Fill every `[FILL]` section in a single sitting before any code is written
3. Decisions left blank = decisions made by accident later (the expensive kind)
4. Reference this doc when you hit ambiguity — if it's not here, add it here before coding
5. Keep it alive: update it when you change a decision, not after the fact

**Rule of thumb:** if you can't fill a section, the app isn't ready to build yet.

---

## 1. Product Overview

### What It Does
`[FILL]` — One paragraph. What problem does it solve, for whom, and how.

### The Core Loop
`[FILL]` — The minimal sequence a user goes through to get value. Write it as:
```
User does X → System does Y → User gets Z
```

### What It Is Not
`[FILL]` — Explicitly scope out adjacent features you will NOT build in v1. This prevents scope creep mid-build.

### Success Metric
`[FILL]` — One number. What does "it works" look like at launch?

---

## 2. Tech Stack Decision

### Compute
`[FILL]` — Where does the backend run? (Cloudflare Workers / Node / Vercel / etc.)

> **[GASLAMAR]** Cloudflare Workers: zero cold starts, global edge, KV native. Best for stateless, latency-sensitive APIs. Downside: no filesystem, 128MB memory limit, 10ms CPU limit (surmountable with streaming).

### Storage
`[FILL]` — What stores state?

| Layer | What It Stores | Why |
|---|---|---|
| `[FILL]` | `[FILL]` | `[FILL]` |

> **[GASLAMAR]** Cloudflare KV: sessions, cached LLM outputs. Good for read-heavy, eventually-consistent data. Not for transactional writes.

### Frontend
`[FILL]` — Static HTML/CSS/JS on Cloudflare Pages, or a framework?

> **[GASLAMAR]** Plain HTML + Tailwind + esbuild bundles on Cloudflare Pages. No framework overhead. `js/dist/` and `js/vendor/` gitignored, built by CI. One config file (`js/config.js`) owns the worker URL — all other files import from it.

### Payment
`[FILL]` — Payment provider and webhook flow.

> **[GASLAMAR]** Mayar (Indonesian payment gateway). Webhook HMAC-SHA256 verified server-side before any state change. Never trust client payment confirmation.

### LLM
`[FILL]` — Which model(s), and for which stages?

> **[GASLAMAR]** Two-tier: `claude-haiku-4-5-20251001` for mechanical extraction + all tailoring (fast, cheap). `claude-sonnet-4-6` for production scoring + diagnosis (more accurate). Staging uses Haiku for everything.

### Email
`[FILL]` — Email provider. Note: make it optional so local dev works without it.

> **[GASLAMAR]** Resend. `RESEND_API_KEY` is optional — if absent, all email sending silently no-ops. Useful for local dev, dangerous to miss in staging.

---

## 3. The Determinism Boundary (Critical for LLM Apps)

> This is the single most important architectural decision. Define it before writing any prompt.

### What the LLM Touches
`[FILL]` — LLM handles data extraction (verbatim copying) and language generation (text output) only.

```
[LLM zone]     Extract raw structured data → Generate human-readable explanations/content
[Code zone]    All scoring, ranking, verdicts, business logic, matching
[Guard zone]   Schema validation + 1 retry after every LLM output
```

### What Code Owns
`[FILL]` — List every number, score, verdict, or decision that must NEVER come from an LLM:

- [ ] `[FILL]`
- [ ] `[FILL]`
- [ ] `[FILL]`

> **[GASLAMAR]** 6-stage pipeline: Extract (LLM) → Analyze (JS) → Score (JS formula) → Diagnose (LLM, read-only) → Rewrite (LLM) → Validate (JS + retry). Starting with one fat LLM call caused hallucination bugs and 6 cache-breaking rewrites. Draw the boundary first.

### Hallucination Guard Rules
`[FILL]` — What patterns in LLM output are invalid and must be caught?

> **[GASLAMAR]** `rewriteGuard.js` catches: placeholder patterns (`[X]`, `X%`, `Y tahun`), inflated claims (leadership implied without evidence), forbidden phrases. Every rewritten bullet is severity-graded (high/medium/low fallback). 528 lines — added post-launch. Should have been designed in from day 1.

---

## 4. User Flow — State Machine

> Write this before building any page. Every edge case (auth flash, expired session, back navigation) becomes obvious when the state machine is defined.

### States
`[FILL]`
```
[list every state the user/session can be in]

e.g.:
anonymous     — no session exists
uploaded      — data submitted, not yet paid
paid          — payment confirmed by webhook
generating    — LLM job in progress
complete      — output ready, user can access result
expired       — session TTL elapsed or credits exhausted
```

### Transitions
`[FILL]`
```
anonymous   --[action]-->  next_state
[FILL]      --[action]-->  [FILL]
```

### Per-State Contract
`[FILL]` — For each state, what is true?

| State | In KV | In sessionStorage | Pages accessible | Redirect if wrong page |
|---|---|---|---|---|
| `[FILL]` | `[FILL]` | `[FILL]` | `[FILL]` | `[FILL]` |

> **[GASLAMAR]** 5-page flow: `index → upload → analyzing → hasil → download`. Lost session → `access.html`. Auth guard (`hasil-guard.js`) runs as synchronous inline `<script>` — NOT bundled or deferred. If it gets deferred, unauthenticated content flashes before redirect. This caused a visible bug that was fixed late.

### Page Map
`[FILL]`
```
index.html      → [what it does, what state it expects]
[page].html     → [what it does, what state it expects]
```

---

## 5. Security Model

> For paid apps: answer all 5 questions before writing the first route. Retrofitting billing security mid-flight is expensive and error-prone.

### The 5 Baseline Questions

- [ ] **Where does tier/credits live?**
  `[FILL]` — Must be server-side only. Client storage is display-only.
  > **[GASLAMAR]** Cloudflare KV. `/generate` reads tier from KV, ignores client body entirely. `sessionStorage.gaslamar_tier` is for UI labels only — setting it post-payment has zero effect.

- [ ] **How does payment confirmation arrive?**
  `[FILL]` — Must be webhook with cryptographic verification. Never trust client-sent confirmation.
  > **[GASLAMAR]** Mayar webhook → HMAC-SHA256 verified with constant-time comparison → sets `status: 'paid'` in KV. Session unusable until this fires.

- [ ] **What's the anti-replay mechanism?**
  `[FILL]` — One-time tokens must be deleted on use.
  > **[GASLAMAR]** `email_token` (128-bit hex, 1h TTL) exchanged for session cookie in `exchangeToken.js`. Token deleted from KV on success. Can't be replayed.

- [ ] **What's the race-condition lock?**
  `[FILL]` — Any expensive or state-mutating operation needs a distributed lock.
  > **[GASLAMAR]** `lock_<session_id>` TTL 120s before any generation. `invoice_lock_<cv_text_key>` TTL 120s before invoice creation. Retrying within window silently blocks.

- [ ] **What does the client trust?**
  `[FILL]` — Define explicitly what client-supplied values are accepted at face value vs. ignored.
  > **[GASLAMAR]** Nothing billing-related. `/check-session` returns authoritative tier from server. Client can't override tier, credits, or session status.

### File Validation (for file upload apps)
`[FILL]`
> **[GASLAMAR]** Magic bytes server-side: PDF (`%PDF`), DOCX (`PK`). 5MB limit. CV text minimum 100 chars. Job description maximum 5,000 chars. Never trust client-supplied MIME type.

### Rate Limiting
`[FILL]` — Which endpoints, what limits, dual-layer or single?
> **[GASLAMAR]** Dual-layer: Cloudflare native binding + KV fallback counter. Both must allow. Single-layer KV has TOCTOU race. Limits: `/analyze` 3/min, `/create-payment` + `/generate` + `/fetch-job-url` 5/min.

### CORS Policy
`[FILL]` — Exact list of allowed origins.
> **[GASLAMAR]** `gaslamar.com` + `www.gaslamar.com` only. No wildcards.

### URL Allowlist (for URL-fetching features)
`[FILL]` — If the app fetches user-supplied URLs, define a strict allowlist.
> **[GASLAMAR]** `fetchJobUrl.js`: suffix-checked domain allowlist (LinkedIn, Indeed, Glassdoor, etc.) to block look-alikes. URL shorteners intentionally blocked. Evaluated per-domain, not per-hostname prefix.

---

## 6. Cache Strategy

> Define this before writing any pipeline. Stale cache is the #1 silent bug in LLM apps.

### Cache Key Schema
`[FILL]` — Create a `cacheVersions.js` file on day 1. All version strings live here. Pipeline files import from it — never hardcode versions inline.

```js
// cacheVersions.js — bump here when prompt or formula changes
export const CACHE_VERSIONS = {
  extract: 'v1',
  analyze: 'v1',
  generate: 'v1',
  // add more as needed
};
```

### Cache Table
`[FILL]`

| Cache Name | Key Pattern | TTL | When to Bump Version |
|---|---|---|---|
| `[FILL]` | `[name]_v{N}_{hash(inputs)}` | `[FILL]` | `[FILL]` |

> **[GASLAMAR]**
> | Cache | Key | TTL | Bump When |
> |---|---|---|---|
> | Extract | `extract_v2_<SHA256(cv+jd)>` | 24h | `prompts/extract.js` changes |
> | Analysis | `analysis_v6_<SHA256(cv+jd)>` | 48h | any `pipeline/` or scoring change |
> | Gen (ID) | `gen_id_v3_<SHA256(cv+jd)>` | 48h | `prompts/tailorId.js` changes |
> | Gen (EN) | `gen_en_v3_<SHA256(cv+jd)>` | 48h | `prompts/tailorEn.js` changes |

### Bump Checklist
When changing any prompt or formula, before deploying:
- [ ] Version string bumped in `cacheVersions.js`
- [ ] Unit test updated to match new output shape
- [ ] Tests passing (`npm test`)
- [ ] Deployed to staging first

---

## 7. API Contract

> Write request/response shapes for every endpoint before writing any frontend JS. Frontend builds against the spec; backend implements the spec.

### Endpoints

```
POST /[endpoint]
Request:  { field: type, ... }
Response: { field: type, ... }
Errors:   400 | 401 | 429 | 500
```

`[FILL — add one block per endpoint]`

### Error Shape
`[FILL]` — Standardize the error response shape across all endpoints.
```js
{ error: string, code?: string }
```

### Worker URL Config
`[FILL]` — Single file owns the worker URL. All other files import from it.

> **[GASLAMAR]** `js/config.js`:
> ```js
> const WORKER_URL = hostname === 'gaslamar.com'
>   ? 'https://gaslamar-worker.carolineratuolivia.workers.dev'
>   : 'https://gaslamar-worker-staging.carolineratuolivia.workers.dev';
> ```
> After updating, run `npm run build` to rebundle. Never hardcode the URL in any other file.

---

## 8. Pricing & Tiers

`[FILL]`

| Tier | Price | Credits | TTL | Features |
|---|---|---|---|---|
| `[FILL]` | `[FILL]` | `[FILL]` | `[FILL]` | `[FILL]` |

> **[GASLAMAR]** All tiers are one-time purchases. No subscriptions. Credits do not renew. Tier names and prices are constants (`constants.js`) — never derive from client input. Server always overwrites client-supplied tier.

---

## 9. Design System

> Define tokens in Tailwind config before building any page. DESIGN.md and code will drift if they live separately.

### Color Tokens
`[FILL]`
```js
// tailwind.config.js → theme.extend.colors
colors: {
  primary:  '[FILL]',  // CTA only — one color, one job
  success:  '[FILL]',  // success signals only, never CTAs
  danger:   '[FILL]',  // errors only
  surface:  '[FILL]',  // light section backgrounds
  navy:     '[FILL]',  // dark section backgrounds
}
```

**Rules (write these down, not just in your head):**
- [ ] One CTA color only. Two different colors on primary buttons = bug.
- [ ] Accent = meaning, not decoration. Green = success. Red = error. Never swap for style.
- [ ] No purple/violet gradients unless they're a brand decision made here, now.
- [ ] `[FILL]` — add your own rules

> **[GASLAMAR]** `#1B4FE8` (blue) is the only CTA color. `#22C55E` (green) signals success only. Dark sections use `#0B1729` (navy), not generic grays. Light sections use `#F8FAFF`, not pure white. These were re-specified multiple times because they weren't encoded in config early enough.

### Typography
`[FILL]`
```
Heading font:   [FILL]
Body font:      [FILL]
Mono font:      [FILL] (or none)
Scale:          [FILL] (e.g. 12/14/16/20/24/32/48)
```

### Animation Policy
`[FILL]` — Write the policy explicitly. Undecided = every page looks different.

> **[GASLAMAR]** Functional only. No looping animations. No scroll-triggered effects beyond hero entrance. Approved animations:
> - Hero entrance: fade-up with stagger (0.7s)
> - Score ring: stroke animation on load (1.4s)
> - Button: hover shine sweep (0.55s)
> - State transitions: opacity fade

### Spacing & Layout
`[FILL]`
```
Grid:           [FILL] (e.g. 12-col, 1440px max)
Section padding: [FILL]
Card padding:   [FILL]
Border radius:  [FILL]
```

---

## 10. Testing Strategy

> Set up tests before writing business logic. Pure JS stages are trivially testable.

### Test Files
`[FILL]`

| File | What It Tests |
|---|---|
| `pipeline.test.js` | Pure JS functions: scoring formulas, schema validation, matching logic |
| `worker.test.js` | Integration: route handling, session flow, webhook processing |
| `boundary.test.js` | Edge cases: empty inputs, malformed JSON, oversized payloads |

> **[GASLAMAR]** Uses Vitest. `cd worker && npm test` must pass before any deploy. Tests were added after the pipeline stabilized — should have been written first.

### Minimum Bar Before First Route
- [ ] Scoring formula has at least 3 unit tests (zero, mid, max input)
- [ ] Schema validation has a test for valid and invalid shape
- [ ] LLM stages: mock the call, test the validation/retry wrapper
- [ ] `npm test` passes from a clean clone

### LLM Output Testing Pattern
```js
// Mock the LLM call, test what wraps it
vi.mock('../src/claude.js', () => ({ callClaude: vi.fn() }));

test('retries once on malformed JSON', async () => {
  callClaude
    .mockResolvedValueOnce('not json')
    .mockResolvedValueOnce(JSON.stringify(validShape));
  const result = await extractStage(cv, jd, env);
  expect(result).toMatchObject(validShape);
  expect(callClaude).toHaveBeenCalledTimes(2);
});
```

---

## 11. Deployment Runbook

> Write the exact commands on day 1. "Wrong env deployed" is a configuration bug, not a code bug.

### Environments

| Env | Worker URL | Pages URL | Payment | Notes |
|---|---|---|---|---|
| Local | `localhost:[FILL]` | `localhost:3000` | sandbox | `RESEND_API_KEY` optional |
| Staging | `[FILL]` | `[FILL]` | sandbox | Auto-deploy on push |
| Production | `[FILL]` | `[FILL]` | live | Explicit command only |

### Deploy Commands
```bash
# Worker — staging (auto on push to main)
cd worker && npm run deploy:staging

# Worker — production (EXPLICIT ONLY — not bare `npm run deploy`)
cd worker && npm run deploy:prod

# Frontend
npm run build   # always build before testing or deploying
```

> **[GASLAMAR]** `npm run deploy` without `--env production` goes to sandbox, not prod. This caused at least one bad deploy. The prod command is `npm run deploy:prod` — named explicitly to prevent accidents.

### Pre-Deploy Checklist
- [ ] Cache version bumped if prompt or formula changed
- [ ] `npm test` passes
- [ ] Env vars present in `wrangler.toml` for target env
- [ ] Deployed to staging and manually tested first
- [ ] No hardcoded URLs or secrets in code

### Health Check
```bash
curl https://[your-worker-url]/health
# Expected: { status: 'ok', env: 'production' }
```

### Secrets (never commit these)
`[FILL]`
```
ANTHROPIC_API_KEY
PAYMENT_WEBHOOK_SECRET
RESEND_API_KEY        (optional — silent no-op if absent)
SESSION_SECRET
```

---

## 12. File & Folder Structure

> Decide this upfront. The non-obvious files are the ones that cause the most confusion.

### Worker
```
worker/src/
├── router.js               — HTTP route dispatcher (all routes live here)
├── constants.js            — pricing tiers, CORS origins, session TTLs
├── cacheVersions.js        — [NEW] all cache version strings, single source of truth
├── handlers/               — one file per endpoint
├── pipeline/               — pure JS stages + LLM call wrappers
├── prompts/                — LLM prompt templates
└── [infrastructure files]  — claude.js, email.js, sessions.js, rateLimit.js, etc.
```

> **[GASLAMAR]** Non-obvious file placement:
> - `analysis.js` owns cache key versions — not pipeline files
> - `tailoring.js` owns gen key prefixes — not prompt files
> - `roleProfiles.js` owns role scoring weights — not `score.js`
> - `hasil-guard.js` is a synchronous inline `<script>` — not bundled

### Frontend
```
js/
├── config.js               — worker URL (ONLY place to change it)
├── [feature].js            — one file per page/feature
└── dist/                   — gitignored, built by CI
css/
└── main.css                — merged output, gitignored
```

---

## 13. What Works — Proven Patterns From GasLamar

> These are not opinions. These are patterns that survived production use. Reuse them directly.

### Pipeline Architecture
The 6-stage pipeline pattern eliminates hallucination in scoring and enables reliable caching:
```
1. EXTRACT   (LLM)     — verbatim structured data, cached 24h
2. ANALYZE   (JS)      — matching, format detection, archetype
3. SCORE     (JS)      — formula → dimensions + verdict, deterministic
4. DIAGNOSE  (LLM)     — human explanation, read-only vs. scores
5. REWRITE   (LLM)     — content generation
6. VALIDATE  (JS)      — schema check + 1 retry after every LLM call
```
Reuse this pattern for any app where LLM output needs to be deterministic or auditable.

### Validation + Retry Wrapper
Every LLM call should be wrapped in: call → validate schema → on failure: retry once with correction hint → on second failure: throw.
```js
async function callWithRetry(prompt, schema, env) {
  const result = await callClaude(prompt, env);
  if (isValid(result, schema)) return result;
  const corrected = await callClaude(prompt + correctionHint(result), env);
  if (isValid(corrected, schema)) return corrected;
  throw new Error('LLM output failed validation after retry');
}
```

### Session Pattern (no-login SaaS)
Works well for pay-per-use tools where creating accounts is friction:
- UUID: `sess_<crypto.randomUUID()>`
- Stored in KV, returned as HTTP-only session cookie
- Status flow: `pending → paid → generating → [deleted]`
- Deletion on exhaustion: zero credits = KV entry deleted, can't be replayed
- IP binding: tie compute keys to originating IP to prevent cross-device abuse

### Two-Tier LLM Model Strategy
Use the cheap/fast model (Haiku) for mechanical tasks (extraction, structured output). Use the capable model (Sonnet/Opus) for judgment tasks (diagnosis, nuanced rewriting). Apply this split per-stage, not per-app.

### Distributed Lock Pattern
Before any expensive or state-mutating server operation:
```js
const lockKey = `lock_${sessionId}`;
const existing = await env.KV.get(lockKey);
if (existing) return new Response('locked', { status: 409 });
await env.KV.put(lockKey, '1', { expirationTtl: 120 });
try {
  // do work
} finally {
  await env.KV.delete(lockKey);
}
```
Use TTL as safety net, not primary unlock mechanism. Always delete in `finally`.

### Auth Guard Pattern (no-flash)
For pages that require authentication, the guard must run synchronously before any content renders:
```html
<!-- In <head>, before CSS, before any defer/async script -->
<script>
  (function() {
    const session = document.cookie.match(/session_id=([^;]+)/);
    if (!session) window.location.replace('/access.html');
  })();
</script>
```
Never bundle this script. Never add `defer` or `async`. Content flash = bad UX + security gap.

### Frontend Config Singleton
```js
// js/config.js — the only file that knows the worker URL
const WORKER_URL = ['gaslamar.com', 'www.gaslamar.com'].includes(location.hostname)
  ? 'https://your-worker.workers.dev'
  : 'https://your-worker-staging.workers.dev';
```
Every other JS file imports `WORKER_URL` from here. Staging vs prod is automatic based on hostname — no manual switching, no env flags.

### Webhook HMAC Verification
```js
async function verifyWebhook(body, signature, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const expected = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(body)
  );
  // Constant-time comparison — never use === for HMAC
  return timingSafeEqual(expected, hexToBuffer(signature));
}
```
Always verify before touching any state. Always constant-time compare.

### Vendor Library Self-Hosting
For any third-party JS library used in the browser: download and vendor it locally. CDN = supply chain risk. Keep vendored files in `/js/vendor/`, gitignore built output, copy via build script.

### Magic Byte File Validation
```js
const bytes = new Uint8Array(await file.arrayBuffer());
const isPDF  = bytes[0] === 0x25 && bytes[1] === 0x50; // %P
const isDOCX = bytes[0] === 0x50 && bytes[1] === 0x4B; // PK
```
Never trust `file.type` (client-supplied). Always validate at the byte level server-side.

---

## 14. Pre-Build Checklist

> Do not write the first route until every box is checked.

### Architecture
- [ ] Determinism boundary drawn (LLM zone vs. code zone)
- [ ] Pipeline stages defined with inputs/outputs
- [ ] `cacheVersions.js` created with v1 for every stage
- [ ] LLM models assigned per stage (fast vs. capable)

### Security
- [ ] Where tier/credits live (server KV only)
- [ ] Payment confirmation mechanism (HMAC webhook)
- [ ] Anti-replay mechanism (one-time token + delete on use)
- [ ] Race-condition lock strategy (distributed lock + TTL)
- [ ] Client trust boundary explicit (client storage = display only)

### User Flow
- [ ] State machine written (all states + transitions)
- [ ] Per-state contract table filled (KV, sessionStorage, page access)
- [ ] Page map defined
- [ ] Auth guard strategy decided (sync script, not bundled)

### Design
- [ ] Color tokens defined in Tailwind config (not just prose doc)
- [ ] One CTA color named explicitly
- [ ] Animation policy written
- [ ] Typography scale defined

### API
- [ ] All endpoints listed with request/response shapes
- [ ] Error shape standardized
- [ ] Worker URL config file created

### Dev Setup
- [ ] `cacheVersions.js` created
- [ ] `vitest` installed, `npm test` works from clean clone
- [ ] At least one test per pure JS stage
- [ ] Deploy commands named to prevent wrong-env accidents
- [ ] Secrets documented (never committed)
- [ ] Health check endpoint planned

---

*Template version: 1.0 — built from GasLamar retrospective, 2026-05-04*
