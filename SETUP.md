# GasLamar — Setup Guide

## Struktur Project

```
gaslamar/
├── index.html          # Landing page
├── upload.html         # Upload CV + job desc
├── hasil.html          # Scoring + gap analysis
├── download.html       # Download hasil CV
├── css/style.css       # Custom styles
├── js/
│   ├── upload.js       # File reading + send to worker
│   ├── scoring.js      # Display scoring results
│   ├── payment.js      # Tier selection + Mayar redirect
│   └── download.js     # DOCX/PDF generation + polling
├── worker/
│   ├── worker.js       # Cloudflare Worker (API proxy)
│   └── package.json
├── wrangler.toml       # Cloudflare Worker config
├── _headers            # Security headers
└── _redirects          # URL redirects
```

---

## Step 1: Cloudflare KV Setup

```bash
cd worker
npm install

# Create KV namespace
npx wrangler kv:namespace create GASLAMAR_SESSIONS
npx wrangler kv:namespace create GASLAMAR_SESSIONS --preview

# Copy the namespace IDs ke wrangler.toml
```

Update `wrangler.toml` dengan ID yang didapat:
```toml
[[kv_namespaces]]
binding = "GASLAMAR_SESSIONS"
id = "PASTE_YOUR_KV_ID_HERE"
preview_id = "PASTE_YOUR_PREVIEW_KV_ID_HERE"
```

---

## Step 2: Set Environment Variables (Secrets)

```bash
# Anthropic API key (dari console.anthropic.com)
npx wrangler secret put ANTHROPIC_API_KEY

# Mayar API keys (dari web.mayar.club untuk sandbox, web.mayar.id untuk production)
npx wrangler secret put MAYAR_API_KEY_SANDBOX
npx wrangler secret put MAYAR_API_KEY

# Mayar webhook secret (dari Settings > Webhook di dashboard Mayar)
npx wrangler secret put MAYAR_WEBHOOK_SECRET
```

---

## Step 3: Deploy Worker (Sandbox dulu)

```bash
# Deploy ke sandbox
npx wrangler deploy

# Note Worker URL yang muncul, contoh:
# https://gaslamar-worker.gaslamar.workers.dev
```

Update `WORKER_URL` di semua JS files:
- `js/upload.js` line 1
- `js/payment.js` line 1
- `js/download.js` line 1

---

## Step 4: Cloudflare Pages Setup

1. Push repo ke GitHub
2. Buka Cloudflare Dashboard → Pages → Create application
3. Connect GitHub repo `gaslamar`
4. Build settings:
   - Framework preset: None
   - Build command: (kosong)
   - Build output directory: `/` (root)
5. Custom domain: `gaslamar.com`

---

## Step 5: Register Mayar Webhook

1. Login ke `web.mayar.club` (sandbox) atau `web.mayar.id` (production)
2. Settings → Webhook → Add webhook
3. URL: `https://gaslamar-worker.gaslamar.workers.dev/webhook/mayar`
4. Events: Invoice - Payment Success
5. Copy webhook secret → set via `wrangler secret put MAYAR_WEBHOOK_SECRET`

---

## Step 6: Update Redirect URLs di download.js

Setelah `gaslamar.com` live, update redirect URL di `worker/worker.js`:
```javascript
const redirectUrl = `https://gaslamar.com/download.html?session=${encodeURIComponent(sessionId)}`;
```

---

## Step 7: Testing End-to-End (Sandbox)

1. Buka `http://localhost:8080` (atau Cloudflare Pages preview)
2. Upload CV + paste job description
3. Lihat hasil scoring
4. Pilih tier → klik bayar
5. Di Mayar sandbox: gunakan test payment
6. Verify redirect ke download page
7. Cek CV tergenerate + download berfungsi

---

## Step 8: Go Live

1. Switch `ENVIRONMENT` ke `production` di `wrangler.toml`
2. Set `MAYAR_API_KEY` (production key)
3. Register webhook di `web.mayar.id`
4. Deploy: `npx wrangler deploy --env production`
5. Update DNS gaslamar.com ke Cloudflare Pages

---

## Security Checklist

- [x] Webhook HMAC signature verification
- [x] CORS strict — gaslamar.com only
- [x] File validation server-side (magic bytes + size)
- [x] Session UUID v4 dari crypto.randomUUID()
- [x] localStorage backup untuk session ID
- [x] /get-session tolak status selain 'paid'
- [x] CV text minimum check (< 100 char = error)
- [x] Job desc max 3.000 karakter
- [x] Claude timeout 25 detik
- [x] Double payment prevention (disable button)
- [x] Mobile download fallback (plain text)
- [x] Rate limiting per IP per endpoint
- [x] Session one-time use (hapus setelah generate)
- [x] Session TTL 30 menit

---

## Pricing

| Tier         | Harga      | Isi                                         |
|--------------|------------|---------------------------------------------|
| Coba Dulu    | Rp 29.000  | 1 CV, Bahasa Indonesia only, DOCX + PDF     |
| Single       | Rp 59.000  | 1 CV, bilingual ID + EN, DOCX + PDF         |
| 3-Pack       | Rp 149.000 | 3 CV, bilingual ID + EN, DOCX + PDF         |
| Job Hunt Pack| Rp 299.000 | 10 CV, bilingual ID + EN, DOCX + PDF        |

---

*Setup guide — GasLamar v1.0*
