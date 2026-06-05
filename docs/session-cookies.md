# Session Cookie Strategy

GasLamar uses two HttpOnly cookies to track analysis sessions without exposing tokens to JavaScript:

| Cookie | Set by | Purpose |
|---|---|---|
| `__Host-cv_key` | `POST /analyze` | Carries `cvtext_<64hex>` so `/create-payment` can locate the CV text in KV without the key appearing in the response body or sessionStorage |
| `sessionToken` | `POST /create-payment` | Carries the payment session ID for `/generate`, `/get-session`, `/check-session`, etc. |

---

## Why Two Different SameSite Values

### Production (`gaslamar.com`)

The frontend and the worker share the same eTLD+1 (`gaslamar.com`). All requests are same-site, so `SameSite=Strict` is safe and maximally restrictive.

```
https://gaslamar.com/hasil.html  →  POST https://gaslamar.com/create-payment
same-site ✓  →  SameSite=Strict cookies are sent
```

### Staging

The staging frontend (`staging.gaslamar.pages.dev`) and the staging worker (`api-staging.gaslamar.com`) have different eTLD+1 values (`pages.dev` vs `gaslamar.com`). Every request is **cross-site**. `SameSite=Strict` and `SameSite=Lax` both block the cookie from being sent.

```
https://staging.gaslamar.pages.dev/hasil.html  →  POST https://api-staging.gaslamar.com/create-payment
cross-site ✗  →  SameSite=Strict cookies are NOT sent
```

The fix: use `SameSite=None; Partitioned` (CHIPS — Cookies Having Independent Partitioned State). This allows the cookie to be sent cross-site while still isolating it per top-level site, satisfying Chrome 120+ requirements for cross-site cookies.

---

## Implementation Pattern

Both cookie factories in `worker/src/cookies.js` follow the same pattern:

```js
export function makeCvKeyCookie(cvKey, env) {
  if (env?.ENVIRONMENT === 'production') {
    return `__Host-cv_key=${cvKey}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
  }
  return `__Host-cv_key=${cvKey}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400; Partitioned`;
}
```

**Rule:** any new HttpOnly cookie that must survive a request from the staging frontend to the staging worker MUST accept an `env` parameter and use this pattern. Never hardcode `SameSite=Strict`.

---

## cv_text_key Resolution in `/create-payment`

The handler resolves the `cv_text_key` via three paths in order:

1. **`__Host-cv_key` cookie** — primary path. Works on both production (same-site) and staging (cross-site with CHIPS).
2. **Request body `cv_text_key`** — legacy fallback for old frontend bundles that stored the key in sessionStorage. Always `null` in current code.
3. **`sessionToken` cookie → `analysis_session_` KV** — belt-and-suspenders fallback if the cv_key cookie is absent.

If all three paths fail, the endpoint returns `400 { code: 'cv_key_missing' }`.

---

## Testing Cross-Origin Cookie Behavior

### Verifying in DevTools (staging)

1. Complete an analysis on `staging.gaslamar.pages.dev`.
2. Open DevTools → Application → Cookies → `api-staging.gaslamar.com`.
3. `__Host-cv_key` should show:
   - **SameSite:** `None`
   - **Secure:** ✓
   - **HttpOnly:** ✓
   - **Partitioned:** ✓ (Chrome 114+)
4. On the hasil page, open Network tab and trigger `POST /create-payment`.
5. The `Cookie` request header must include `__Host-cv_key`.

### Unit Tests

`worker/test/worker.test.js` — `describe('makeCvKeyCookie — cookie format')`:

- `production` env → asserts `SameSite=Strict`, no `Partitioned`
- `staging` env → asserts `SameSite=None`, `Partitioned`, no `SameSite=Strict`
- `sandbox` env → same as staging
- `undefined` env → same as staging (fail-safe default)

---

## Adding a New Cookie

Checklist:
- [ ] Does the cookie need to be sent from the staging frontend to the staging worker? → Must use `SameSite=None; Partitioned` on non-production.
- [ ] Accept `env` as a parameter — do not hardcode `SameSite`.
- [ ] Use `__Host-` prefix if the cookie must be host-bound (no `Domain` attribute, `Path=/`, `Secure` required).
- [ ] Add unit tests covering `production`, `staging`, `sandbox`, and `undefined` env values.
