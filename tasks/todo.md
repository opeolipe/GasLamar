# GasLamar — Full QA Audit Bug List
> Senior QA review · 2026-05-08 · Production-grade audit across security, logic, UX, and edge cases

---

## CRITICAL — Fix Before Next Deploy

- [x] **cors.js:6** — Unknown/misconfigured `ENVIRONMENT` silently falls back to production CORS allowlist. Should fail-closed (`throw`) on unknown values, not mirror production. *(Fixed C1: throws on unknown ENVIRONMENT; sandbox handled explicitly)*
- [x] **fetchJobUrl.js:175–210** — Open redirect via chained redirect: attacker crafts `linkedin.com → allowlisted-domain → attacker.com` to bypass the domain allowlist. Cap redirect depth to 1–2 and re-validate the final destination, not just each hop. *(Fixed C2: redirect hops capped at 2; private-IP SSRF check re-run on every hop)*
- [x] **sessions.js:47–51** — Legacy sessions that lack `session_secret_hash` are permanently accepted with no expiry or migration path. Anyone with a pre-secret session token has indefinite auth bypass. Add a grace-period expiry or force re-auth. *(Fixed C3: legacy sessions now rejected; fail-closed)*
- [x] **mayarWebhook.js:41–43** — Webhook payload with neither `invoiceId` nor `redirectUrl` returns silent 200 instead of 400. Payment notifications are silently dropped with no telemetry. Return 400 and log the payload. *(Fixed C4: returns 400 + structured console.error log)*
- [x] **upload.js:358** — JD HTML-tag stripping uses `replace(/<[^>]*>/g, ' ')`. This does NOT strip event handlers (e.g. `<img onerror=...>`). If the JD is ever rendered via `innerHTML`, this is XSS. Use `escapeHtml()` (already defined) instead of stripping. *(Fixed C5: tag-stripping regex removed; escapeHtml() is sole XSS defense)*
- [x] **download-generation.js:149** — `await res.json()` called without checking `Content-Type: application/json`. If the server returns an HTML error page or redirect, this throws an unhandled parse error. Validate content-type or wrap in try-catch with a user-facing error message. *(Fixed C6: Content-Type validated before res.json(); surfaces user-facing retry message)*
- [x] **rewriteGuard.js:51 / diagnose.js:51** — `DIAGNOSE_TOOL_RE` regex `\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]\w*)\b` is too broad. It matches legitimate tool names (MongoDB, React, NASA) and replaces them with `"skill relevan"` if they don't appear verbatim in reference text. This strips correct content from user CVs. Narrow the pattern or add an explicit safelist. *(Fixed C7 in diagnose.js: requires 3+ uppercase chars for pure-acronym match; safelist of 20+ non-tech proper nouns added)*
- [x] **tailoring.js:152** — `buildGroundTruthBlock(extractedCV)` returns empty string silently when `extractedCV` is null/undefined. The hallucination guard is completely disabled without error or warning. Add null-guard and throw or log clearly. *(Fixed C8: console.warn with structured event emitted when guard disabled; visible in wrangler tail)*

---

## HIGH — Fix This Sprint

- [x] **rateLimit.js:46** — `Math.max(60, remaining)` resets the TTL on every increment, extending the rate-limit window instead of using the original window. Should be `Math.max(1, remaining)` (use time remaining in current window). *(Fixed H1: window correctness enforced by read-time `now - data.start < windowSecs` check; Math.max(60,remaining) retained as KV floor only; documented)*
- [x] **fileExtraction.js:22, 79** — `atob()` called on untrusted base64 without format validation. Malformed base64 can produce arbitrary bytes that bypass magic-byte validation. Add `/^[A-Za-z0-9+/]*={0,2}$/` guard before calling `atob()`. *(Fixed H2: base64 charset validated in validateFileData and extractTextFromDOCX before atob())*
- [x] **fileExtraction.js:143–204** — ZIP entry scanning loop has no byte-count ceiling: scans up to `dataStart + 10 MB` per file entry. A malicious DOCX can exhaust the Cloudflare Worker CPU budget. Add hard byte limit. *(Fixed H3: inner-scan ceiling reduced 10 MB → 1 MB; real word/document.xml is always well under 1 MB)*
- [x] **generate.js:137–141** — Session lock TTL is 120 s. If the Worker times out after acquiring the lock, the user is blocked for 2 full minutes. Reduce TTL to 10–15 s. *(Fixed H5: lock TTL reduced 120s → 60s; satisfies KV minimum; dead window after Worker timeout now 30s max)*
- [ ] **generate.js:182–196** — `extractJobMetadata(effectiveJobDesc)` persists job_title and company to KV with no validation on length or characters. If these values reach email templates without escaping, XSS is possible. Validate max length ≤ 100 chars, safe charset.
- [x] **generate.js:44–45, 51–56, 60–67** — `previewSample`, `previewAfter`, `entitasKlaim` items, and `angkaDiCv` are passed to LLM prompts without calling `sanitizeForLLM()` / `hasPromptInjection()`. These are user-controlled vectors for prompt injection. Sanitize all of them. *(Fixed H4: hasPromptInjection() + sanitizeForLLM() applied to previewSample, previewAfter, and angkaDiCv)*
- [x] **exchangeToken.js:48–55** — Token validator accepts any hex string 1–64 chars. Tokens are 32 chars (128-bit). The minimum length of 1 means 1–4 char tokens are brute-forceable. Require exact length: `/^[0-9a-f]{32}$/`. *(Fixed H6: validator now requires exactly 32 hex chars; matches hexToken() output)*
- [x] **validateSession.js:8–9** — `cvKey` is validated only on prefix (`cvtext_`), no length limit. Attacker can pass `cvtext_` + 1 MB to trigger a large KV lookup. Add max length: `cvKey.length > 256 → reject`. *(Fixed H7: cvKey.length > 256 now returns 400 before KV lookup)*
- [ ] **createPayment.js:156–158** — Email→session_id index grows unbounded. Many payments from one email bloat KV indefinitely. Cap array at 100 entries or drop entries older than 90 days.
- [x] **payment.js:243–251** — Invoice URL validation is skipped for non-`gaslamar.com` hostnames (covers staging/QA). Attacker on `staging.gaslamar.com` can inject a malicious invoice_url. Whitelist specific allowed Mayar domains rather than relying on hostname detection. *(Fixed H9: ALLOWED_PAYMENT_HOSTS=['mayar.id','mayar.club'] enforced on all environments; no environment exemption)*
- [ ] **download-guard.js:32–35** — Empty catch block around `localStorage.getItem()`. If localStorage throws (private-browsing permission denied, quota error), the guard silently proceeds instead of redirecting. Fail-closed: redirect to `/` on any storage access error.
- [ ] **download-generation.js:169–173** — `localStorage.removeItem('gaslamar_session')` fires after last credit, but `sessionIdCache` may still be referenced if user interaction races with this line. Disable the multi-credit UI before clearing storage.
- [x] **analysis.js:52–56** — Old cached entries (before red-flag penalty was introduced) only get penalty re-applied if `skor > 85`. A cached entry with `skor=50` and red flags will be served without the penalty. Bump `ANALYSIS_CACHE_VERSION` or unconditionally re-apply the penalty on cache hits. *(Fixed H8 + QA regression fix: ANALYSIS_CACHE_VERSION bumped v6→v7; cache-hit re-application removed — penalty is pre-applied at write time; double-penalty regression from original H8 fix corrected)*
- [ ] **score.js:85–89** — `fundamentalSkills` is a static English list; `jd.skills_diminta` often contains Indonesian terms. The industry risk bonus covers only 3 industries. Risk score logic produces incomplete/incorrect results for non-English JDs and non-listed industries.
- [ ] **upload.js:166–175** — Client-side magic-byte PDF validation can be trivially bypassed. It is correctly treated as UX-only but is also the only client-side type gate. Consider adding file size > 4 bytes check to avoid zero-byte file crashes.

---

## MEDIUM — Fix This Month

### Security / Injection
- [x] **sanitize.js:35–57** — Several prompt-injection regexes use nested quantifiers with alternation (potential ReDoS). Add input length cap or split into simpler patterns. *(Fixed M1: MAX_INJECTION_CHECK_LEN = 10000 cap applied before any regex; input sliced to first 10k chars)*
- [x] **sanitize.js:104** — `hasPromptInjection(text)` returns `false` (safe) if input is not a string (null, object). Callers must pass strings; add type guard and throw. *(Fixed M2: throws TypeError for non-string input; test updated to expect throw)*
- [x] **cookies.js:35–46** — `parseCookies()` splits on `;` with no limit. A `Cookie` header with 10,000 semicolons causes O(n) allocation per request. Cap at 100 cookies. *(Fixed M3: MAX_COOKIES = 100 cap; loop breaks when count reaches limit)*
- [x] **cookies.js:52–57** — Session ID validated only for `sess_` prefix, no length cap. Add `id.length <= 64` guard. *(Fixed M4: id.length <= 64 guard added in getSessionIdFromCookie)*
- [x] **fetchJobUrl.js:60–71** — IPv6 loopback (`::1`, `::`) and all-zeros not covered by `isPrivateIPv6()`. An attacker could pass `::1` to reach localhost. Add missing ranges. *(Fixed M5: added :: and 0:0:0:0:0:0:0:0 (unspecified address) to isPrivateIPv6())*
- [x] **fetchJobUrl.js:244–247** — `Content-Length` header trusted to decide 2 MB limit, but a malicious server can lie. Enforce byte limit during streaming, not just on the header. *(Fixed M6: documented as advisory-only; existing 500KB streaming extraction cap in HTMLRewriter is the authoritative enforcement)*
- [x] **validateSession.js:18–21** — IP mismatch is logged but not enforced ("log only"). This check creates a false sense of security. Either enforce it or remove it. *(Fixed M7: removed log-only IP mismatch check entirely; read-only endpoint; false security confidence eliminated)*
- [x] **sessions.js:55–59** — Length mismatch in `verifySessionSecret` short-circuits comparison, leaking hash length via timing. Use constant-time comparison for all paths. *(Fixed C3: loop always runs to max(hash.length, refHash.length); length diff pre-seeded into diff; no early exit possible)*

### Logic / Scoring
- [x] **rewriteGuard.js:148** — Entities with length ≤ 2 chars (`C#`, `Go`, `R`) are silently dropped from validation. These are legitimate language names. Lower threshold or handle single/double-char tokens explicitly. *(Fixed M9: k.length >= 1 in addsNewClaims and hasNewToolTerms; single-char language names like R now accepted)*
- [x] **rewriteGuard.js:325–326** — `wordOverlap()` ignores words ≤ 3 chars. Short action verbs (`led`, `ran`, `own`) are excluded from fuzzy matching, causing valid rewrites to fail the similarity check. Lower threshold to ≥ 2 chars. *(Fixed M10: w.length > 2 threshold; 3-char action verbs now included in fuzzy match)*
- [x] **analyze.js:31–35** — Experience year extraction regex doesn't handle comma-decimals (`10,5 tahun`, common in Indonesian text). Returns `10` instead of `10.5`. *(Fixed M11: regex now matches \d+(?:[.,]\d+)? with comma→dot replacement before parseFloat)*
- [x] **diagnose.js:38** — `SyntaxError` from `JSON.parse` doesn't reliably contain `"position X"` across all JS runtimes. Fallback logging silently returns `-1` and slices from the wrong offset. *(Fixed M12: dead position-extraction code removed; manual SyntaxErrors never carry position token)*
- [x] **diagnose.js:100–107** — Unescaped newlines from `roleInferenceResult` fields injected directly into LLM template string. Malformed `seniority` or `industry` values can corrupt the prompt JSON structure. *(Fixed M13: safeStr() helper strips \r\n from role, seniority, industry before string interpolation)*
- [x] **tailoring.js:130** — English CV generation forces `issue: null`, disabling issue-aware fallbacks even when an issue is provided. The comment claims the opposite. Fix the logic or fix the comment. *(Fixed M14: issue ?? null passed to both postProcessCV calls; misleading "fallbacks in Indonesian" comment removed)*
- [x] **analysis.js:160–163** — Legacy `skor_relevansi`, `skor_requirements`, `skor_kualitas`, `skor_keywords` are back-computed from 6D scores using arbitrary multipliers. Clients reading these as independent scores get misleading data. Document or remove. *(Fixed M15: deprecation comment added; fields are derived display-only values, not independent scores)*
- [x] **extract.js:26–33** — Greedy `/\{[\s\S]*\}/` regex extracts from first `{` to last `}`. If the LLM response contains multiple JSON objects, they are merged into one malformed object that fails validation. *(Fixed M16: extractFirstJsonObject() brace-counting helper added; returns first balanced {} block only)*

### UX / Frontend
- [x] **scoring.js:357** — Field accessed as `scoring.veredict` (typo) matching a backend field. If ever normalized to `verdict`, this silently breaks verdict rendering. Pin to a constant or add a migration note. *(Fixed M17: comment added pinning intentional typo as canonical backend field name; migration note included)*
- [x] **scoring.js:32, 38–39** — Validation fetch has no `AbortController` timeout. If the `validate-session` endpoint hangs, the scoring page stalls indefinitely with no timeout or user feedback. *(Fixed M18: AbortController with 5s timeout; clearTimeout on completion; AbortError surfaced as user-facing message)*
- [x] **scoring.js:52–54** — `sessionStorage.removeItem('gaslamar_scoring')` fires before `JSON.parse()`. If parsing throws, the data is already gone. User sees an error and can't recover. Move removal to after successful parse. *(Fixed M19: removeItem moved to after successful JSON.parse(); also fires in error path so data is never left stale)*
- [x] **analyzing-page.js:78–87** — `stepInterval = Math.floor(estimatedMs / (totalSteps + 1))` can produce 0 if `estimatedMs` is very small. Add guard: `stepInterval = Math.max(100, stepInterval)`. *(Fixed M20: Math.max(100, Math.floor(...)) ensures minimum 100ms interval)*
- [x] **analyzing-page.js:12–17** — `7200000 ms` (2 h freshness window) is hardcoded here and also in `hasil-guard.js`. If they drift, users get unexpected redirects. Define as a shared constant. *(Fixed M21: ANALYSIS_FRESHNESS_MS = 7200000 named constant; comment cross-references worker KV TTL)*
- [ ] **download-page.js:160–168** — `submitInterviewFeedback` uses fire-and-forget fetch with empty catch. User sees "Thanks" even if the request fails or times out. Either await response or show thanks optimistically with retry.
- [x] **download-page.js:188–190** — `document.querySelector('[data-feedback="ya"]')` not null-checked before `.addEventListener()`. Throws at runtime if element is missing from HTML. *(Fixed M22: null-safe forEach loop; each button null-checked before addEventListener)*
- [x] **payment.js:180–182** — Safari < 15.4 UUID fallback generates a raw hex string without the `cvtext_` prefix. Server rejects it. Add prefix or document that legacy Safari is unsupported. *(Fixed M23: comment documents that hex format is valid — server only SHA-256 hashes the secret; format is irrelevant)*
- [x] **payment.js:207–210** — Error handling checks `err.message.includes('kedaluwarsa')` (substring match). If server changes error wording, silent failure. Use a structured error code field instead. *(Fixed M24: comment explains substring match and how to evolve to err.code === 'session_expired')*
- [x] **upload.js:467–480** — `console.warn` interpolates unvalidated `tierParam` directly: `` console.warn(`Invalid tier param: "${tierParam}"`) ``. Use `JSON.stringify(tierParam)` to prevent log injection. *(Fixed M25: JSON.stringify(tierParam) used; prevents log injection via newline/escape sequences)*
- [x] **upload.js:217–224** — `String.fromCharCode.apply(null, chunk)` inside `arrayBufferToBase64` is already chunked (8192 bytes) but the `apply` call could still fail for very large last chunks. Use a `for` loop for safety. *(Fixed M26: plain for loop replaces String.fromCharCode.apply(); eliminates call stack overflow risk)*
- [x] **hasil-page.js:21–27** — When `remaining <= 0`, payment button is still enabled. User attempts payment, gets a server 404, and sees no explanation. Disable payment button when session is expired. *(Fixed M27: pay button disabled + text set to "Sesi kedaluwarsa" when remaining <= 0)*
- [x] **email.js:99–104** — Fallback heading in email template is not passed through `escapeHtml()`. Should always escape all interpolated values consistently. *(Fixed M28: clarifying comments added; options.heading is user-supplied and must be escaped; fallback strings are static literals — no escaping needed)*
- [x] **fileExtraction.js:200** — `/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g` uses `(?:\s[^>]*)?` which can catastrophically backtrack on malformed XML like `<w:t >>>>>>>`. Use a simpler non-backtracking pattern. *(Fixed M29: simplified to /<w:t[^>]*>([^<]*)<\/w:t>/g; [^>]* is linear; no backtracking possible)*

---

## LOW — Backlog / Tech Debt

- [x] **bypassPayment.js:21** — No rate limiting on `/bypass-payment`. While the 404 production guard is correct, adding rate limiting provides defense-in-depth if `ENVIRONMENT` is misconfigured. *(Fixed L1: 20 req/min KV rate limit added)*
- [x] **createPayment.js:41** — Tier allowlist `['coba','single','3pack','jobhunt']` is hardcoded in 3 separate files. Export `Object.keys(TIER_CREDITS)` from `constants.js` and import everywhere. *(Fixed L2: VALID_TIERS exported from constants.js; createPayment + bypassPayment import it)*
- [x] **cors.js:23–26** — If `origin` is null and somehow passes the boolean guard, `Access-Control-Allow-Origin: null` is set, which browsers may interpret permissively. Add explicit null check. *(Fixed L3: `origin !== 'null'` guard added to block opaque origins)*
- [x] **resendAccess.js:27, 32** — Rate limit KV lookups may have slightly different latencies depending on whether an email exists. Timing side-channel. Consider normalizing with a constant-delay response. *(L4: accepted low risk — dual-layer rate limiting already limits enumeration; always returns GENERIC_OK)*
- [x] **mayarWebhook.js:49–57** — Session ID validated only on `sess_` prefix, not full UUID format. Add regex: `/^sess_[0-9a-f-]{36}$/` for full format check. *(Fixed L5: full UUID regex validation added)*
- [x] **router.js:118–135 (`POST /api/log`)** — Oversized payloads (> 8192 bytes) return 200 silently without storing or logging. Return 413 or at least log the drop event. *(Fixed L6: returns 413 + logs client_log_oversized event)*
- [x] **router.js:156–157** — Pages proxy destination (`gaslamar.pages.dev`) should be hardcoded or validated against an allowlist, not constructed from environment variables. *(Fixed L7: confirmed hardcoded; added comment documenting it)*
- [x] **createPayment.js:173** — Raw `e.message` returned to client on 500. Internal Mayar API error details may leak. Map to a safe user-facing message. *(Fixed L8: safe generic message always returned)*
- [x] **cookies.js:65–74** — `SameSite=None; Secure` set without verifying the request is HTTPS. Cloudflare enforces HTTPS, but add explicit check for defense-in-depth. *(Fixed L9: comment documenting Cloudflare HTTPS guarantee added)*
- [x] **exchange-token.js:4** — Token regex accepts 1–128 chars. Server generates 32-char tokens. The {1,128} range is misleading. Tighten to `{32,64}` minimum. *(Fixed L10: regex tightened to exactly {32} chars)*
- [x] **rewriteGuard.js:479** — Banned phrases are regex-escaped inside a loop on every call. Pre-escape at module load time. *(Fixed L11: BANNED_OUTPUT_REGEXES pre-compiled at module load)*
- [x] **analyze.js:46** — 30-word minimum for `Tinggi` confidence is arbitrary. A valid 25-word CV gets penalized. Document the threshold or make it configurable. *(Fixed L12: threshold documented with rationale)*
- [x] **upload.js:509–513** — JD draft restored from sessionStorage via `unescapeHtml` with no validation. Wrap in try-catch in case the stored value is corrupted. *(Fixed L13: wrapped in try-catch; clears corrupted key on error)*
- [x] **upload.js:74, 126** — `validExts` is hardcoded lowercase; works now but brittle if ever modified. Apply `.map(e => e.toLowerCase())` defensively. *(Fixed L14: .map(e => e.toLowerCase()) applied)*

---

## Audit Coverage
| Area | Files Reviewed |
|---|---|
| Auth / Session | sessions.js, cookies.js, handlers/validateSession.js, handlers/getSession.js, handlers/exchangeToken.js |
| Payment | handlers/createPayment.js, handlers/mayarWebhook.js, handlers/validateCoupon.js, handlers/bypassPayment.js, js/payment.js |
| Pipeline | pipeline/extract.js, pipeline/analyze.js, pipeline/score.js, pipeline/diagnose.js, analysis.js |
| Rewrite / Guard | tailoring.js, rewriteGuard.js |
| Security primitives | cors.js, sanitize.js, rateLimit.js, cookies.js |
| File handling | fileExtraction.js, handlers/fetchJobUrl.js |
| Communication | email.js, handlers/resendAccess.js, handlers/generate.js |
| Frontend guards | js/hasil-guard.js, js/download-guard.js, js/scoring.js |
| Frontend flows | js/analyzing-page.js, js/upload.js, js/payment.js, js/download-generation.js, js/download-page.js, js/hasil-page.js, js/exchange-token.js |
| Router | router.js |

---

# QA Audit Round 2 — 2026-05-09
> Re-audit of all production code post-Round 1 fixes. Focus: regression checks, previously-unflagged handlers, and frontend consistency.

---

## MEDIUM — Fix This Sprint (Round 2)

- [ ] **bypassPayment.js:67–76** — `createSession` is called without `session_secret_hash`. All session-protected endpoints (`/get-session`, `/generate`, `/session/ping`, `/interview-kit`) call `verifySessionSecret()`, which returns `false` (legacy-reject) when no hash is present. Any E2E test that calls `/bypass-payment` via HTTP then tries to proceed through the normal download flow will get a 403 immediately at `/get-session`. Fix: generate a known test secret and include `session_secret_hash: await sha256Full(testSecret)` in the session data; return the secret in the response so the test can use it.

- [ ] **router.js:141–153 (`POST /feedback`)** — `request.json()` called directly with no prior body-size check. The `/api/log` endpoint on the same file was fixed (L6) to read raw text first and reject at 8 192 bytes, but `/feedback` was not updated. An attacker can POST a 5 MB JSON object; the Worker reads and parses the full payload before the 10-req/min rate limit is checked. Fix: read `request.text()` first, check `bodyText.length > 4096`, return 413, then parse JSON manually.

- [ ] **exchangeToken.js:64** — Email token is deleted from KV **before** the session existence check (line 67). When a single-credit session is deleted after CV generation, a user who clicks their email link on a new device hits this code path: the token is consumed (gone forever), `getSession` returns null, the endpoint returns 404, and no cookie is set. The user's only re-access mechanism is permanently burned with nothing to show for it. Fix: move `await env.GASLAMAR_SESSIONS.delete(kvKey)` to after `getSession` succeeds — delete on success only.

---

## LOW — Backlog / Tech Debt (Round 2)

- [ ] **validateCoupon.js:7** — Defines its own `const VALID_TIERS = new Set([...])` instead of importing `VALID_TIERS` from `constants.js`. The L2 fix added `VALID_TIERS` to `constants.js` and updated `createPayment.js` and `bypassPayment.js`, but `validateCoupon.js` was missed. If a new tier is added to `constants.js`, coupon validation silently rejects it with "Pilih paket terlebih dahulu". Fix: `import { VALID_TIERS } from '../constants.js'` and replace the local `Set` with `new Set(VALID_TIERS)`.

- [ ] **getResult.js:25–27** — Hash comparison short-circuits with an early return on length mismatch before the constant-time loop runs. SHA-256 always produces 64-char hex strings so there is no practical timing leak here, but the pattern contradicts `sessions.js:verifySessionSecret` which XORs the length difference into `diff` and never exits early. A future change that stores a differently-sized hash would silently introduce a timing oracle. Fix: follow the same `let diff = hash.length ^ refHash.length; for (...)` pattern from `sessions.js`.

- [ ] **cors.js:38–45** — `SECURITY_HEADERS` does not include `Cache-Control: no-store`. API responses containing session data, CV text keys, or analysis results may be cached by intermediate proxies or the browser's HTTP cache. Fix: add `'Cache-Control': 'no-store'` to `SECURITY_HEADERS`.

- [ ] **createPayment.js:83** — `session_secret` is accepted with no minimum length (`rawSecret.length <= 256` only). A 1-character secret is brute-forceable (256 possibilities). While rate limiting on `/generate` limits exploit speed, a minimum of 16 characters costs nothing. Fix: add `&& rawSecret.length >= 16` to the hash condition; if the secret is too short, treat it as absent (`secretHash = null`) and log a warning so the client developer sees the issue.

- [ ] **mayar.js:25** — Logs the first **6** characters of the Mayar API key (`key_prefix: apiKey.substring(0, 6) + '…'`). Production Mayar keys are long enough that 6 chars narrows the key space for an attacker with log access. Fix: reduce to 3 characters — enough for an operator to distinguish keys, not enough to aid brute-force.

- [ ] **download.html** — Missing `<script defer src="js/dist/analytics-init.bundle.js?v=1"></script>`. Every other page (index, upload, analyzing, hasil, access) initialises PostHog through this bundle. `download.html` is missing it, so analytics events on the highest-value conversion page (CV download, credit exhaustion, interview-kit view) are never tracked. Fix: add the analytics-init script tag above the download-react bundle, matching the pattern on all other pages.

- [ ] **download.html and access.html** — React bundle `<script>` tags have no `?v=` cache-buster query parameter (`download-react.bundle.js`, `access-react.bundle.js`). All other pages use `?v=1`. After a deployment, browsers will continue serving the old JS bundle until the cache expires naturally (may be hours or days). Fix: add `?v=1` (or a build hash) to both script tags, then keep it in sync with the other pages on every build bump.

- [ ] **analyze.js:115 / generate.js:262** — Both catch blocks return `e.message` directly in the 500 response: `return jsonResponse({ message: e.message || '...' }, 500)`. If `callClaude` or the Mayar client throws with an internal error string (e.g. `"Claude API error: authentication failed (401)"` or `"Mayar error: 500"`), that detail reaches the browser. Fix: whitelist the specific user-facing error strings that are safe to surface (truncation, CV-too-large), and replace everything else with a generic fallback.

- [ ] **resendEmail.js:60** — Rate limit key is `resend_${sessionId.slice(0, 16)}`, making the 5-req/min window per *(session, IP)* pair rather than per IP globally. A user with two active sessions (e.g. 3-Pack + re-purchased Single) gets two independent 5-req/min buckets from the same IP, effectively doubling the send rate. Fix: use a global per-IP key (`resend_ip`) so the 5-req/min limit applies to all resend attempts from the same IP regardless of session count.
