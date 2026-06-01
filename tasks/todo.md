# JD Counter Sync — Remaining Fix Plan (2026-06-01)

## Root Cause Summary
React upload page (`JobDescriptionInput.tsx`) has NO "Gunakan contoh" insert button —
clicking "Lihat contoh" only shows a static display panel, never calls `onChange`, so
the character counter and validation state don't update. This is the one remaining
broken path after PR #442.

Download page `MultiCreditSection.tsx` URL fetch doesn't cap returned text to 5000
chars, so the generate button silently disables with no truncation message.

## Tasks

- [x] 1. `JobDescriptionInput.tsx` — add "Gunakan contoh" insert button inside the
         example panel that calls `onChange(JD_EXAMPLE)` and collapses the panel
- [x] 2. `MultiCreditSection.tsx` — cap URL-fetched JD to 5000 chars; show truncation
         message when text is cut
- [x] 3. Run `npm test` (worker) — 577/577 pass
- [x] 4. Double audit — traced below
- [ ] 5. Commit + push to claude/eloquent-dijkstra-CnDHx

## Double Audit Results

### Upload page (`JobDescriptionInput.tsx` + `Upload.tsx`)

| Scenario | Path | Result |
|---|---|---|
| Manual typing | `onChange` event → `handleChange` → `syncTextareaValue` → `onChangeRef.current` → `handleJdChange` → `setJd` → re-render → `charCount`/`quality` derive from `value` | PASS |
| Paste | Same `input` event path | PASS |
| "Ambil via link" URL fetch | `UrlFetcher.onFetchSuccess` → `onChange(text.slice(0,5000))` → `handleJdChange` → `setJd` → re-render | PASS |
| "Gunakan contoh" | Was broken (no insert). Now: `onClick={() => { onChange(JD_EXAMPLE); setShowExample(false); }}` → `handleJdChange` → `setJd` → re-render | FIXED |
| Clear textarea | `input` event with `value=''` → `setJd('')` → `charCount=0`, success hides, hint shows | PASS |
| Page load with draft | `useEffect` → `setJd(unescapeHtml(savedJd).slice(0,5000))` → re-render | PASS |
| Conflicting messages | Ternary chain in `jd-feedback`; only one branch renders at a time | PASS |
| Submit button state | `handleSubmit` validates `evaluateJDQuality(jd).isValid`; errors shown inline on attempt | PASS |
| External `el.value = x` | `useEffect` setter override → `syncTextareaValue` → `onChangeRef.current` → `setJd` | PASS |
| Char limit 5000 programmatic | `onFetchSuccess` caps with `.slice(0, MAX_JD_CHARS)`; setter also caps | PASS |
| No console errors | Pure React state derivation; no DOM ID selectors; no legacy JS loaded | PASS |

### Download page (`MultiCreditSection.tsx`)

| Scenario | Path | Result |
|---|---|---|
| "Ambil dari URL Loker" | Was: no cap. Now: `capped = jd.slice(0,5000)` → `setJobDesc(capped)` → re-render | FIXED |
| "Gunakan contoh" | `onClick={() => setJobDesc(EXAMPLE_JD)}` → re-render → `charCount` updates | PASS |
| Manual typing | `onChange={e => setJobDesc(e.target.value)}` → re-render | PASS |
| Char counter | `charCount = jobDesc.length` derived from state | PASS |
| Submit button state | `disabled={generating \|\| !jobDesc.trim() \|\| underMin \|\| overLimit}` — all derived from state | PASS |
| Truncation > 5000 | Now: capped + status message "...dipotong di 5.000 karakter" | FIXED |

---

# /get-scoring atomic rate limit fix — 2026-05-31

## Problem
`getScoring.js` uses only `checkRateLimitKV` (non-atomic KV counter with TOCTOU race).
15 parallel requests can all read `count=0` before any write completes → limit bypass.
No CF native atomic binding for this endpoint. No rate-limit tests.

## Steps
- [ ] Add `RATE_LIMITER_GET_SCORING` CF native binding to wrangler.toml (namespace_id 1007, 10/min) — sandbox, staging, production
- [ ] Update `getScoring.js` — import `checkRateLimit`, call CF binding first (atomic burst guard)
- [ ] Add rate limiting tests to worker.test.js (new describe block, unique IP range 10.99.3.x)
- [ ] Run tests — all must pass
- [ ] Commit and push
