# Remove gaslamar_tier from sessionStorage

## Status
The backend HttpOnly cookie implementation is complete and verified (622 tests pass).
The only remaining sessionStorage item from the security task is `gaslamar_tier`
(non-sensitive display value: coba/single/3pack/jobhunt).

## Plan

### 1. Thread tier via URL params through pre-payment flow
- `js/upload.js`: Pass tier in redirect to analyzing.html (`?tier=<value>`)
- `js/analyzing-page.js`: Read tier from URL, pass it on redirect to hasil.html
- `js/hasil-page.js`: Read tier from URL param instead of sessionStorage

### 2. Remove sessionStorage writes for tier
- `js/payment.js`: Remove `sessionStorage.setItem('gaslamar_tier', tier)` (selectTier fn)
- `js/download-state.js`: Remove tamper check + setItem; setClientSessionTier removed
- `hooks/useDownloadSession.ts`: Remove sessionStorage.setItem for tier (use state)
- `hooks/useGenerateCV.ts`: Remove setItem; 404 error msg hard-code validity text
- `pages/Result.tsx`: Remove sessionStorage read/write for tier (use state + URL param)
- `pages/Upload.tsx`: Remove sessionStorage.setItem for tier; pass in redirect

### 3. Update sessionStorage readers to use alternatives
- `js/download-page.js`: Default to '' during generation; tier shown after cvDataCache loads
- `js/download-generation.js`: Remove tier from analytics (lines 17, 262)
- `js/analytics.js`: Remove tier from top-level analytics call
- `js/session-controller.js`: Remove gaslamar_tier from cleanup comment (already removes it)

### 4. Update e2e test
- `tests/e2e/security-invariants.spec.ts`: Remove outdated `gaslamar_scoring` seed
  (hasil-guard.js no longer reads it; test should use correct mechanism)

### 5. Verify
- `cd worker && npm test` (all 622 tests must pass)
- Build frontend: `npm run build`

## Checkboxes
- [ ] upload.js
- [ ] analyzing-page.js
- [ ] hasil-page.js
- [ ] payment.js
- [ ] download-state.js
- [ ] useDownloadSession.ts
- [ ] useGenerateCV.ts
- [ ] pages/Result.tsx
- [ ] pages/Upload.tsx
- [ ] download-page.js
- [ ] download-generation.js
- [ ] analytics.js
- [ ] e2e test
- [ ] npm test passes
- [ ] npm run build passes
