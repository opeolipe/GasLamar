---
name: cv-rewrite-feedback
description: "Guide for working on the CV rewrite pipeline (/generate), gap & recommendation (diagnose stage), and interview feedback (/feedback endpoint) in GasLamar. Use when mutating tailoring.js, rewriteGuard.js, pipeline/diagnose.js, prompts/tailorId.js, prompts/tailorEn.js, or the /feedback inline handler in router.js. Skip when editing extract.js, score.js, analysis.js (scoring logic only), or payment handlers."
---

# CV Rewrite & Feedback — Implementation Guide

Covers three mutation-critical areas: the `/generate` CV tailoring pipeline, the diagnose stage (gap & recommendation), and the `/feedback` interview outcome endpoint. Read this before editing any file listed under "When to Use."

## When to Use

### Must Use
- `worker/src/tailoring.js` — prompt injection, truncation, ground-truth block, cache keys
- `worker/src/rewriteGuard.js` — hallucination guard rules, severity grading, banned phrases
- `worker/src/prompts/tailorId.js` or `prompts/tailorEn.js` — system prompt text
- `worker/src/pipeline/diagnose.js` or `worker/src/prompts/diagnose.js`
- `worker/src/router.js` `/feedback` inline handler (lines 111–118)
- `worker/src/roleProfiles.js` or `worker/src/pipeline/roleInference.js`
- `shared/rewriteRules.js` — SYNC-target for guard constants

### Skip (do not activate this skill)
- `worker/src/pipeline/extract.js` or `worker/src/pipeline/analyze.js` — extraction and scoring layers
- `worker/src/pipeline/score.js` — pure-JS scoring; LLM is never involved
- `worker/src/analysis.js` when touching only cache version constants (no prompt change)
- Payment handlers (`createPayment.js`, `mayarWebhook.js`), email handlers (`resendEmail.js`)
- Frontend components when only updating rendering/styling, not rewrite output logic
- Email-to-session mapping (`email_session_*` KV index) — documented separately

---

## Pre-Edit Checklist

Run through this before every change in scope:

- [ ] Have I identified which cache key(s) this change affects? (See Cache Bump Guide)
- [ ] Does the change risk introducing new numbers into LLM output? → check `addsNewNumbers()`
- [ ] Does the change risk introducing new tool/skill claims? → check `addsNewClaims()`
- [ ] Am I modifying `INFLATED_CLAIM_PATTERNS`, `WEAK_FILLER`, or `BANNED_OUTPUT_PHRASES`? → must SYNC to `shared/rewriteRules.js`
- [ ] Am I changing the diagnose output schema? → must update `validateDiagnoseOutput()` in `pipeline/validate.js`
- [ ] Does the backend still return ≥ 3 gap items and ≥ 3 rekomendasi items? (frontend slices to 3)
- [ ] Am I changing feedback `type` values? → must update `FeedbackType` union in `DownloadReady.tsx` simultaneously
- [ ] Will any unit test in `worker/` need updating? (see Test Requirements)

---

## Architecture Overview

### 1. CV Rewrite — `/generate` Pipeline

```
router.js → handlers/generate.js
  ├─ session validation + lock (lock_<sessionId>, TTL 120s)
  ├─ tailoring.js → tailorCVID() / tailorCVEN()  [parallel]
  │    ├─ truncateCV()              — section-aware at 4 000 chars; hard cut at 10 000
  │    ├─ buildGroundTruthBlock()   — injects angka_di_cv + entitas_klaim as LLM anchor
  │    │    Ground-truth precedence: originalCVText > extractedData > jobDescription
  │    │    Never reverse this order — original CV is always the highest authority
  │    ├─ KV cache check            — gen_id_v3_<sha256(cv||jd)> / gen_en_v3_<sha256(cv||jd)>
  │    ├─ callClaude()              — model: claude-haiku-4-5-20251001, maxTokens: 4096
  │    ├─ validateCVSections()      — checks mandatory heading strings; retries once on failure
  │    └─ postProcessCV()           — see Hallucination Guard below
  │         Input contract:  { llmText, originalCVText, issue, mode, opts }
  │         Output contract: { text: string, isTrusted: boolean }
  └─ KV write → cv_result_<sessionId>
       { cv_id, cv_id_docx, cv_en, cv_en_docx, job_title, company, tier, saved_at }
```

**LLM boundary rule:** Never embed scoring logic, verdict thresholds, or business rules inside prompt templates. The prompts in `tailorId.js` / `tailorEn.js` may only contain CV structure rules, language style, and hallucination constraints.

**Role inference fallback:** If JD is weak (`isJDQualityHigh() === false`), role context is injected from `roleProfiles.js` before the LLM call. If JD is entirely absent, infer from CV using `inferRole()` before tailoring — never pass an empty context.

**Preview ↔ download consistency:** The CV shown in the Hasil preview must exactly match the PDF/DOCX output. `postProcessCV()` is called for both — never apply additional transforms after it that would diverge the two.

**DOCX/PDF constraint:** Rewrites must not introduce bullet nesting, tables, or structures unsupported by the export layer (`components/download/`). Keep output as plain headings + flat bullet lines.

### 2. Hallucination Guard — `rewriteGuard.js` → `postProcessCV()`

Per-bullet deterministic fallback strategy:

| Severity | Trigger | Fallback |
|---|---|---|
| `high` | `addsNewNumbers()`, `hasInflatedClaims()`, placeholder patterns, expanded-short-line | Full revert to original line + issue-aware suffix from `ISSUE_FALLBACK_SUFFIX` |
| `medium` | `hasNewToolTerms()` (not in whitelist or original) | Original line + generic suffix |
| `low` | `isWeakImprovement()` (filler phrases, no change) | Original line + issue-aware suffix |

`isTrusted = true` when high-severity fallback count / total bullets < 0.20.

Summary validation runs first: `extractSummarySection()` + `validateSummaryBlock()` → replace with `buildSafeSummary()` if new numbers or tool terms detected.

**Centralized helper rule:** All validation must call helpers in `shared/rewriteRules.js`. Never duplicate `INFLATED_CLAIM_PATTERNS`, `WEAK_FILLER`, or `ISSUE_FALLBACK_SUFFIX` in other files.

**Performance constraint:** Keep validation O(n) over CV lines. Avoid nested loops over full CV text for each bullet — pre-build lookup sets for number and entity matching.

**Security note:** CV text is user-supplied and passed directly into LLM prompts. Ensure `buildGroundTruthBlock()` and `truncateCV()` strip or escape sequences that could inject prompt instructions (e.g., lines beginning with `---`, `###`, `INSTRUKSI:`).

### 3. Gap & Recommendation — Diagnose Stage

```
analysis.js → pipeline/diagnose.js → callDiagnose()
  ├─ buildUserMessage()    — passes skill_kurang list; LLM is bound to this list only
  ├─ callClaude()          — model: claude-haiku-4-5-20251001, maxTokens: 2500
  ├─ validateDiagnoseOutput()  — in pipeline/validate.js; retries once at 3000 tokens
  └─ filterHallucinatedTools() — replaces tool terms not in CV+JD with "skill relevan"
```

Output schema (enforced by `validateDiagnoseOutput()`):

```json
{
  "gap": ["string ≥1"],
  "rekomendasi": ["string ≥1"],
  "alasan_skor": "string",
  "kekuatan": ["string"],
  "konfidensitas": "Rendah|Sedang|Tinggi",
  "hr_7_detik": { "kuat": ["string"], "diabaikan": ["string"] },
  "red_flags": ["string"]
}
```

**Gap → recommendation binding rule:** Every recommendation must contain at least one keyword from its paired gap. This is enforced in the prompt's INSTRUKSI block — do not remove or weaken it.

**Frontend contract:** Backend must always return ≥ 3 gap items and ≥ 3 rekomendasi items. `GapList.tsx` and `RecommendationList.tsx` call `.slice(0, 3)` — returning fewer causes empty slots.

### 4. Interview Feedback — `/feedback` Endpoint

Inline handler in `router.js` lines 111–118 (no separate file):

- Rate limit: `checkRateLimitKV(env, ip, 10, 60, 'feedback')`
- Input validation: reject if `type` not in `['ya', 'proses', 'tidak']`
- Logs `user_feedback` event; returns `{ ok: true }`
- Frontend: `DownloadReady.tsx` — `FeedbackType = 'ya' | 'proses' | 'tidak'`

---

## Common Task Patterns

### Modifying a Tailor Prompt

1. Edit `worker/src/prompts/tailorId.js` (ID) or `tailorEn.js` (EN).
2. Bump `GEN_KEY_PREFIX_ID` or `GEN_KEY_PREFIX_EN` in `tailoring.js` — even wording-only changes require a bump. If bumping both, do it in a single commit to avoid partial cache mismatch (stale EN with fresh ID or vice versa).
3. Never embed scoring logic or business rules in the prompt — scoring lives in `pipeline/score.js`.
4. Never remove or rename the six mandatory section headings (see Invariants).
5. Consult the bullet formula, forbidden phrases, and action verb rules in the prompt file's comments before editing.

### Adding a Hallucination Guard Rule

1. Open `worker/src/rewriteGuard.js`.
2. Append to the appropriate constant:
   - New inflated claim → `INFLATED_CLAIM_PATTERNS` (severity `high` via `hasInflatedClaims()`)
   - New weak filler → `WEAK_FILLER` (severity `low` via `isWeakImprovement()`)
   - New banned output phrase → `BANNED_OUTPUT_PHRASES`
3. **SYNC immediately** — mirror the exact same change to `shared/rewriteRules.js`. The `// SYNC` comment marks every block that must stay identical.
4. Add a unit test asserting the new rule catches the target pattern and that the final output does not contain the banned phrase.

### Changing the Diagnose Prompt or Adding a New Gap Type

1. Edit `worker/src/prompts/diagnose.js`.
2. If adding a new field to the output schema, update `validateDiagnoseOutput()` in `pipeline/validate.js` as well.
3. Bump `ANALYSIS_CACHE_VERSION` in `worker/src/analysis.js` (e.g., `v6` → `v7`). This is the single source of truth — do not duplicate this constant anywhere.
4. Preserve the `INSTRUKSI` line in `buildUserMessage()` inside `pipeline/diagnose.js` — it constrains the LLM to gaps from `skill_kurang` only.
5. Ensure the diagnose prompt never references score values, verdict thresholds, or business rules.

### Updating the Feedback Handler

1. Edit the inline block in `router.js` lines 111–118.
2. If adding/removing accepted `type` values, update the `FeedbackType` union in `DownloadReady.tsx` in the same commit.
3. To persist feedback to KV instead of just logging, use `ctx.waitUntil()` — follow the pattern from `sendCVReadyEmail` in `handlers/generate.js`. Never block the response on KV writes.
4. Rate limit changes: edit `checkRateLimitKV(env, ip, 10, 60, 'feedback')` arguments directly; keep consistent with the utility pattern used by other endpoints.

### Updating Role Profiles

1. Edit `worker/src/roleProfiles.js` — modify `ROLE_KEYWORDS` (classification) or `ROLE_PROFILES` (strengths, verbs, responsibilities).
2. No cache bump required — the guard in `postProcessCV()` re-validates output regardless of role context.
3. To change the JD quality threshold, edit `isJDQualityHigh()` in `pipeline/roleInference.js`.

---

## Invariants — Never Break

| Rule | Location |
|---|---|
| LLM must never add numbers not in original CV | `rewriteGuard.js` → `addsNewNumbers()` |
| LLM must never add tool/skill claims not in original CV | `rewriteGuard.js` → `addsNewClaims()` |
| Scores and verdicts are pure-JS only — never set via LLM prompt | `pipeline/score.js` |
| Diagnose LLM cannot invent gaps outside `skill_kurang` | `buildUserMessage()` INSTRUKSI in `pipeline/diagnose.js` |
| Ground-truth block required when `extractedCV` is present | `buildGroundTruthBlock()` in `tailoring.js` |
| Mandatory section headings must be exact (case + spacing) | `validateCVSections()` in `tailoring.js` |
| `INFLATED_CLAIM_PATTERNS`, `WEAK_FILLER`, `ISSUE_FALLBACK_SUFFIX` must be identical in both files | `rewriteGuard.js` and `shared/rewriteRules.js` |
| `GEN_KEY_PREFIX_ID` and `GEN_KEY_PREFIX_EN` are the single source of truth for gen cache keys | `tailoring.js` only — never duplicate |
| `ANALYSIS_CACHE_VERSION` is the single source of truth for analysis cache version | `analysis.js` only — never duplicate |
| Feedback `type` values must stay in sync between backend and frontend | `router.js` + `DownloadReady.tsx` |
| Backend must return ≥ 3 gap and ≥ 3 rekomendasi items | `pipeline/diagnose.js` output |

**Mandatory section heading strings (exact):**

| Language | Headings |
|---|---|
| Indonesian | `RINGKASAN PROFESIONAL`, `PENGALAMAN KERJA`, `PENDIDIKAN`, `KEAHLIAN`, `SERTIFIKASI` |
| English | `PROFESSIONAL SUMMARY`, `WORK EXPERIENCE`, `EDUCATION`, `SKILLS`, `CERTIFICATIONS` |

**Edge case — empty or minimal CV:** If the CV has no WORK EXPERIENCE section, skip per-bullet validation and fall back to summary-only structure. Do not attempt to validate bullets on a CV with fewer than 3 bullet lines.

---

## Cache Bump Guide

Stale KV entries are served silently until TTL expires (48h for generate, 48h for analysis). Always bump on prompt or pipeline logic changes — even wording-only edits.

| Change | Constant to Bump | File |
|---|---|---|
| Indonesian tailor prompt | `GEN_KEY_PREFIX_ID` (`gen_id_v3_` → `gen_id_v4_`) | `tailoring.js` |
| English tailor prompt | `GEN_KEY_PREFIX_EN` (`gen_en_v3_` → `gen_en_v4_`) | `tailoring.js` |
| Both tailor prompts | Bump both in same commit | `tailoring.js` |
| Diagnose prompt or output schema | `ANALYSIS_CACHE_VERSION` (`v6` → `v7`) | `analysis.js` |
| Extract prompt or logic | `EXTRACT_CACHE_VERSION` (`v2` → `v3`) | `analysis.js` |
| Role profiles only | None needed | — |
| Hallucination guard rules only | None needed (guard runs post-cache) | — |

---

## Logging Standard

Log at key boundaries using the existing `log()` utility:

```js
log('rewrite_complete',   { sessionId, fallbackRate, isTrusted, tier });
log('diagnose_complete',  { sessionId, gapCount, konfidensitas });
log('rewrite_fallback',   { sessionId, severity, lineIndex, reason });
log('user_feedback',      { type, sessionId });  // already in router.js
```

Never swallow errors in KV writes. Always log with context before rethrowing or returning a 500.

---

## Test Requirements

| Change type | Required test |
|---|---|
| New hallucination guard rule | Unit test: rule catches target pattern; banned phrase absent from final output |
| Tailor prompt change | Integration test: output passes `validateCVSections()` for both ID and EN |
| Diagnose output schema change | Unit test: `validateDiagnoseOutput()` rejects old schema, accepts new |
| Feedback type change | Test: handler rejects unknown type with 400; frontend type union matches |

---

## Definition of Done

Before marking any change in this skill's scope as complete:

- [ ] No hallucination detected in sample output (no new numbers, no new tools)
- [ ] Cache keys bumped if prompt or pipeline logic changed
- [ ] SYNC arrays identical between `rewriteGuard.js` and `shared/rewriteRules.js`
- [ ] `validateDiagnoseOutput()` in sync with actual diagnose output schema
- [ ] Backend returns ≥ 3 gap and ≥ 3 rekomendasi items
- [ ] Tests passing (`cd worker && npm test`)
- [ ] Key events logged with sessionId and relevant metrics

---

## Quick Reference — Key Files

| File | Role |
|---|---|
| `worker/src/handlers/generate.js` | Entry: session validation, lock, parallel tailoring, KV write |
| `worker/src/tailoring.js` | Core: cache keys, truncation, ground-truth block, LLM call, section validation |
| `worker/src/rewriteGuard.js` | Guard: bullet-by-bullet severity grading, placeholder strip, preview consistency |
| `shared/rewriteRules.js` | SYNC target: `INFLATED_CLAIM_PATTERNS`, `WEAK_FILLER`, `ISSUE_FALLBACK_SUFFIX` |
| `worker/src/prompts/tailorId.js` | System prompt — Indonesian CV tailor |
| `worker/src/prompts/tailorEn.js` | System prompt — English CV tailor |
| `worker/src/pipeline/diagnose.js` | Diagnose: user message builder, LLM call, retry, tool filter |
| `worker/src/prompts/diagnose.js` | System prompt — gap & recommendation generation |
| `worker/src/pipeline/validate.js` | Schema validators: `validateDiagnoseOutput()`, `validateExtractOutput()` |
| `worker/src/analysis.js` | Cache version constants: `ANALYSIS_CACHE_VERSION`, `EXTRACT_CACHE_VERSION` |
| `worker/src/roleProfiles.js` | Role keyword maps and profile data (strengths, action verbs) |
| `worker/src/pipeline/roleInference.js` | Role classifier: `inferRole()`, `isJDQualityHigh()`, `computePrimaryIssue()` |
| `worker/src/router.js` lines 111–118 | `/feedback` inline handler |
| `components/result/GapList.tsx` | Renders first 3 gaps from diagnose output |
| `components/result/RecommendationList.tsx` | Renders first 3 recommendations from diagnose output |
| `components/download/DownloadReady.tsx` | Post-download survey (`FeedbackType` union + feedback buttons) |
