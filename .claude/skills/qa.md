# QA Skill — GasLamar Staging Verification

Use this skill when asked to QA, verify, or check a patch on staging. It runs a structured checklist against the staging branch and codebase.

## When to invoke

- `/qa` with no args → full staging QA pass (worker tests + build + audit + XSS check)
- `/qa patch1` → dependency audit verification
- `/qa patch2` → XSS surface review verification
- `/qa patch3` → client storage hygiene verification
- `/qa patch4` → logging/PII minimization verification
- `/qa patch5` → abuse/rate-limit regression tests

## Standard gate (run for every patch)

```bash
cd worker && npm test
cd .. && npm run build
npm audit --omit=dev
cd worker && npm audit --omit=dev
```

All four must exit 0 before reporting pass.

## Patch-specific checks

### patch1 — Dependency hardening
1. `npm audit --omit=dev` → expect 0 vulnerabilities
2. Check `package.json` for `jspdf >= 4.2.1` and `overrides.postcss >= 8.5.14`
3. Check `SECURITY.md` for advisory documentation (jspdf, postcss, dompurify)
4. Confirm `download-docx-pdf.js` uses no `addJS`, `AcroForm`, `addImage`, or `fromHTML`

### patch2 — XSS surface review
1. Search app-owned JS files for dynamic `innerHTML` writes with user-controlled values:
   ```bash
   grep -rn "innerHTML" js/ --include="*.js" | grep -v node_modules | grep -v vendor | grep -v dist
   ```
2. For each hit: classify as static template (ok) or dynamic user data (flag)
3. Check that flagged sinks were replaced with `textContent` or escaped helpers
4. Check `7c55201` commit diff for what was fixed
5. Confirm Playwright tests cover XSS payloads (`<img onerror>`, `<script>`, etc.)

### patch3 — Client storage hygiene
1. Confirm `download.js` calls `history.replaceState` after token exchange (strips `?token=`)
2. Confirm secrets are in `sessionStorage`, not `localStorage`
3. Check for orphaned `gaslamar_secret_<old_session>` cleanup logic
4. Confirm no grace-period cleanup deletes the *current* session secret

### patch4 — Logging minimization
1. Search worker and frontend for plaintext email in logs:
   ```bash
   grep -rn "to:.*email\|session\.email\|session_id.*log" worker/src/ --include="*.js"
   ```
2. Confirm emails are hashed before logging in `email.js`
3. Check `/api/log` handler in `router.js` for PII redaction
4. Check PostHog integration for `?session=` or `?token=` in tracked URLs

### patch5 — Abuse/rate-limit tests
1. Run worker tests: `cd worker && npm test`
2. Confirm test coverage for:
   - `/exchange-token` rejecting non-hex / wrong-length tokens
   - `/exchange-token` single-use enforcement
   - `/resend-access` silent response for unknown emails
   - `/check-session` fallback returning minimized fields only

## Reporting format

Report as a checklist per check:
- ✅ pass — with one-line evidence
- ❌ fail — with file:line and what was found
- ⚠️ manual needed — with exactly what to check in a browser

Keep the report under 40 lines. Flag blockers first.
