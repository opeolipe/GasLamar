# GasLamar API Reference

Base URLs:
- **Production:** `https://gaslamar.com`
- **Staging:** `https://api-staging.gaslamar.com`

All endpoints accept and return JSON. Rate limits apply per IP.

---

## POST /analyze

Analyzes a CV against a job description and returns a scoring result.

**Rate limit:** 3 requests / 60 s per IP.

### Request

```
Content-Type: application/json
```

| Field | Aliases accepted | Type | Required | Description |
|---|---|---|---|---|
| `cv` | `cv_text` | string | Yes | CV text (plain text, max 2 MB). PDF/DOCX must be pre-extracted to text client-side. |
| `job_desc` | `jd`, `job_description` | string | Yes | Job description text (100–5,000 chars). |

```json
{
  "cv": "Nama: Budi Santoso\nPengalaman: 3 tahun sebagai Software Engineer...",
  "job_desc": "Kami mencari Software Engineer dengan pengalaman minimal 2 tahun di bidang backend..."
}
```

### Response `200 OK`

Returns a scoring object and sets an `HttpOnly` session cookie (`cv_key`).

```json
{
  "skor": 72,
  "verdict": "DO",
  "skor_sesudah": 87,
  "skor_6d": { ... },
  "cv_text_key": "cvtext_abc123..."
}
```

### Error Responses

| Status | `message` | Cause |
|---|---|---|
| `400` | `CV wajib diisi` | `cv` / `cv_text` field missing or empty |
| `400` | `Format data CV tidak valid` | `cv` is not a string |
| `400` | `Job description wajib diisi.` | `job_desc` / `jd` / `job_description` missing or empty after sanitization |
| `400` | `Job description terlalu panjang (maks 5.000 karakter)` | JD exceeds 5,000 chars |
| `400` | `Job description terlalu pendek. Tulis minimal 100 karakter.` | JD under 100 chars |
| `400` | `Job description mengandung konten yang tidak diizinkan.` | Prompt injection detected |
| `400` | `Request body tidak valid` | Body is not valid JSON |
| `413` | `CV terlalu besar (maks 2MB). Coba kompres atau konversi ke format teks.` | CV exceeds 2 MB |
| `422` | `CV format tidak didukung. Gunakan PDF berbasis teks, bukan hasil scan.` | CV is an image-based scan |
| `429` | (rate limit) | Too many requests |
| `500` | `Analisis gagal. Coba lagi.` | Unexpected server error |

### Example (curl)

```bash
curl -s -X POST https://api-staging.gaslamar.com/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "cv": "Nama: Budi Santoso\nPengalaman: ...",
    "job_desc": "Kami mencari Software Engineer dengan pengalaman..."
  }' | jq .
```

---

## POST /generate

Generates a tailored CV in Indonesian and/or English. Requires an active session cookie from `/analyze`.

See `worker/src/handlers/getGenerate.js` for field details.

---

## GET /get-scoring

Returns the scoring snapshot for an existing session without re-running the pipeline.

```
GET /get-scoring?key=cvtext_<token>
```

Returns `{ scoring: { ... } }` or `404` if the key has expired.

---

## POST /feedback

Fire-and-forget user survey submission. No auth required.

```json
{ "type": "cv_quality", "rating": 4, "comment": "..." }
```

Valid `type` values: `interview_outcome`, `cv_quality`, `experience`, `other`.
