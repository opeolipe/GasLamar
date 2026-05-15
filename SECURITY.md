# GasLamar — Security Architecture

## Tier & Credits Authorization

### Summary

All authorization decisions — which tier a user paid for, how many CV generations remain — are
made exclusively by the Cloudflare Worker using the KV session store as the single source of
truth. Client-side storage (`sessionStorage`, `localStorage`) is used only for **UI display and
analytics enrichment**. Manipulating client-side values has no effect on billing or access.

---

### Data Flow

```
Browser                              Cloudflare Worker              KV (GASLAMAR_SESSIONS)
──────                              ─────────────────              ──────────────────────
selectTier('jobhunt') ──tier──────► /create-payment
                                    • validates tier ∈ whitelist
                                    • price = TIER_PRICES[tier]     ◄── server constant
                                    • credits = TIER_CREDITS[tier]  ◄── server constant
                                    • creates Mayar invoice
                                    • stores session {tier, credits_remaining, status:'pending'}
                                                                    ──► KV.put(sess_xxx, ...)

[user pays on Mayar]
                       webhook ────► /webhook/mayar
                                    • verifies HMAC signature
                                    • sets session.status = 'paid'  ──► KV.put(sess_xxx, ...)

fetchAndGenerateCV()
  session_id ──────────────────────► /get-session
                                    • reads tier, credits from KV   ◄── KV.get(sess_xxx)
                                    • verifies X-Session-Secret
                                    • requires status = 'paid'
                                    • sets status = 'generating'    ──► KV.put(sess_xxx, ...)
             ◄── {tier, credits} ──

  session_id ──────────────────────► /generate
                                    • reads tier, credits from KV   ◄── KV.get(sess_xxx)
                                    • verifies X-Session-Secret
                                    • requires status = 'generating'
                                    • decrements credits in KV      ──► KV.put / KV.delete
             ◄── {cv_id, cv_en} ──
```

The browser **never sends** `tier` or `credits` to `/generate` or `/get-session`. Those values
flow only from KV → Worker → browser response, never the other way.

Session states are defined in `sessionStates.js`: `pending_payment → paid → generating → ready` (or `exhausted` on last credit). Old sessions with `status: 'pending'` are handled via backward-compat alias `PENDING_LEGACY`.

---

### Defense-in-Depth Layers

| # | Safeguard | Location |
|---|-----------|----------|
| 1 | **Tier whitelist** — `/create-payment` rejects any value not in `['coba','single','3pack','jobhunt']` | `createPayment.js:35` |
| 2 | **Server-derived price** — invoice amount comes from `TIER_PRICES[tier].amount` in `constants.js`; the client never supplies a price | `createPayment.js:67`, `constants.js:14` |
| 3 | **Server-derived credits** — `credits_remaining` is set from `TIER_CREDITS[tier]`; the client never supplies a credit count | `createPayment.js:58`, `constants.js:22` |
| 4 | **KV as single source of truth** — `/generate` reads `tier` and `credits_remaining` exclusively from the KV session, never from the request body | `generate.js:53,61` |
| 5 | **`pending → paid` gate via webhook** — a session cannot be used until the Mayar payment webhook sets `status: 'paid'`; the client cannot self-promote | `mayarWebhook.js`, `getSession.js:31` |
| 6 | **Session secret (HMAC)** — `/get-session` and `/generate` verify `X-Session-Secret` against a SHA-256 hash stored in KV using constant-time comparison | `sessions.js:46–56` |
| 7 | **IP-binding on `cv_text_key`** — the analysis key from `/analyze` is bound to the originating IP; cannot be reused from a different network | `createPayment.js:50–52` |
| 8 | **Distributed lock** — a `lock_<session_id>` KV entry (TTL 120s) prevents concurrent double-generation race conditions | `generate.js:136–141` |
| 9 | **Credit exhaustion → `exhausted` state** — at zero credits, the session transitions to `status: 'exhausted'` (not deleted); `/check-session` returns the exhausted status so the client can distinguish "used up" from "expired/not found". The KV entry expires by TTL. | `generate.js`, `sessionStates.js` |
| 10 | **Server overwrites client tier** — after payment confirmation, `/check-session` returns `data.tier` which `download.js` immediately writes to `sessionStorage`, correcting any tampered value | `download.js:119` |

---

### Client-Side Storage — Role and Scope

`sessionStorage` and `localStorage` values related to tier are **display-only**:

| Key | Written by | Read by | Purpose |
|-----|-----------|---------|---------|
| `gaslamar_tier` (sessionStorage) | `upload.js` (from `?tier=` URL param); `download.js` (from server response) | `download-page.js`, `analytics.js` | UI label, analytics events |
| `gaslamar_session` (localStorage) | `payment.js` | `download.js` | Tab-close recovery — session ID only, not tier/credits |

`gaslamar_tier` is **not** persisted to `localStorage` after payment creation. The authoritative
tier is always sourced from `/check-session` → `data.tier`.

`gaslamar_tier` is removed from both `sessionStorage` and `localStorage` when all credits are
consumed (`download.js:336–339`).

---

### Attack Scenarios

| Attack | Why it fails |
|--------|-------------|
| Set `sessionStorage.gaslamar_tier = 'jobhunt'` after paying for `coba` | `/generate` ignores all client-supplied tier; reads `session.tier` from KV (set at payment time as `'coba'`) |
| Inject `"credits_remaining": 99` into the `/generate` request body | The field is not read; `creditsRemaining` comes from `session.credits_remaining` in KV |
| Call `/generate` directly after `/create-payment` (skip payment) | Session `status` is `'pending'`; `/get-session` returns 403, `/generate` requires `status = 'generating'` |
| Replay a spent session | Session transitions to `status: 'exhausted'`; `/check-session` returns the exhausted status; `/get-session` and `/generate` reject sessions not in `paid`/`ready` state |
| Reuse `cv_text_key` from a different IP | IP-binding check rejects with 403 |

---

### Webhook Security

Mayar payment webhook calls are verified using an HMAC-SHA256 signature checked against
`MAYAR_WEBHOOK_SECRET` (a Cloudflare Worker secret, never exposed to the browser). Unsigned or
tampered webhook requests are rejected before any session state is updated.
