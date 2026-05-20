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
