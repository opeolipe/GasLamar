## cvtext_ key format must be `cvtext_[0-9a-f]{64}` everywhere (2026-05-23)

Any code path that accepts a user-supplied `cvtext_*` key must validate the strict format `^cvtext_[0-9a-f]{64}$` — not just `startsWith('cvtext_')` or a length cap. The production `/analyze` handler generates these keys with `hexToken(32)` (64 lowercase hex chars). Three endpoints (`createPayment`, `validateSession`, `bypassPayment`) previously accepted arbitrary strings, which could silently fail at Cloudflare KV's 512-byte key limit or accept malformed keys. Test helpers that seed `cvtext_` keys must also use the correct format (32 random bytes as hex) — never `crypto.randomUUID()`, which produces a UUID with hyphens that breaks the validation.

---

## Rate limiting must precede all KV reads (2026-05-23)

Always apply rate limiting before any KV reads in handlers. If rate limiting comes after session lookups (as it did in `resendEmail.js`), every request in a flood pays the full KV cost before being blocked. The correct order: (1) rate limit by IP, (2) authenticate via cookie, (3) do KV work. Unauthenticated endpoints (`validateSession`, `getScoring`) are especially important — they must rate-limit before the KV call or become cheap amplification targets.

---

## generate.js lock TTL must exceed the worst-case generation time (2026-05-23)

The session lock in `generate.js` (`lock_<session_id>`) was 60s but documented as 120s. Parallel Claude tailoring (ID + EN) can run >60s on slow networks or large CVs. If the lock expires before generation completes, a concurrent retry can slip through and double-generate. Always set the TTL to at least 120s (the documented value).

---

## /validate-session 404 is not a bug (2026-05-21)

`GET /validate-session?cvKey=cvtext_<token>` returns 404 when the KV entry is not found — this is correct, expected behavior (cvtext_ entries expire after 24h). Do not treat this as a broken endpoint. Testing with a stale or manually constructed key will always 404. Similarly, `/create-payment` returns 400 (`cv_expired`) when the cvtext_ key has expired — also correct, not a bug. Both errors mean "start a new session," not "the API is down."

Session tokens are in an HttpOnly cookie, never in sessionStorage. `gaslamar_has_session=1` in localStorage is a non-sensitive routing flag only — it is not the session token.

---

## Scoring false positives from Indonesian CV artefacts (2026-05-11)

Education degree codes (D1, D3, S1, S2, S3) and bare career-tenure strings ("14 tahun pengalaman") are not achievement metrics. LLMs regularly include them in `angka_di_cv` despite prompt instructions, because the examples and exclusion list were incomplete.

**Patterns to guard against:**
- `angka_di_cv` containing degree codes → `has_numbers = true` → `portfolio` inflated to 5+
- `angka_di_cv` containing inferred tenure like "14 tahun pengalaman" → same inflation
- `sertifikat` containing formal education ("D1 Business Mgmt") → `has_certs = true` → `portfolio += 2`
- `sertifikat = null` (LLM omits field) → `null !== 'TIDAK ADA'` → `has_certs = true`

**Fixes needed every time the extract prompt or analyze.js changes:**
1. Bump `EXTRACT_CACHE_VERSION` AND `ANALYSIS_CACHE_VERSION` — they are independent cache tiers. Missing ANALYSIS_CACHE_VERSION means returning users get stale scores from the old logic forever (until 48h TTL).
2. Add stripping in `stripNonAchievementNumbers` as defence-in-depth even after tightening the prompt — LLMs drift.
3. Coerce null/missing `sertifikat`/`entitas_klaim` in `validateExtractOutput()` before any downstream code touches them.

---

## Lesson: Update ALL tests when removing a legacy code path

**Pattern:** When a refactor removes a handler path (e.g., the `?session=` URL fallback in
`mayarWebhook.js`), search for every test that exercises that path — not just the ones that
obviously reference it by name. A commit message saying "updated three webhook tests" can
still miss a fourth test that was named differently but relied on the same mechanism.

**Check:** After any removal, run `grep` against the test file for the deleted mechanism
(e.g., `?session=`, `redirect_url.*sess_`) to confirm zero remaining usages.

---

## Lesson: Standard PDF fonts in Cloudflare Workers need Latin-1 sanitization

**Pattern:** `pdf-lib` standard fonts (Helvetica, Times-Roman) only cover Latin-1 (ISO-8859-1).
LLM-generated Indonesian text may include characters outside that range: em-dash (—), smart
quotes (""), ellipsis (…), etc. Passing these to `page.drawText()` silently drops or corrupts
glyphs.

**Fix:** Sanitize text before rendering: replace common Unicode punctuation with ASCII
equivalents and strip anything above `\xFF`. See `worker/src/interviewKitPdf.js` → `sanitize()`.

---

## Lesson: GET requests cannot have a body (Fetch API spec)

**Pattern:** `fetch(url, { method: 'GET', body: JSON.stringify({...}) })` throws
`TypeError: Request with GET/HEAD method cannot have body` in any Fetch-spec-compliant
environment (browsers, Cloudflare Workers, Node 18+).

Some API docs (including Mayar's `GET /coupon/validate`) show curl examples with
`--data` on a GET. curl allows this, but JavaScript `fetch()` does not. The error
is caught silently and returns a degraded response, making it hard to detect.

**Fix:** For GET endpoints that expect body params, switch to query string:
`fetch(\`\${url}?\${new URLSearchParams(params)}\`, { method: 'GET', headers })`

**Check:** Any `fetch()` call with `method: 'GET'` AND `body:` is a latent bug.
Grep: `method.*GET.*body|body.*method.*GET`

---

## Lesson: Mayar invoice creation rejects unknown fields (risk)

**Pattern:** Adding an undocumented field (e.g. `couponCode`) to Mayar's
`/invoice/create` or `/payment/create` body might cause a 400 error. Since
`createMayarInvoice` only falls back to the next endpoint on 404, a 400 would
surface as "Gagal membuat invoice" for all coupon users — a silent regression.

**Rule:** Only send fields documented in Mayar's API spec to invoice/payment
creation endpoints. Coupon codes are applied by the user on Mayar's own checkout
page — do not forward them in the invoice body.

---

## Lesson: IDR price strings contain '0' — price assertions need specificity

**Pattern:** `expect(el).not.toContainText('0')` is always false when the element
displays an IDR price like "Bayar Rp 59.000 →" (toLocaleString('id-ID') uses
period as thousands separator). Every price above 999 IDR contains '0'.

**Fix:** Assert the full price string: `toContainText('59.000')` or
`not.toContainText('Rp 0 ')` (with trailing space to avoid matching '29.000', etc.)

## Session state exhausted vs delete (2026-05-10)
When the last credit is consumed, mark session `exhausted` instead of deleting it.
- /check-session returns `{ status: 'exhausted' }` instead of 404 — client can distinguish "used up" from "expired/not found"
- cv_result_ and kit_ KV entries have their own TTLs so /get-result still works
- Any test expecting `session === null` after last-credit use must be updated to expect `status: 'exhausted'`
- Backward compat: old sessions with `status: 'pending'` are handled alongside new `'pending_payment'` in webhook guard

## Server-side scoring snapshot (2026-05-10)
Store scoring in cvtext_ KV entry at /analyze time; serve via GET /get-scoring.
- analyzing-page.js no longer stores gaslamar_scoring blob in sessionStorage
- scoring.js fetches from /get-scoring; falls back to legacy sessionStorage blob for old sessions
- hasil-guard.js simplified — no scoring blob validation; just checks cv_text_key format + analyze_time
- Security: /get-scoring returns only the scoring portion, never cv_text or job_desc

## Session ID must not appear in URL query parameters (2026-05-19)

Passing `?session=sess_...` to GET endpoints leaks session IDs into browser history, server logs,
and Referer headers on any subsequent navigation. Even a "reduced metadata" fallback path carries risk.

**Pattern to use instead:**
- Send session ID in a custom request header: `'X-Session-Id': sessionId`
- Register the header in CORS config: `'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id'`
- Server reads `request.headers.get('X-Session-Id') || url.searchParams.get('session')` — the query param fallback can stay temporarily for rollout compat, then be removed
- `gaslamar_session` in localStorage is a UI pointer only (auth is the HttpOnly cookie) — it is acceptable there, but must never be URL-encoded into a GET query string

## Session expiration: redirect vs inline error state (2026-05-20)

When a session/key expires mid-flow (e.g. cv_text_key expires while user is on hasil.html),
prefer a `window.location.replace('upload.html?reason=cv_expired')` redirect over showing
an inline error state. Inline errors:
- Leave the page in an ambiguous half-dead state (pay button disabled, rest of page still rendered)
- Can be indexed by crawlers as valid content even with noindex meta tags (meta tags require JS to be honoured)
- Confuse users about whether the error is transient or permanent

**Pattern:**
- Error handler calls `window.location.replace('upload.html?reason=<specific_reason>')`
- upload-page.js and upload.js check `params.get('reason')` and show a contextual banner
- Use distinct reason values (`cv_expired` vs `session_expired` vs `no_session`) for accurate messaging

**HTTP status for display-only endpoints:**
- Endpoints that check freshness (e.g. `/validate-session`) must return 404 (not 200) when the
  key is not found — returning 200 with `{valid: false}` is semantically wrong and hides errors
  from monitoring tools that alert on 4xx rates

---

## sendBeacon CORS preflight causes silent log drops and misattributed 405 errors (2026-05-20)

`navigator.sendBeacon(url, Blob({ type: 'application/json' }))` triggers a CORS preflight OPTIONS
before every POST. If that preflight races, times out, or hits a transient network error the
actual POST is never sent. Some monitoring tools attribute the `sendBeacon` failure to the current
page URL rather than the target API URL — producing a spurious 405 on the Pages domain.

**Fix:** Pass a plain string to `sendBeacon`. The browser then sends `Content-Type: text/plain;charset=UTF-8`
which is a CORS "simple" request: no preflight needed, the worker always receives the request even
before CORS response headers are evaluated.

**Corollary:** The worker's body parser for fire-and-forget logging endpoints should accept both
`application/json` and `text/plain` and try to JSON-parse either one, falling back to `{ raw: bodyText }`.

## logger.ts must import WORKER_URL from sessionUtils, not uploadValidation (2026-05-20)

`uploadValidation.ts` exports a `WORKER_URL` evaluated purely at runtime (hostname check).
`sessionUtils.ts` re-exports it but also layers in the `IS_SANDBOX` **build-time** define.
All React API calls use `sessionUtils.WORKER_URL`. Using `uploadValidation.WORKER_URL` in
`logger.ts` bypasses `IS_SANDBOX` — correct in most deployments but wrong if the staging
build runs on a non-staging hostname. Keep all WORKER_URL imports from `sessionUtils`.

## worker npm audit: dev-only vulns — upgrade requires a separate test-validated PR (2026-05-20)

`worker/` has 11 vulnerabilities (4 high, 7 moderate) all in dev test tooling:
`defu`, `devalue`, `esbuild`, `vite`, `vitest`, `wrangler`, `miniflare`, `ws`, `undici`.
None of these packages execute in the production Cloudflare Worker; they are test-only.

- `esbuild` CORS bypass → affects `--serve` mode only, not production builds
- `defu`/`devalue` prototype pollution → affects vitest test execution environment only
- `ws` uninitialized memory → affects local wrangler dev server only

`npm audit fix --force` installs `@cloudflare/vitest-pool-workers@0.16.7` (breaking change)
which breaks the vitest startup (vite config load fails). Fix must be:
1. Upgrade `@cloudflare/vitest-pool-workers` to latest that works
2. Update `vitest.config.js` for API changes in the new version
3. Verify all 504 tests still pass
4. Commit in an isolated PR so any regression is isolated from feature work

---

## Cloudflare Worker workers_dev must be explicit in named environments (2026-05-20)

When a Cloudflare Worker uses a named environment (`[env.production]`) with custom `routes`,
the `workers_dev` subdomain is controlled independently. Leaving it unset caused the
`gaslamar-worker.carolineratuolivia.workers.dev/health` URL to return a Cloudflare
HTML "Page not found" even though the `/health` handler existed in the code.

**Symptoms that distinguish this from a missing handler:**
- Response is HTML "Page not found", not our JSON `{ message: 'Not found' }` → the
  worker itself is unreachable, not just the route
- All tests pass locally — the handler is correct, it's a deployment config issue

**Fix pattern:**
```toml
[env.production]
name = "gaslamar-worker"
workers_dev = true   # required for gaslamar-worker.*.workers.dev to respond
routes = [...]

[env.staging]
name = "gaslamar-worker-staging"
workers_dev = false  # staging is only accessible via its custom route
routes = [...]
```

**Also:** Health endpoints must handle `HEAD` alongside `GET` — many uptime monitors
default to HEAD requests. The Cloudflare runtime strips the body automatically; no
special handling needed beyond extending the method check.

```javascript
// router.js — correct pattern
if ((method === 'GET' || method === 'HEAD') && pathname === '/health') {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }, 200, request, env);
}
```

---

## evaluateJDQuality min-length must equal backend threshold (2026-05-20)

Frontend `evaluateJDQuality` used `< 80` chars as the minimum, while the backend
`/analyze` handler rejects at `< 100` chars. Users with 80–99 char JDs saw
"✓ Job description siap" on the upload page but got a backend error on analyzing.html.

Fix: changed the threshold in `evaluateJDQuality` to import and use `MIN_JD_LENGTH`
from `uploadValidation.ts` (= 100), so both sides agree.

## evaluateJDQuality keyword check must be advisory, not a hard blocker (2026-05-20)

The `hasStructure` keyword check in `evaluateJDQuality` returned `isValid: false`
for JDs that lacked specific terms ("kualifikasi", "skill", etc.). This blocked form
submission for valid JDs that simply omitted those exact keywords. The backend has no
keyword requirement — it accepts any JD with ≥ 100 chars.

Fix: the keyword check now returns `{ isValid: true, message: '…advisory…' }` so
the amber warning still appears in `JobDescriptionInput` but submission is not blocked.

## download-guard.js broken by payment.js removing localStorage write (2026-05-20)

After a payment refactor that moved the session credential to an HttpOnly cookie only, `payment.js` stopped writing `session_id` to `localStorage.gaslamar_session`. The comment read "intentionally not persisted to client storage." But `download-guard.js` (a blocking synchronous script that can't read HttpOnly cookies) still required `localStorage.gaslamar_session` to allow Path 2 (normal post-payment flow). Result: Mayar's redirect to `/download.html` always triggered `window.location.replace('/')`.

**Pattern to remember:**
- The download-guard is a JS-only gate — it cannot inspect HttpOnly cookies.
- If the auth model changes (cookie vs. localStorage), the guard must be updated in the same commit.
- `localStorage.gaslamar_session` is a *passkey for the guard*, not a *credential for the server*. The HttpOnly cookie is the credential; the localStorage key just tells the guard "the user arrived from a legit payment flow."
- A misleading comment ("legacy key, no longer written") on the `clearClientSessionData` call masked that the localStorage write was still necessary.

**Fix:** `payment.js` now extracts `session_id` from the `/create-payment` response and writes it to `localStorage.gaslamar_session` before redirecting to Mayar. The HttpOnly cookie remains the sole server-side credential.

---

## Payment redirect — scoring snapshot and sessionStorage guard

**Pattern:** When `POST /create-payment` succeeds, it deletes the `cvtext_` KV entry to prevent
re-use. If the user then cancels at Mayar and navigates back to `/hasil`, two things fail:
1. `hasil-guard.js` finds `gaslamar_cv_key` missing from sessionStorage → redirects to upload
   with "session expired" error. (Cause: `payment.js` was explicitly clearing the key.)
2. Even if the guard passes, `GET /get-scoring` returns 404 because the KV entry is gone.

**Fix:**
- `payment.js`: do NOT remove `gaslamar_cv_key` from sessionStorage on payment initiation.
  The KV entry is already deleted server-side; keeping the sessionStorage key is harmless
  and lets the guard pass on return.
- `createPayment.js`: before deleting `cvtext_`, preserve `stored.scoring` under `scoring_<token>`
  with 24h TTL. Failure is non-critical — suppress with `.catch()` so payment proceeds.
- `getScoring.js`: when `cvtext_<token>` is not found, fall back to `scoring_<token>`.
  Returns the same `{ valid: true, scoring }` response; never exposes cv_text/job_desc/ip.

**Rule:** Any time a short-lived KV entry is deleted as part of state advancement (single-use
consumption), check whether any subsequent user action legitimately needs data from that entry.
If so, preserve the needed subset under a separate key before deleting.

---

## Frontend freshness TTL must always match backend KV expirationTtl (2026-05-21)

`analyze.js` stores the `cvtext_` KV entry with `expirationTtl: 86400` (24 h).
Four frontend files historically used **7200** (2 h) as the freshness window:
- `js/hasil-guard.js` (`SESSION_SECS`)
- `js/hasil-page.js` (`SESSION_SECS`)
- `js/analyzing-page.js` (inline `7200000` ms literal)
- `js/session-controller.js` (`ANALYSIS_FRESHNESS_MS`)

The mismatch caused:
- Pay button disabled after 2 h even though backend accepts payment for 22 more hours
- `hasil-guard.js` redirecting to `access.html?expired=1` prematurely (user saw "sesi habis")
- `analyzing-page.js` routing back to `upload.html` instead of `hasil.html` for returning users

**Rule:** Keep one canonical backend TTL in `analyze.js`. All frontend freshness checks
must be updated atomically whenever that value changes. The comment in `session-controller.js`
`ANALYSIS_FRESHNESS_MS must match … the KV TTL` is the canonical sync signal — trust the
backend TTL, not the comment's stated value.

---

## Mayar sandbox webhook: allow through when NO auth header is sent (2026-05-21)

When staging has `MAYAR_WEBHOOK_SECRET` set AND Mayar sandbox sends its webhook with
**no** `x-callback-token` or `x-mayar-signature` header, the original code fell through
to the HMAC check which returned `{valid: false}` → 401. The webhook was silently dropped
and the session was never marked paid.

**Flow before fix:**
1. `isSandbox = true`, secret set → skips `!secret` early return
2. `callbackToken === null` → does NOT return in sandbox branch
3. Falls through to HMAC block → `!signature` → `{ valid: false }` → 401

**Fix pattern (in `verifyMayarWebhook`):**
```
if (isSandbox) {
  if (callbackToken !== null) { verify and return; }
  const hasSig = !!(x-mayar-signature header);
  if (!hasSig) {
    console.warn('webhook_sandbox_no_auth_header');
    return { valid: true, body };          ← allow when nothing was sent
  }
  // hasSig → fall through to HMAC (wrong sig still rejected)
}
```

**Key distinction:**
- Header **absent** → cannot verify → allow (sandbox only, with warning)
- Header **present but wrong** → HMAC fails → reject (both sandbox and production)

**Test coverage:** Add `verifyMayarWebhook` unit tests for both the new "absent" path
and a regression test confirming wrong values are still rejected even in sandbox.
