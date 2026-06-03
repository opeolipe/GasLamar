# Rate Limit Headers — Fix Plan

## Problem
- `X-RateLimit-Limit/Remaining/Reset` and `Retry-After` headers absent from API responses
- Core reason 1: `Access-Control-Expose-Headers` missing in CORS config → browsers can't read headers even when present
- Core reason 2: `resendAccess.js` success path (line 99) missing `withRl` wrapper
- Core reason 3: `exchangeToken.js` and `submitEmail.js` use CF-only rate limiting with no rlInfo → no headers on successful responses

## Steps

- [ ] 1. `cors.js`: Add `Access-Control-Expose-Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After` to `getCorsHeaders()`
- [ ] 2. `resendAccess.js`: Wrap line 99 success return with `withRl`
- [ ] 3. `exchangeToken.js`: Add `checkRateLimitKV` (5/60s, prefix `exchange_token`) alongside CF check to get rlInfo; apply `withRl` to all responses
- [ ] 4. `submitEmail.js`: Add `checkRateLimitKV` (5/60s, prefix `submit_email`) alongside CF check; apply `withRl`
- [ ] 5. Run `cd worker && npm test` — all tests green
- [ ] 6. Commit and push to `claude/relaxed-hawking-QxD4g`
