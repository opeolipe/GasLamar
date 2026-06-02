## Moving sessionStorage tokens to HttpOnly cookies: transition checklist (2026-06-01)

When migrating a client-readable token (e.g. `gaslamar_cv_key`) to an HttpOnly cookie:

1. **Backend first**: add `makeFooCookie()` / `getfooFromCookie()` helpers in `cookies.js`.
   Each endpoint that used the token must: read cookie first → fall back to old param/body.
   This keeps old sessions working until their TTL expires.

2. **Server response change**: stop returning the token in the JSON body — set it via
   `Set-Cookie` instead. This is the main XSS-prevention step.

3. **Frontend analyze call**: add `credentials:'include'` so the browser saves the cookie
   from the cross-origin response. Without this, Set-Cookie is silently discarded.

4. **Remove storage writes**: delete every `sessionStorage.setItem('gaslamar_cv_key', ...)`.
   Keep the key in the storage CLEAR list so stale legacy values are cleaned up on new uploads.

5. **Guards that check the token synchronously** (inline `<script>` in `<head>`) cannot read
   httpOnly cookies. Simplify them to check only the non-sensitive timestamp (`analyze_time`);
   real auth is now server-side. Update both the source file AND the minified inline copy.

6. **Backward compat**: frontend should include the legacy key from storage as a query/body
   fallback for endpoints that still support it. New sessions send nothing — just the cookie.

7. **Tests**: parse the cv_key from the `Set-Cookie` header (not the response body) to use in
   subsequent KV lookups. Add new tests for the cookie path alongside existing param-path tests.

8. **Grep check before shipping**:
   `grep -r "setItem.*gaslamar_cv_key"` — must return nothing.
   `grep -r "cv_text_key.*:" worker/src/handlers/analyze.js` — must return nothing in return value.

---

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

---

## External tester false positives — know what the real invariants are (2026-05-31)

An external QA report filed four "critical bugs" that were all testing errors or design misunderstandings:

**1. "Terlalu singkat 1.500 karakter" despite claimed 7,962 chars**
The error in `Upload.tsx handleSubmit` fires only when `cvMissing = !hasFile` AND `cvTab === 'paste'` AND paste text is non-empty. `hasFile` is `false` only when paste text is trimmed to < 1,500 chars. For 7,962 non-whitespace chars the code sets `cvText` and `fileName`, making `hasFile = true` and blocking this error path. The tester's "7,962 chars" was likely whitespace-heavy text, wrong field, or an inaccurate count. Code is correct.

**2. "Session not found" after "23h 59m active" banner**
`sessionStorage` is tab-scoped. The "active session" banner in Upload.tsx reads `gaslamar_cv_key` / `gaslamar_analyze_time` from the current tab's sessionStorage. Navigating to hasil.html in a *new tab* loses those keys — hence "session not found". Alternatively, the 24h server KV expired 1-2 minutes before the 24h client countdown reached zero (clock skew). Both are by-design behaviors, not bugs. Code is correct.

**3. "IDOR vulnerability" in client-side session storage**
`gaslamar_cv_key` contains a `cvtext_` prefix + 256-bit (64 hex chars) cryptographically random token. The server validates `^cvtext_[0-9a-f]{64}$` and requires the token to exist in KV. Enumeration of the 2²⁵⁶ space is computationally impossible. Not a vulnerability.

**4. "No session token in client storage"**
The tester looked for a key named `session_token` or `server_session_id`. The actual token is stored under `gaslamar_cv_key` (value = `cvtext_<64-hex>`). The paid-session cookie is an HttpOnly cookie and intentionally not visible in DevTools → Storage → SessionStorage. Not a bug.

**Verification approach for future QA disputes:**
- Run `cd worker && npm test` — all 565 tests must pass
- Check sessionStorage in the SAME tab the analysis ran in (not a new tab)
- Confirm character count using `.trim().length`, not `.length` — whitespace-heavy text may count high but trim low
- Paid session token is an HttpOnly cookie; check DevTools → Application → Cookies, not sessionStorage

---

## "Contoh" button must call onChange, not just show text (2026-06-01)

Any UI element that inserts text into a React-controlled textarea must call the `onChange` prop (or the parent's state setter), not set `el.value` directly. A button that only toggles display of example text never touches the controlled value, so the character counter, validation state, and submit button never update. Pattern: `onClick={() => { onChange(JD_EXAMPLE); setShowExample(false); }}`. The same applies to URL fetch completion — always call `onChange(text.slice(0, MAX_CHARS))` rather than assigning `el.value` and relying on the input event.

## URL-fetched text must be capped client-side before setJobDesc (2026-06-01)

When an API returns job description text that may exceed the field limit, cap it in the success handler before setting React state. Relying on the `maxLength` HTML attribute does not prevent programmatic over-length assignments — `setJobDesc(jd)` with `jd.length > 5000` sets state to the full length, making `overLimit=true` and silently disabling the submit button. Always cap: `const capped = jd.length > MAX ? jd.slice(0, MAX) : jd` and show a truncation status message when the cap fires.

---

## sessionStorage write order in useAnalysisPolling — critical keys must be written before large blobs

**Pattern:** `gaslamar_cv_key` and `gaslamar_analyze_time` were written AFTER `gaslamar_scoring` (lines 181-183 in `hooks/useAnalysisPolling.ts`). `gaslamar_scoring` is the largest write (several KB of JSON). If it throws `QuotaExceededError` (iOS Safari, low-storage devices), the outer catch block fires before the two small critical keys are written. This prevents the redirect to `hasil.html` and shows a generic "Terjadi kesalahan" error instead.

**Fix:** Always write small, guard-required keys first (`gaslamar_cv_key`, `gaslamar_analyze_time`), then wrap the large blob write in its own try-catch. The `gaslamar_scoring` write is non-critical — `useResultData.ts` already has a `GET /get-scoring` server-side fallback for exactly this scenario.

**Rule:** In any success-path sessionStorage block, writes required to satisfy HTML inline guards or route conditions must come FIRST and must not be blocked by a preceding large write.

---

## "No session cookie after /analyze" is a false positive — the cookie is cv_key, not sessionToken (2026-06-01)

**Pattern:** External audit tools and AI-generated task descriptions sometimes report "backend does not set an HttpOnly session cookie after analysis" or "frontend stores session token in sessionStorage." Both are false for this codebase.

**Reality:**
- `/analyze` sets `cv_key` as an HttpOnly, Secure, SameSite=None cookie via `makeCvKeyCookie()` in `cookies.js`
- The frontend stores only `gaslamar_analyze_time` (a Unix timestamp, not a token) in sessionStorage
- `hasil-guard.js` reads only the timestamp; real auth is via the HttpOnly `cv_key` cookie sent automatically with `credentials: 'include'`
- SameSite=None is intentional — required for cross-origin staging (Pages → Worker subdomain); SameSite=Strict would break staging
- `/check-session` is for *payment* sessions (`sess_`). Analysis sessions are validated by `/validate-session` and `/get-scoring` using the `cv_key` cookie

**Verification when a report claims this bug:**
1. `grep -rn "setItem.*gaslamar_cv_key"` in `js/` → must return nothing
2. `grep -rn "cv_text_key.*:" worker/src/handlers/analyze.js` → must return nothing (token not in response body)
3. Check DevTools → Application → Cookies for `cv_key` after /analyze (not sessionStorage)
4. Run `cd worker && npm test` — all tests must pass

---

## QA false positives require automated regression tests, not just documentation (2026-06-01)

**Pattern:** Four false positives were filed in the same audit: aria-disabled on button, session token IDOR, JD maxlength bypass, CORS wildcard. Each was documented in lessons.md and the QA plan, but no automated test asserted the expected behavior. Documentation alone doesn't prevent the same finding being re-filed in a future audit.

**Rule:** Every false-positive finding must be closed with an automated test (Playwright or CI check), not just a doc update. If the behavior can be asserted in a Playwright test, add it. If it requires a deployed environment, add a CI step. If neither is feasible, add a manual regression checklist to the QA guidelines.

**Tests added (2026-06-01):**
- `aria-disabled` → `tests/e2e/upload-button-a11y.spec.ts` (3 tests)
- No auth tokens in client storage → `tests/e2e/security-invariants.spec.ts` (3 tests)
- JD maxlength programmatic enforcement → `tests/e2e/cv-flow.spec.ts` ("job description counter" test)
- CORS wildcard → `CORS security header check` step in `deploy.yml` and `deploy-staging.yml`
- Static asset CORS (no ACAO) → step [5] in both deploy workflows (upgraded from WARN to FAIL in prod)
- Stale staging deploy → `scripts/verify-staging-bundle.js` + CI step in `deploy-staging.yml`

## Session guard must not block on sessionStorage (2026-06-01)
- **Problem**: `hasil-guard.js` checked `gaslamar_analyze_time` in sessionStorage synchronously before page load. This is tab-scoped and can be absent (privacy modes, new tab, iOS Safari ITP, cleared by upload page).
- **Fix**: Remove the sessionStorage auth check from the guard. Auth is enforced via:
  1. Server-side: `router.js` checks `cv_key` HttpOnly cookie before serving `hasil.html` in production.
  2. Async: `/check-session` now validates `cv_key` cookie and returns `{valid:true, type:"analysis"}` for active analysis sessions; `useResultData` calls this as defense-in-depth.
- **Rule**: Never use sessionStorage as a gate for page access. Use HttpOnly cookies (server-side) or async API calls. The guard exists only to block forged URL parameters and sets `window.__hasilSessionError` for inline React error states.
- **Countdown UX**: `gaslamar_analyze_time` is still written to sessionStorage for the payment countdown timer — it is not a security token and its absence does not block access.

## Removing all sensitive data from sessionStorage (2026-06-01)

Pattern applied in the XSS/IDOR security fix:

1. **Never write scoring blobs client-side.** `GET /get-scoring` (cookie-auth) is the single
   source of truth. The fast-path sessionStorage cache saves one network round-trip but creates
   XSS exposure for the entire scoring payload. Remove it.

2. **result_id and cv_key stay in-memory.** analytics correlation across page loads is a
   nice-to-have; XSS-proof storage is a must. Use local variables or skip cross-page correlation.

3. **Raw CV text and extracted claims must never touch sessionStorage.** This includes:
   `gaslamar_cv_paste_raw`, `gaslamar_entitas_klaim`, `gaslamar_sample*`, `gaslamar_preview_after`.
   Accept the UX degradation (no paste draft persistence, no preview consistency).

4. **Derived numbers are OK.** Plain integer scores (`skor`, `skor_6d`, `gap` as strings) contain
   no CV content and no session token. These may be stored for the Download badge display.

5. **Client cv_key check before payment is a false gate.** For cookie-based sessions it always
   fails. Remove the check; the server already validates via the HttpOnly cookie.

6. **STALE_KEYS in Upload.tsx must list all keys ever written** — including legacy ones that
   are no longer written — so old-session data is swept on the next upload.

## Pattern: redirect loop from conflicting session notices

**Symptom:** `/hasil.html` server-redirects to `/upload.html?reason=no_session`, but Upload.tsx
also shows a "Lihat hasil →" banner because `gaslamar_analyze_time` is still in sessionStorage.
User clicks the banner → back to `/hasil.html` → same redirect → infinite loop.

**Fix:**
1. When `reason === 'no_session'` or `reason === 'session_expired'` lands on upload,
   immediately clear `gaslamar_analyze_time` from sessionStorage so the "Lihat hasil"
   banner does not render. Apply this in BOTH `pages/Upload.tsx` AND `js/upload-page.js`
   (the React bundle is canonical; the plain JS file is a belt-and-suspenders fallback).
2. Do NOT add the analyze_time notice when a no-session redirect reason is present —
   add the `isNoSessionRedirect` guard before the analyzeTime block.

**Rule:** Any path that shows "you have no session" must also clear the signal that would
show "you have an active session". Never let both states render simultaneously.

## Pattern: SameSite=None; Partitioned causes same-site cookie delivery issues

**Problem:** The `cv_key` cookie used `SameSite=None; Partitioned` (CHIPS) in all environments.
In production (gaslamar.com — fully same-site), the `Partitioned` attribute is a spec no-op but
some browsers misbehave: they may store the cookie with the `Partitioned` flag intact even in
a same-site context and then fail to match it on subsequent navigation requests.

**Fix:** Make `makeCvKeyCookie(cvKey, env)` environment-aware:
- Production: `SameSite=Strict` (no `Partitioned`) — safe because analyzing.html, /analyze,
  and /hasil.html are all on gaslamar.com; same-site navigation always sends Strict cookies.
- Staging/sandbox: `SameSite=None; Partitioned` unchanged — the frontend is on
  staging.gaslamar.pages.dev (different eTLD+1 from api-staging.gaslamar.com) so CHIPS
  is required for cross-site credential passing in Chrome 120+.

**Rule:** Don't apply cross-site cookie attributes (SameSite=None; Partitioned) to same-site
deployments. Detect via `env.ENVIRONMENT === 'production'` and use Strict there.
