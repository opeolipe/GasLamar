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
