# GasLamar QA Guidelines

Applies to: all manual QA, security audits, and AI-assisted testing.  
Last updated: 2026-06-01 (added after false-positive batch on 2026-06-01).

---

## 1. Always test through the public-facing domain

**Rule:** Never file a finding from a raw `*.pages.dev` or `*.workers.dev` URL.

| Surface | Correct test URL | Do NOT use |
|---|---|---|
| Production | `https://gaslamar.com` | `gaslamar.pages.dev`, `gaslamar-worker.carolineratuolivia.workers.dev` |
| Staging | `https://api-staging.gaslamar.com` (API), `https://staging.gaslamar.pages.dev` (UI) | direct `*.workers.dev` subdomains |

**Why:** Cloudflare Pages serves static assets at `*.pages.dev` with its own default headers (including `Access-Control-Allow-Origin: *`). These are platform defaults, not GasLamar configuration. The worker at `gaslamar.com` strips or overrides these headers. Any finding observed on a raw Pages/Workers URL must be **re-tested on the canonical domain** before being filed.

---

## 2. CORS: distinguish API endpoints from static assets

There are two surfaces with **different expected CORS behavior**. Confusing them is the #1 source of CORS false positives.

### API endpoints (authenticated)

Paths: `/health`, `/analyze`, `/get-scoring`, `/generate`, `/get-session`, `/validate-coupon`, `/resend-access`, `/interview-kit`, `/fetch-job-url`

| Header | Expected |
|---|---|
| `Access-Control-Allow-Origin` | Echoes the request `Origin` if it is in the allowlist — **never `*`** |
| `Access-Control-Allow-Credentials` | `true` |
| `Vary` | Must include `Origin` |

A wildcard (`*`) on any of these endpoints is a **real finding**.

### Static assets (public, no auth)

Paths: `/`, `/upload.html`, `js/dist/*.js`, `css/*.css`, fonts, images

| Header | Expected when accessed through `gaslamar.com` |
|---|---|
| `Access-Control-Allow-Origin` | **Absent** — the worker strips it |

A `*` on a static asset fetched via `gaslamar.com` (not `*.pages.dev`) is a **real finding**.  
A `*` on a static asset fetched directly via `*.pages.dev` is **not a finding** (Cloudflare Pages default).

---

## 3. ARIA attributes: check the live DOM, not the Accessibility panel

Some DevTools "Accessibility" panels synthesize ARIA state from native HTML semantics (e.g., a native `disabled` button is reported as `aria-disabled=true` even if the attribute is absent in the DOM). This is a DevTools display artifact, not an actual attribute.

**How to verify:**

1. Open **Elements** panel (not Accessibility panel).
2. Select the element.
3. Check the **Attributes** column — `aria-disabled` must literally appear there to count as a finding.

Alternatively, in the Console:
```js
document.querySelector('[data-testid="submit-upload"]').hasAttribute('aria-disabled')
// must return false
```

GasLamar's submit button uses native `disabled` (not `aria-disabled`). The Playwright test `upload-button-a11y.spec.ts` asserts this on every commit.

---

## 4. Client-side storage: what is and isn't stored

A common false positive is "session token stored in localStorage/sessionStorage."

**What GasLamar intentionally stores client-side:**

| Key | Location | Value | Is it sensitive? |
|---|---|---|---|
| `gaslamar_session` | localStorage | `sess_<id>` (payment session ID, not an auth token) | Low — session ID without secret is useless |
| `gaslamar_secret_<id>` | localStorage | Session secret hash (hex) | Medium — used for session recovery only |
| `gaslamar_analyze_time` | sessionStorage | Unix timestamp | No |
| `gaslamar_scoring` | sessionStorage | JSON scoring blob (public analysis result) | No |
| `gaslamar_cv_key` | **HttpOnly cookie** | `cvtext_<64-hex>` | Yes — but not JS-accessible |
| `cv_key` | **HttpOnly cookie** | Set-Cookie only | Yes — not accessible via `document.cookie` |

**What is NOT there:**

- No `session_token`, `auth_token`, `jwt`, `bearer`, `access_token`, or `refresh_token` keys.
- `gaslamar_cv_key` is never in sessionStorage or localStorage — it is an HttpOnly cookie and will not appear in DevTools → Application → Session/Local Storage.

**Verification:** DevTools → Application → Cookies → look for `cv_key` with the `HttpOnly` flag set. It will NOT appear in the Storage section.

The Playwright test `security-invariants.spec.ts` asserts these invariants on every commit.

---

## 5. Form validation: verify the right layer

The JD textarea has both client-side (`maxlength` HTML attribute) and React state enforcement.

**Known edge case:** programmatically assigning `textarea.value = longString` in the browser console bypasses the `maxlength` HTML attribute but is caught by React's controlled input on the next render cycle. The Playwright test `cv-flow.spec.ts` ("job description counter and validation update after direct value assignment") verifies this.

If the submit button is inexplicably disabled after a valid JD is entered:
1. Check `textarea.value.length` in console — it may be > 5,000 if text was pasted or URL-fetched.
2. Check the counter label — if it shows `5.000 / 5.000 karakter` the field is at the limit and the button should be enabled.
3. If `value.length` is exactly at the limit but the button is disabled, check if the JD also has trailing whitespace — `trim().length` may be less than `minLength`.

---

## 6. Stale deployment: always verify the bundle version

If a behavior seems inconsistent with the codebase, check whether staging is serving stale bundles:

```bash
# Compare local build fingerprints vs. live staging page
STAGING_URL=https://staging.gaslamar.pages.dev node scripts/verify-staging-bundle.js
```

CI runs this check automatically after every staging deploy. If it fails, the deploy is rejected.

For manual QA: open DevTools → Network, hard-reload (Ctrl+Shift+R), pick any `*.bundle.js` file, and note the `?v=` query string. Cross-reference it with the `?v=` value in the source `upload.html` on the `staging` branch.

---

## 7. Test data factory

Use `tests/fixtures/test-data.ts` to generate CV and JD content that meets server-side minimums:

```ts
import { validJD, minimalJD, longJD, cvText } from '../fixtures/test-data';

// Standard JD for most tests (~400 chars)
await page.fill('[data-testid="jd-textarea"]', validJD);

// Exactly at the 5,000-char UI limit
await page.fill('[data-testid="jd-textarea"]', longJD());

// Minimal 100-char JD for "just enough" tests
await page.fill('[data-testid="jd-textarea"]', minimalJD);

// 1,600-char CV text for text-file upload tests
const text = cvText();
```

**Do not** hardcode inline CV/JD strings longer than ~200 chars in test files — use the factory to ensure the content stays valid if minimums change.

Server-side minimums (as of 2026-06-01):
- CV text file: 1,500 chars (`MIN_TXT_CV_CHARS` in `worker/src/fileExtraction.js`)
- Job description: 100 chars (`worker/src/fileExtraction.js:93`)
- JD UI cap: 5,000 chars (`Upload.tsx`)
