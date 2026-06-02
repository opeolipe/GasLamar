# Fix: critical session issue blocking /hasil after analysis

## Root cause
After /analyze completes, the `cv_key` HttpOnly cookie (set with `SameSite=None; Partitioned`)
fails to be sent in subsequent requests in some browsers (Safari ITP blocks third-party cookies
on staging where frontend is `staging.gaslamar.pages.dev` and API is `api-staging.gaslamar.com`).
Additionally, the Upload page shows contradictory messages (both "session expired" and "active
results") when the cv_key cookie fails but `gaslamar_analyze_time` is still in sessionStorage.

## Required changes

- [x] `worker/src/cookies.js` — add `makeSessionTokenCookie(sessionId)` + `getSessionTokenFromCookie(request)`
- [x] `worker/src/cors.js` — add `jsonResponseWithCookies(data, status, cookieHeaders[], request, env)` for setting multiple cookies
- [x] `worker/src/handlers/analyze.js` — create `analysis_session_<uuid>` KV entry (sessionId, resultId, cvKey, createdAt, expiresAt); set both `cv_key` + `sessionToken` cookies
- [x] `worker/src/handlers/checkSession.js` — also read `sessionToken` cookie; look up `analysis_session_`; return `{ valid: true, resultId, type: 'analysis' }` on success; return 401 on invalid/expired
- [x] `worker/src/handlers/getScoring.js` — also accept `sessionToken` cookie as auth (resolve cvKey via analysis_session_ then fetch scoring)
- [x] `hooks/useResultData.ts` — call /check-session first to validate cookie + get resultId; then fetch /get-scoring; on 401 show inline expired state
- [x] `pages/Upload.tsx` — skip "active results" notice when URL reason indicates expired session; call /check-session to remove stale notice when cookie is invalid
- [x] `worker/test/worker.test.js` — add 6 tests for sessionToken cookie path in /check-session and /get-scoring + 1 for analyze sessionToken output
- [x] `tasks/lessons.md` — document: set-cookie with two cookies requires Headers.append, not plain object spread
