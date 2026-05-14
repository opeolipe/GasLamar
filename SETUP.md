# GasLamar — Setup & Developer Guide

## Daftar Isi

1. [Struktur Project](#struktur-project)
2. [Architecture Overview](#architecture-overview)
3. [Prerequisites](#prerequisites)
4. [Step 1 — Cloudflare KV Setup](#step-1--cloudflare-kv-setup)
5. [Step 2 — Environment Variables](#step-2--environment-variables-secrets)
6. [Step 3 — Deploy Worker](#step-3--deploy-worker-sandbox-dulu)
7. [Step 4 — Build Frontend](#step-4--build-frontend)
8. [Step 5 — Cloudflare Pages Setup](#step-5--cloudflare-pages-setup)
9. [Step 6 — Register Mayar Webhook](#step-6--register-mayar-webhook)
10. [Step 7 — Update Worker URL](#step-7--update-worker-url)
11. [Step 8 — Testing End-to-End](#step-8--testing-end-to-end-sandbox)
12. [Step 9 — Go Live](#step-9--go-live)
13. [Running Tests (Worker)](#running-tests-worker)
14. [Security Checklist](#security-checklist)
15. [Pricing](#pricing)

---

## Struktur Project

```
gaslamar/
├── index.html              # Landing page
├── upload.html             # Upload CV + job description
├── hasil.html              # Scoring + gap analysis results
├── download.html           # Download generated CV
├── analyzing.html          # Loading/processing page
├── access.html             # Session-expired / resend-access page
├── exchange-token.html     # Handles email download-link token exchange
├── accessibility.html / privacy.html / terms.html / 404.html
│
├── css/
│   ├── main.css            # Merged: Tailwind utilities + custom styles (generated)
│   ├── hasil.css           # Page-specific styles untuk hasil.html
│   ├── tailwind.input.css  # Tailwind source (input untuk build)
│   └── archive/            # Backup originals (tailwind.css, style.css)
│
├── js/
│   ├── config.js           # ⚠️ WORKER_URL — satu-satunya tempat untuk update URL
│   ├── upload.js           # File reading + send to worker
│   ├── scoring.js          # Display scoring results (injects Tailwind classes)
│   ├── payment.js          # Tier selection + Mayar redirect
│   ├── download.js         # DOCX/PDF generation + session polling
│   ├── hasil-guard.js      # Auth guard — tidak di-bundle (harus sync mid-body)
│   ├── analytics.js        # PostHog analytics stubs
│   ├── posthog-init.js     # PostHog init
│   ├── *-page.js           # Page-specific orchestration
│   ├── dist/               # Generated bundles — gitignored, must build
│   │   ├── index.bundle.js
│   │   ├── upload.bundle.js
│   │   ├── hasil.bundle.js
│   │   ├── download.bundle.js
│   │   └── analyzing.bundle.js
│   └── vendor/             # Generated vendor libs — gitignored, must build
│       ├── docx.js         # docx@8.5.0 IIFE build
│       └── jspdf.umd.min.js # jspdf@2.5.1
│
├── worker/
│   ├── worker.js           # Entry point (~60 lines) — thin router only
│   ├── src/
│   │   ├── constants.js    # ALLOWED_ORIGINS, TIER_PRICES, SESSION_TTL, dll
│   │   ├── cors.js         # getCorsHeaders, jsonResponse
│   │   ├── rateLimit.js    # checkRateLimit, checkRateLimitKV, rateLimitResponse
│   │   ├── utils.js        # clientIp, log, sha256Hex, hexToken, dll
│   │   ├── claude.js       # callClaude — wrapper Anthropic API
│   │   ├── fileExtraction.js # validateFileData, extractCVText, extractTextFromDOCX
│   │   ├── analysis.js     # Orchestrator pipeline 6 stage (lihat Architecture)
│   │   ├── cacheVersions.js  # Cache-key version constants
│   │   ├── tailoring.js    # tailorCVID, tailorCVEN, validateCVSections
│   │   ├── mayar.js        # createMayarInvoice, verifyMayarWebhook
│   │   ├── sessions.js     # createSession, getSession, updateSession, dll
│   │   ├── email.js        # sendPaymentConfirmationEmail, sendCVReadyEmail
│   │   ├── cookies.js      # Cookie set/clear utilities
│   │   ├── sanitize.js     # Input sanitization (XSS, control chars, Latin-1)
│   │   ├── rewriteGuard.js # Hallucination guard for CV rewrites
│   │   ├── roleProfiles.js # Role-weighted scoring inputs
│   │   ├── interviewKitPdf.js # pdf-lib PDF generation for interview kit
│   │   ├── cvPdf.js          # Server-side PDF generation for CV email delivery
│   │   ├── router.js       # Route dispatch (semua path/method)
│   │   ├── prompts/
│   │   │   ├── extract.js  # SKILL_EXTRACT — verbatim extraction prompt
│   │   │   ├── analyze.js  # SKILL_ANALYZE — diagnose prompt (ID, HRD persona)
│   │   │   ├── diagnose.js # SKILL_DIAGNOSE — human-readable explanation prompt
│   │   │   ├── interviewKit.js # Interview kit generation prompt
│   │   │   ├── tailorId.js # SKILL_TAILOR_ID — CV rewrite (Bahasa Indonesia)
│   │   │   └── tailorEn.js # SKILL_TAILOR_EN — CV rewrite (English)
│   │   ├── pipeline/
│   │   │   ├── archetypes.js # Keyword map untuk deteksi archetype role
│   │   │   ├── validate.js   # Schema validators untuk semua LLM output
│   │   │   ├── analyze.js    # Stage 2: rule engine (pure JS)
│   │   │   ├── score.js      # Stage 3: 6D scoring formulas
│   │   │   ├── extract.js    # Stage 1: LLM call + validate + retry
│   │   │   └── diagnose.js   # Stage 4: LLM call + validate + retry
│   │   └── handlers/
│   │       ├── analyze.js        # POST /analyze
│   │       ├── createPayment.js  # POST /create-payment
│   │       ├── mayarWebhook.js   # POST /webhook/mayar
│   │       ├── sessionPing.js    # POST /session/ping
│   │       ├── checkSession.js   # GET /check-session
│   │       ├── validateSession.js # GET /validate-session
│   │       ├── getSession.js     # POST /get-session
│   │       ├── generate.js       # POST /generate
│   │       ├── getResult.js      # POST /get-result
│   │       ├── submitEmail.js    # POST /submit-email
│   │       ├── fetchJobUrl.js    # POST /fetch-job-url
│   │       ├── exchangeToken.js  # POST /exchange-token
│   │       ├── resendEmail.js    # POST /resend-email
│   │       ├── resendAccess.js   # POST /resend-access
│   │       ├── interviewKit.js   # POST /interview-kit
│   │       ├── validateCoupon.js # POST /validate-coupon
│   │       └── bypassPayment.js  # POST /bypass-payment (sandbox only, 404 in prod)
│   ├── test/
│   │   ├── worker.test.js     # Integration tests
│   │   ├── pipeline.test.js   # Pipeline stage unit tests
│   │   ├── sanitize.test.js   # Input sanitization tests
│   │   └── boundary.test.js   # Edge case / boundary tests
│   ├── package.json
│   └── vitest.config.js
│
├── scripts/
│   ├── build.js            # esbuild bundler per-page (+ watch mode)
│   └── vendor.js           # Copy vendor libs + build Tailwind CSS
│
├── assets/                 # Images, favicon, OG image
├── package.json            # Root — frontend build scripts
├── wrangler.toml           # Cloudflare Worker config
├── tailwind.config.js      # Tailwind purge config
├── _headers                # Cloudflare Pages security headers
└── _redirects              # Cloudflare Pages URL redirects
```

---

## Architecture Overview

GasLamar menggunakan **6-stage deterministic pipeline** untuk analisis CV. Arsitektur ini menggantikan satu prompt monolitik (`SKILL_ANALYZE`) yang sebelumnya menggabungkan ekstraksi, scoring, dan diagnosis dalam satu LLM call — yang menyebabkan hallucination, skor tidak konsisten, dan fabricated data.

```
POST /analyze
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 1 · EXTRACT (LLM — claude-haiku)                              │
│ SKILL_EXTRACT prompt: salin data verbatim dari CV dan JD.           │
│ Output: { cv: { skills_mentah, angka_di_cv, format_cv, ... },       │
│           jd: { skills_diminta, pengalaman_minimal, ... } }         │
│ Divalidasi oleh validate.js; retry sekali jika schema invalid.      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 2 · ANALYZE (pure JavaScript — no AI)                         │
│ pipeline/analyze.js: skill matching, format detection, archetype.   │
│ Output: { skill_match, format_ok, has_numbers, red_flag_types, ... }│
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 2.5 · ROLE INFERENCE (pure JavaScript — no AI)                │
│ pipeline/roleInference.js: classifies role, seniority, industry.    │
│ Feeds scoring weights (Stage 3), diagnose context (Stage 4),        │
│ and tailoring guidance (Stage 5).                                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 3 · SCORE (formula — no AI)                                   │
│ pipeline/score.js: 6 dimensi (north_star, recruiter_signal, effort, │
│ opportunity_cost, risk, portfolio), total skor, veredict DO/TIMED/  │
│ DO NOT, timebox_weeks, skor_sesudah — semua deterministik.          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 4 · DIAGNOSE (LLM — claude-haiku)                             │
│ SKILL_DIAGNOSE prompt: LLM menerima gap list + skor dari Stage 2/3. │
│ Hanya boleh MENJELASKAN — tidak boleh mengubah skor atau            │
│ menambah gap baru. Output: gap, rekomendasi, kekuatan, hr_7_detik.  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 5 · REWRITE (LLM — claude-haiku)  [dipanggil dari /generate] │
│ tailorCVID / tailorCVEN: rewrite CV sesuai JD dalam ID dan EN.      │
│ Tidak berubah dari pre-refactor.                                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 6 · VALIDATE (code)  [embedded di Stage 1 dan 4]              │
│ pipeline/validate.js: validateExtractOutput(), validateDiagnoseOutput()│
│ Schema check setelah setiap LLM call; retry dengan correction prompt.│
└─────────────────────────────────────────────────────────────────────┘
```

**Hasil:** LLM sekarang hanya bertanggung jawab untuk (1) menyalin data verbatim dan (2) memformat teks penjelasan. Semua keputusan scoring dan verdict dilakukan oleh kode deterministik.

**Caching strategy:**
- `extract_<version>_<hash>` — hasil Stage 1 (TTL 24 jam); bump versi di `worker/src/cacheVersions.js`
- `analysis_<version>_<hash>` — hasil final lengkap (TTL 48 jam); bump versi di `worker/src/cacheVersions.js`
- `cvtext_<token>` — menyimpan scoring snapshot bersama CV text (TTL 24 jam); diambil oleh `GET /get-scoring` sehingga hasil.html bisa di-refresh tanpa kehilangan data
- `gen_id_<version>_<hash>` / `gen_en_<version>_<hash>` — hasil tailoring CV (TTL 48 jam); bump prefix di `worker/src/cacheVersions.js`
- `kit_<session_id>_<language>` — interview kit (TTL 24 jam)

---

## Prerequisites

- Node.js 18+
- Akun Cloudflare (Workers + Pages)
- Akun Anthropic (Claude API)
- Akun Mayar (payment gateway Indonesia)
- `wrangler` CLI: `npm install -g wrangler` atau gunakan `npx wrangler`

---

## Step 1 — Cloudflare KV Setup

```bash
cd worker
npm install

# Buat KV namespace
npx wrangler kv:namespace create GASLAMAR_SESSIONS
npx wrangler kv:namespace create GASLAMAR_SESSIONS --preview
```

Update `wrangler.toml` dengan ID yang didapat. **Jangan share namespace antar environment**:

```toml
[[kv_namespaces]]
binding = "GASLAMAR_SESSIONS"
id = "PASTE_PRODUCTION_KV_ID_HERE"
preview_id = "PASTE_LOCAL_PREVIEW_KV_ID_HERE"

[[env.staging.kv_namespaces]]
binding = "GASLAMAR_SESSIONS"
id = "PASTE_STAGING_KV_ID_HERE"
```

Checklist isolasi KV:
- Production KV ID ≠ Staging KV ID
- Staging KV ID ≠ Local preview KV ID
- Local preview KV ID hanya untuk `wrangler dev`/preview

> **Note:** Rate limiter bindings (`RATE_LIMITER_ANALYZE`, dll.) sudah dikonfigurasi di `wrangler.toml` menggunakan Cloudflare's native rate limiting. Tidak perlu setup manual.

---

## Step 2 — Environment Variables (Secrets)

```bash
cd worker

# Anthropic API key (dari console.anthropic.com)
npx wrangler secret put ANTHROPIC_API_KEY

# Mayar API keys
# Sandbox: dari web.mayar.club → Settings → API Key
# Production: dari web.mayar.id → Settings → API Key
npx wrangler secret put MAYAR_API_KEY_SANDBOX
npx wrangler secret put MAYAR_API_KEY

# Mayar webhook secret (dari Settings → Webhook di dashboard Mayar)
npx wrangler secret put MAYAR_WEBHOOK_SECRET

# Resend API key — OPSIONAL, untuk email konfirmasi pembayaran
# Tanpa ini, worker berjalan normal tapi email tidak terkirim
npx wrangler secret put RESEND_API_KEY
```

Variabel `ENVIRONMENT` dikontrol via `wrangler.toml`:
```toml
[vars]
ENVIRONMENT = "sandbox"   # default — gunakan Mayar sandbox

[env.production.vars]
ENVIRONMENT = "production"  # aktif saat deploy dengan --env production
```

> **Jangan** run `npx wrangler deploy` tanpa `--env production` untuk deployment production. Default deploy (tanpa flag) menggunakan konfigurasi sandbox.

---

## Step 3 — Deploy Worker (Sandbox dulu)

```bash
cd worker

# Deploy ke sandbox (default)
npx wrangler deploy
# atau: npm run deploy

# Deploy ke production
npx wrangler deploy --env production
# atau: npm run deploy:prod
```

Catat Worker URL yang muncul, contoh:
```
https://gaslamar-worker.carolineratuolivia.workers.dev
```

Untuk memonitor logs real-time:
```bash
npm run tail
```

Jika test worker dijalankan di sandbox yang memblokir bind `127.0.0.1` (error `listen EPERM`), jalankan test di environment yang mengizinkan localhost bind.

Health check yang dipakai untuk monitor:
- Production/API route: `https://gaslamar.com/health`
- Staging/API route: `https://api-staging.gaslamar.com/health`

Catatan: URL `workers.dev` tidak dijadikan health source of truth untuk production routing.

---

## Step 4 — Build Frontend

`js/dist/` dan `js/vendor/` keduanya **gitignored** dan harus di-build sebelum deploy.

```bash
# Di root project (bukan di /worker)
npm install

# Build semua — CSP hash + vendor libs + Tailwind CSS + JS bundles + React + bundle hashes
npm run build

# Atau step by step:
npm run build:vendor   # Copy docx.js, jspdf, build Tailwind CSS dari tailwind.input.css
npm run build:js       # Bundle per-page JS ke js/dist/ menggunakan esbuild
npm run build:react    # Build React components (hasil page)
npm run build:csp      # Update CSP hash di _headers (run setelah ubah HTML inline scripts)
npm run build:hash     # Update bundle hashes di HTML (run setelah build:js / build:react)

# Watch mode untuk development
npm run dev            # Rebuild otomatis saat file js/*.js berubah (debounce 120ms)
```

**Apa yang dihasilkan:**

| Command | Output |
|---|---|
| `build:vendor` | `js/vendor/docx.js`, `js/vendor/jspdf.umd.min.js`, `css/tailwind.css` (regenerated) |
| `build:js` | `js/dist/index.bundle.js`, `upload.bundle.js`, `hasil.bundle.js`, `download.bundle.js`, `analyzing.bundle.js` |
| `build:react` | React component bundle for `hasil.html` |
| `build:csp` | Updates `integrity` / CSP hash values in `_headers` |
| `build:hash` | Updates `?v=<hash>` cache-busting params in HTML |

> **Note:** `js/hasil-guard.js` **tidak** di-bundle — ia harus berjalan sebagai `<script>` sync di mid-body untuk mencegah flash of unauthenticated content. Bundle lain menggunakan `defer`.

**CSS consolidation:** `css/main.css` adalah hasil merge dari `css/tailwind.css` (generated oleh `build:vendor`) dan `css/style.css` asli. Hanya `hasil.html` yang load CSS eksternal; `index.html`, `upload.html`, `download.html` menggunakan inline `<style>`.

---

## Step 5 — Cloudflare Pages Setup

1. Push repo ke GitHub
2. Buka Cloudflare Dashboard → Pages → Create application
3. Connect GitHub repo `gaslamar`
4. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm install && npm run build`
   - **Build output directory:** `/` (root)
5. Custom domain: `gaslamar.com`

> **Penting:** Build command harus `npm run build` (bukan `npm run vendor` seperti sebelumnya) agar JS bundles ikut ter-build.

---

## Step 6 — Register Mayar Webhook

**Sandbox:**
1. Login ke [web.mayar.club](https://web.mayar.club)
2. Settings → Webhook → Add webhook
3. URL: `https://gaslamar-worker.carolineratuolivia.workers.dev/webhook/mayar`
4. Events: **Invoice - Payment Success**
5. Copy webhook secret → `npx wrangler secret put MAYAR_WEBHOOK_SECRET`

**Production:**
1. Login ke [web.mayar.id](https://web.mayar.id)
2. Ulangi langkah yang sama dengan URL production worker
3. Set secret yang sama via wrangler

---

## Step 7 — Update Worker URL

**Satu tempat untuk update:** `js/config.js`

```javascript
// js/config.js
const WORKER_URL = 'https://gaslamar-worker.carolineratuolivia.workers.dev';
```

Semua JS files (`upload.js`, `payment.js`, `download.js`, `analyzing-page.js`, dll.) menggunakan `WORKER_URL` dari file ini via shared global. Tidak perlu update multiple files.

Setelah update `config.js`, jalankan ulang `npm run build` agar bundle ter-update.

---

## Step 8 — Testing End-to-End (Sandbox)

1. Buka Cloudflare Pages preview URL (atau `http://localhost:8080`)
2. Upload CV (PDF/DOCX/TXT) + paste job description
3. Tunggu analisis selesai — verifikasi response berisi `skor`, `skor_6d`, `gap`, `rekomendasi`
4. Pilih tier → klik bayar → redirect ke Mayar sandbox
5. Di Mayar sandbox: gunakan test payment
6. Verifikasi redirect ke `download.html?session=sess_...`
7. Klik generate → cek CV ID dan EN ter-generate
8. Test download DOCX dan PDF
9. Verifikasi health endpoint: `curl https://<worker-url>/health` → `{"status":"ok"}`

---

## Step 9 — Go Live

1. Pastikan semua secrets sudah di-set untuk environment production
2. Switch `ENVIRONMENT` ke `production` di `wrangler.toml` (via `[env.production.vars]`, sudah ada)
3. Set `MAYAR_API_KEY` production key: `npx wrangler secret put MAYAR_API_KEY`
4. Register webhook di `web.mayar.id` (production)
5. Deploy: `npm run deploy:prod` (dari `/worker`)
6. Trigger Pages build (push ke main atau manual deploy di dashboard)
7. Update DNS `gaslamar.com` ke Cloudflare Pages
8. Verifikasi: `curl https://gaslamar-worker.carolineratuolivia.workers.dev/health`

> CI/CD sudah dikonfigurasi via `.github/workflows/deploy.yml`: setiap push ke `main` otomatis menjalankan tests, deploy worker (production), build frontend, dan deploy ke Pages.

---

## Running Tests (Worker)

```bash
cd worker
npm test           # Run once (vitest run)
npm run test:watch # Watch mode — re-run on file changes
```

Test suite menggunakan `@cloudflare/vitest-pool-workers` — berjalan di real workerd runtime, bukan Node.js mock. Empat test file: `worker.test.js` (integration), `pipeline.test.js` (pipeline stages), `sanitize.test.js` (input sanitization), `boundary.test.js` (edge cases). Covers rate limiting, CORS, session flow, webhook HMAC verification, dan input sanitization.

Tests yang di-skip membutuhkan outbound API access (Claude + Mayar) — un-skip di CI dengan akses internet langsung atau tambahkan mock sequences:

```javascript
// Untuk PDF CV: 3 sequential Claude calls
fetchMock.reply(200, MOCK_PDF_EXTRACTION)  // 1. file extraction
fetchMock.reply(200, MOCK_EXTRACT_JSON)    // 2. SKILL_EXTRACT (Stage 1)
fetchMock.reply(200, MOCK_DIAGNOSE_JSON)   // 3. SKILL_DIAGNOSE (Stage 4)

// Untuk DOCX CV: 2 calls (tidak perlu file extraction)
fetchMock.reply(200, MOCK_EXTRACT_JSON)
fetchMock.reply(200, MOCK_DIAGNOSE_JSON)
```

---

## Security Checklist

- [x] Webhook HMAC-SHA256 signature verification (Mayar)
- [x] CORS strict — `gaslamar.com` dan `www.gaslamar.com` only
- [x] File validation server-side: magic bytes check (PDF: `%PDF`, DOCX: `PK`) + 5MB limit
- [x] `cv_text_key` bound to requesting IP — tidak bisa dipakai dari IP yang berbeda
- [x] Session secret hashed SHA-256, verified in constant time (timing-safe comparison)
- [x] Session UUID: `crypto.randomUUID()` + 256-bit hex token untuk `cv_text_key`
- [x] `/get-session` tolak status selain `paid` (harus bayar dulu)
- [x] Session lock (`lock_<session_id>`, TTL 120s) — cegah double-generation race condition
- [x] Credit exhaustion: sesi ditandai `exhausted` (bukan dihapus) sehingga `/check-session` bisa membedakan "habis" vs "tidak ditemukan"
- [x] Session TTL: 7 hari (single) atau 30 hari (multi-credit), bukan 30 menit
- [x] CV text minimum check (< 100 karakter = error)
- [x] Job description max 5.000 karakter
- [x] Claude API timeout 40 detik
- [x] **Dual-layer rate limiting pada `/analyze`:** Cloudflare native binding (atomic, no TOCTOU) + KV counter fallback — keduanya harus allow request
- [x] Rate limiting semua endpoint sensitif (3/min analyze, 5/min payment/generate/fetch)
- [x] Schema validation pada semua LLM output (validate.js) — reject + retry jika invalid
- [x] LLM output dibatasi: extract hanya salin verbatim, diagnose hanya jelaskan (tidak bisa ubah skor)
- [x] `localStorage` backup untuk session ID di browser
- [x] Double payment prevention (disable button after click)
- [x] Mobile download fallback (plain text jika DOCX/PDF generation gagal)
- [x] `docx.js` + `jsPDF` self-hosted (tidak ada CDN supply-chain risk)
- [x] `hasil-guard.js` berjalan sync — cegah flash of unauthenticated content
- [x] Cloudflare Observability enabled — logs + head sampling

---

## Pricing

| Tier         | Harga       | Isi                                          |
|--------------|-------------|----------------------------------------------|
| Coba Dulu    | Rp 29.000   | 1 CV, Bahasa Indonesia only, DOCX + PDF      |
| Single       | Rp 59.000   | 1 CV, bilingual ID + EN, DOCX + PDF          |
| 3-Pack       | Rp 149.000  | 3 CV, bilingual ID + EN, DOCX + PDF          |
| Job Hunt Pack| Rp 299.000  | 10 CV, bilingual ID + EN, DOCX + PDF         |

---

*Setup guide — GasLamar v2.0*
