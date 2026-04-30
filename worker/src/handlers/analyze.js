import { jsonResponse } from '../cors.js';
import { clientIp, hexToken, logError } from '../utils.js';
import { checkRateLimit, checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';
import { validateFileData, extractCVText } from '../fileExtraction.js';
import { analyzeCV } from '../analysis.js';

export async function handleAnalyze(request, env) {
  const ip = clientIp(request);

  // Primary: Cloudflare native binding (atomic, no TOCTOU). Falls through if binding absent.
  // Secondary: KV-based counter — reliable even when the binding is misconfigured.
  // Both must allow the request for it to proceed.
  const [bindingOk, kvResult] = await Promise.all([
    checkRateLimit(env, env.RATE_LIMITER_ANALYZE, ip),
    checkRateLimitKV(env, ip, 3, 60, 'analyze'),
  ]);
  if (!bindingOk || !kvResult.allowed) {
    // Use the KV-computed remaining seconds when KV is the blocker; fall back to
    // the window length when the native binding is the blocker (it doesn't expose
    // a remaining-time API).
    const retryAfter = !kvResult.allowed ? (kvResult.retryAfter ?? 60) : 60;
    return rateLimitResponse(request, env, retryAfter);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { cv, job_desc: rawJobDesc } = body;

  if (!cv || !rawJobDesc) {
    return jsonResponse({ message: 'CV dan job description wajib diisi' }, 400, request, env);
  }

  // cv must arrive as a JSON string — non-string values fail deep inside validateFileData;
  // we reject early here to surface a clear error instead of a cryptic parse failure.
  if (typeof cv !== 'string') {
    return jsonResponse({ message: 'Format data CV tidak valid' }, 400, request, env);
  }

  // Guard against excessively large payloads before base64 decode — a 2MB base64 string
  // decodes to ~1.5MB which is within Worker memory limits, but wastes CPU and Claude tokens.
  const MAX_CV_SIZE = 2 * 1024 * 1024; // 2MB
  if (cv.length > MAX_CV_SIZE) {
    return jsonResponse({ message: 'CV terlalu besar (maks 2MB). Coba kompres atau konversi ke format teks.' }, 413, request, env);
  }

  if (typeof rawJobDesc !== 'string' || rawJobDesc.length > 5000) {
    return jsonResponse({ message: 'Job description terlalu panjang (maks 5.000 karakter)' }, 400, request, env);
  }

  // Strip HTML tags — treat job description as plain text only. This prevents XSS
  // payloads from being stored in KV and echoed in any future API response or email.
  const job_desc = rawJobDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Enforce minimum length server-side — client-side validation can be bypassed via
  // direct API calls or DevTools. A too-short JD wastes Claude credits on garbage output.
  if (job_desc.length < 100) {
    logError('analyze_invalid_input', { reason: 'jd_too_short', trimLen: job_desc.length, ip });
    return jsonResponse({ message: 'Job description terlalu pendek. Tulis minimal 100 karakter.' }, 400, request, env);
  }

  // Validate file
  const validation = validateFileData(cv);
  if (!validation.valid) {
    return jsonResponse({ message: validation.error }, 400, request, env);
  }

  // Extract text from CV
  const extraction = await extractCVText(cv, env);
  if (!extraction.success) {
    return jsonResponse({ message: extraction.error }, 422, request, env);
  }

  // Run scoring and store extracted text under a short-lived key
  // so /create-payment can reuse it without re-extracting the file
  try {
    const scoring = await analyzeCV(extraction.text, job_desc, env);
    // 256-bit random token (not UUID) so the key space is unguessable even under
    // targeted enumeration. Also bind to the requesting IP so the key cannot be
    // used from a different network if leaked from client storage.
    const cvTextKey = `cvtext_${hexToken(32)}`;
    await env.GASLAMAR_SESSIONS.put(cvTextKey, JSON.stringify({
      text: extraction.text,
      job_desc: job_desc.slice(0, 5000),
      // Carry inferred_role so /create-payment can copy it into the session,
      // enabling /generate to switch between targeted and inferred tailoring mode.
      inferred_role: scoring.inferred_role ?? null,
      ip,
    }), { expirationTtl: 86400 }); // 24 hours — gives users time to review hasil before paying

    return jsonResponse({ ...scoring, cv_text_key: cvTextKey }, 200, request, env);
  } catch (e) {
    logError('analyze_failed', {
      reason: e.message,
      cvLength: extraction.text.length,
      isTimeout: e.message && e.message.includes('timeout'),
    });
    return jsonResponse({ message: e.message || 'Analisis gagal. Coba lagi.' }, 500, request, env);
  }
}
