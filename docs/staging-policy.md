# Staging Policy

## The 24-Hour Staleness Rule

**Staging must never be more than 24 hours behind `main`.**

A stale staging branch is the root cause of the most damaging class of payment bugs:
- Orphaned Mayar invoices (created but never payable)
- Dead-end "Selesaikan Pembayaran Anda" emails linking to expired or 404 checkouts
- Frontend allowlist mismatches that silently block payment redirects
- Webhook correlation failures when invoice field names have drifted

### Enforcement

| Mechanism | Where | What it does |
|---|---|---|
| **Staleness gate** | `deploy-staging.yml` → `check-staleness` job | Fails the deploy if `origin/main` is > 24h ahead of staging HEAD. Blocks `deploy-sandbox-worker` from running. |
| **Daily sync PR** | `.github/workflows/sync-staging.yml` (cron 02:00 UTC) | Opens a PR `main → staging` automatically when drift is detected. Existing open PR gets a comment with updated stats instead of a duplicate PR. |

### Responding to a Stale Staging Failure

When CI fails with:
```
STAGING IS STALE — merge main into staging before deploying.
Staging is Xh behind main. Run: git merge origin/main
```

1. Merge (or rebase) `origin/main` into the `staging` branch.
2. Push to `origin/staging`.
3. CI re-runs the staleness check — it will pass if the gap is now ≤ 24h.
4. Do NOT skip the staleness check. Stale staging + payment code = orphaned invoices.

### Responding to the Auto-Sync PR

When the daily workflow opens a PR titled `chore: sync main → staging`:
1. Review the diff — confirm no surprising production-only changes landed on `main`.
2. Merge the PR. CI runs the full staging test suite before deploying.
3. No code changes needed — it's a straight merge.

---

## What "Stale" Means in Practice

The staleness check compares **commit timestamps**, not diff size. A staging branch that merged `main` yesterday but has had no commits since will still pass if `main` has had no new commits either. The gate fires when someone pushes to `main` and staging doesn't follow within 24 hours.

**Staging is ahead of main?** That's fine — it means staging has work-in-progress that hasn't been promoted to production yet. The check only fails when `main` is *ahead* of staging.

---

## Payment Smoke Test

Every staging deploy runs a payment allowlist verification:
- Builds the JS bundle and verifies all 5 Mayar checkout domains are present in `ALLOWED_PAYMENT_HOSTS`
- Required domains: `mayar.id`, `mayar.club`, `mayar.co`, `mayar.shop`, `myr.id`
- If any domain is missing, CI fails with a clear message before the frontend is deployed

This catches Mayar domain migrations before they hit users.

---

## Pre-Release Checklist (Payment Code)

Before merging any change that touches `worker/src/handlers/createPayment.js`, `worker/src/mayar.js`, `js/payment.js`, or `pages/Result.tsx`:

- [ ] Staging is merged up to date with `main` (staleness check green)
- [ ] All worker tests pass: `cd worker && npm test`
- [ ] Payment allowlist check green in CI
- [ ] Run the full payment flow on staging with a test email — confirm one email, one invoice, working link
- [ ] Click "Bayar" 5× rapidly — confirm only one invoice created
- [ ] Wait for sandbox invoice to expire (~1h) — confirm retry creates a fresh invoice with a new working link
- [ ] See `docs/payment-flow.md` → Pre-Release Payment Audit Checklist for the full list

---

## Why Mayar Sandbox Emails Are Kept Enabled

Disabling Mayar sandbox emails would hide bugs. The "Selesaikan Pembayaran Anda" email is the signal that an invoice was created. If you receive a dead-link email on staging, that means an orphaned invoice was created — the fix is to prevent orphaned invoices, not silence the notification.

The invoice expiry + smart resume logic in `createPayment.js` ensures:
- Valid invoices are reused on retry (no duplicate email)
- Expired invoices trigger a fresh invoice with a fresh working link (one new email, expected)
- Orphaned invoices (`invoice_url = null`) trigger a 502 that prevents the user from seeing a dead end

---

## Contact

Payment bugs, Mayar API questions: `support@gaslamar.com`  
Mayar sandbox dashboard: `web.mayar.club` → Transaksi (cancel orphaned pending invoices manually)
