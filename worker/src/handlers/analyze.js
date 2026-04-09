import { jsonResponse } from '../cors.js';
import { clientIp, hexToken } from '../utils.js';
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

  const { cv, job_desc } = body;

  if (!cv || !job_desc) {
    return jsonResponse({ message: 'CV dan job description wajib diisi' }, 400, request, env);
  }

  if (job_desc.length > 5000) {
    return jsonResponse({ message: 'Job description terlalu panjang (maks 5.000 karakter)' }, 400, request, env);
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
      ip,
    }), { expirationTtl: 7200 }); // 2 hours — gives users time to review hasil before paying

    return jsonResponse({ ...scoring, cv_text_key: cvTextKey }, 200, request, env);
  } catch (e) {
    return jsonResponse({ message: e.message || 'Analisis gagal. Coba lagi.' }, 500, request, env);
  }
}
