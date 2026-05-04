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
