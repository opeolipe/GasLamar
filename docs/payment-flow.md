# Payment Flow

## Overview

Payment is handled by [Mayar](https://mayar.id) (production) and Mayar sandbox (`api.mayar.club`) for staging. GasLamar creates an invoice, redirects the user to Mayar's checkout, and Mayar fires a webhook when payment completes.

```
User clicks Bayar
      │
      ▼
POST /create-payment  ──► Mayar POST /invoice/create
      │                          │
      │                    invoice_id + invoice_url
      │                          │
      ◄──────────────────────────┘
      │
  Set session cookie (pending_payment)
  Delete cvtext_ key
      │
      ▼
Frontend validates URL domain (allowlist)
      │
      ▼
window.location.href = invoice_url  ──► Mayar checkout page
                                              │
                                        User pays
                                              │
                                        POST /webhook/mayar
                                              │
                                        session → paid
                                              │
                                        Redirect to /download.html
```

---

## Mayar Invoice URL Fields

Mayar's API response shape has changed across versions. The worker checks all known field names in order:

```js
// worker/src/mayar.js — createMayarInvoice()
const invoice_url =
  data.data?.link         || data.data?.url          || data.data?.payment_url  ||
  data.data?.checkout_url || data.data?.invoice_url  || data.data?.paymentLink  ||
  data.link               || data.url                || data.payment_url        ||
  data.checkout_url       || data.invoice_url        || data.paymentLink;
```

**`paymentLink` is the field used by Mayar sandbox today.** If Mayar adds a new field, add it to both ends of this chain. Failing to do so means `invoice_url` is `null`, the worker returns 503, but the invoice is already created in Mayar — causing an orphaned invoice and an immediate "Selesaikan Pembayaran Anda" email.

---

## Frontend Allowlist

Both the legacy page (`js/payment.js`) and the React page (`pages/Result.tsx`) validate the `invoice_url` domain before redirecting. If the domain is not in the allowlist, the frontend throws an error — but the invoice is already created server-side.

**Current allowlist (must stay in sync across both files):**

| Domain | Used by |
|---|---|
| `mayar.id` | Production API-issued links |
| `mayar.club` | Sandbox API-issued links (old) |
| `mayar.co` | Sandbox checkout URLs |
| `mayar.shop` | Sandbox checkout URLs (e.g. `olive-41774.mayar.shop`) |
| `myr.id` | Sandbox checkout URLs (legacy, e.g. `olive-41774.myr.id`) |

**When Mayar adds a new checkout domain:**
1. Add it to `ALLOWED_PAYMENT_HOSTS` in `js/payment.js`
2. Add it to `ALLOWED_PAYMENT_HOSTS` in `pages/Result.tsx`
3. Add a test in `worker/test/worker.test.js` under `POST /create-payment — Mayar URL field extraction`

---

## Orphaned Invoice Problem

If the backend creates an invoice but the frontend rejects the URL (domain not in allowlist), the user is left with:
- An orphaned Mayar invoice → Mayar sends "Selesaikan Pembayaran Anda" email immediately
- `cvtext_` key already deleted → user cannot retry without re-uploading

**Resume logic** (`worker/src/handlers/createPayment.js`) prevents this from compounding on retry:
- On every successful invoice creation, `invoice_url` is stored in the session under `pending_payment` status
- If `cvtext_` is gone on retry, the worker checks for a `pending_payment` session cookie with matching tier and stored `invoice_url`
- If found, it returns the existing URL — no new Mayar invoice created, no new email

```
Retry with consumed cvtext_
      │
      ▼
cv_expired path — check for existing session cookie
      │
   session exists?
   status = pending_payment?
   tier matches?
   invoice_url stored?
      │
      ▼ yes
Return stored invoice_url  ← no new Mayar API call
```

---

## Email Behavior

Mayar sends **"Selesaikan Pembayaran Anda"** immediately when an invoice is created, not as a delayed reminder. If you receive multiple emails, multiple invoices were created (see Orphaned Invoice Problem above).

To stop receiving emails for old orphaned sandbox invoices: go to **web.mayar.club** → Transaksi → cancel all Pending invoices. The dashboard link in the email will return 404 if the invoice has expired — use the dashboard directly.

---

## Session State Machine (Payment Transitions)

```
pending_payment  ──► paid          (POST /webhook/mayar — payment confirmed)
paid             ──► generating    (POST /get-session — first generation)
generating       ──► paid          (POST /generate fails — rollback)
generating       ──► ready         (POST /generate succeeds, credits remain)
generating       ──► exhausted     (POST /generate uses last credit)
```

See `worker/src/sessionStates.js` for canonical state constants. Never hardcode state strings.

---

## KV Keys Involved in Payment

| Key | Purpose | TTL |
|---|---|---|
| `cvtext_<hash>` | CV text + job desc — single-use, deleted after invoice creation | 24h |
| `invoice_lock_<cvtext_key>` | Idempotency lock — prevents concurrent duplicate invoices | 60s |
| `sess_<uuid>` | Session data including `invoice_url`, `status`, `tier` | 7d (single) / 30d (multi) |
| `mayar_session_<invoice_id>` | Invoice ID → session ID index for webhook correlation | 7d / 30d |
| `scoring_<hash>` | Scoring snapshot for `/get-scoring` after cvtext_ is deleted | 24h |
| `email_session_<sha256>` | Email → session IDs for `/resend-access` | 30d |

---

## Coupon Flow

Coupons are managed entirely in Mayar. The worker only validates coupon existence via `GET /coupon/validate` (query params — NOT body, Fetch spec forbids GET bodies). The actual discount is applied on Mayar's checkout page when the user enters the code.

See `CLAUDE.md` → Coupon / Discount Promos for operational controls.
