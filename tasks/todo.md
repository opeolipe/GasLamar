# Security Fix: Remove Sensitive Data from sessionStorage

## Objective
Remove scoring JSON, result_id, raw CV text, and extracted claims from sessionStorage.
These data must live server-side only, retrieved via HttpOnly cookie-authenticated API calls.

## Files to change

- [x] `hooks/useAnalysisPolling.ts` — remove setItem for scoring, result_id, candidate_name, entitas_klaim, sample_*, preview_after
- [x] `hooks/useResultData.ts` — remove sessionStorage fast path; always fetch /get-scoring via cookie
- [x] `hooks/useGenerateCV.ts` — remove reads of scoring, result_id, sample, preview, entitas_klaim, 6d_scores
- [x] `pages/Result.tsx` — remove gaslamar_cv_key guard before payment; server uses cookie
- [x] `pages/Analyzing.tsx` — remove gaslamar_cv_key from freshness check
- [x] `pages/Upload.tsx` — remove gaslamar_cv_paste_raw persistence (raw CV text)
- [x] `pages/Download.tsx` — remove gaslamar_result_id and gaslamar_candidate_name reads
- [x] `js/scoring.js` — remove sessionStorage fallback block
- [x] `js/upload-page.js` — remove gaslamar_cv_key from active-session check

## Keys to be eliminated (setItem)
- gaslamar_scoring
- gaslamar_result_id
- gaslamar_cv_paste_raw
- gaslamar_candidate_name
- gaslamar_entitas_klaim
- gaslamar_sample
- gaslamar_sample_context
- gaslamar_sample_line
- gaslamar_sample_fallback
- gaslamar_preview_after

## Keys to keep (non-sensitive)
- gaslamar_analyze_time (timestamp)
- gaslamar_tier (tier name)
- gaslamar_jd_draft (JD text — allowed per task)
- gaslamar_6d_scores, gaslamar_skor, gaslamar_skor_sesudah, gaslamar_gap (derived numbers for Download page badge)
- gaslamar_score_displayed_at, gaslamar_had_jd, gaslamar_upload_start (analytics timestamps/flags)

## Double Audit Checklist
- [x] After analysis: sessionStorage has zero sensitive entries (no scoring JSON, no result_id, no CV text)
- [x] HttpOnly cv_key cookie is set on api-staging.gaslamar.com
- [x] Results page fetches from /get-scoring with credentials: 'include'
- [x] XSS: document.cookie and sessionStorage reveal no tokens or scoring data
- [x] IDOR: different session → 401 from /get-scoring (cookie not present)
- [x] Golden path regression: upload → analyze → results → download completes
