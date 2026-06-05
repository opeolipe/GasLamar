import { jsonResponse, getCorsHeaders, SECURITY_HEADERS } from '../cors.js';
import { clientIp, hexToken, logError } from '../utils.js';
import { makeCvKeyCookie, makeSessionTokenCookie } from '../cookies.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { checkRateLimit, checkRateLimitKVSession, rateLimitResponse, addRateLimitHeaders } from '../rateLimit.js';
import { validateFileData, extractCVText } from '../fileExtraction.js';
import { analyzeCV } from '../analysis.js';
import { sanitizeForLLM, hasPromptInjection, escapeHtml } from '../sanitize.js';

function extractSampleLineFromText(text) {
  if (!text) return null;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 20);
  const bullet = lines.find(l =>
    l.startsWith('•') || l.startsWith('-') ||
    /^(manage|develop|create|mengelola|membuat|mengembangkan)/i.test(l)
  );
  return bullet || lines[0] || null;
}

const ANALYZE_WINDOW_SECS = 900;  // 15-minute sliding window
const ANALYZE_IP_LIMIT    = 5;    // unauthenticated: 5 requests per 15 min
const ANALYZE_SESS_LIMIT  = 10;   // paying session: 10 requests per 15 min

export async function handleAnalyze(request, env) {
  const ip        = clientIp(request);
  const sessionId = getSessionIdFromCookie(request);

  // Primary: Cloudflare native binding (atomic, no TOCTOU). Falls through if binding absent.
  // Secondary: KV-based sliding-window counter — authoritative 15-minute gate.
  // Authenticated sessions (paying users) get a higher limit than anonymous IPs.
  // Both layers must allow the request to proceed.
  const [bindingOk, kvResult] = await Promise.all([
    checkRateLimit(env, env.RATE_LIMITER_ANALYZE, ip),
    checkRateLimitKVSession(env, ip, sessionId, ANALYZE_IP_LIMIT, ANALYZE_SESS_LIMIT, ANALYZE_WINDOW_SECS, 'analyze'),
  ]);
  if (!bindingOk || !kvResult.allowed) {
    const retryAfter = !kvResult.allowed ? (kvResult.retryAfter ?? ANALYZE_WINDOW_SECS) : ANALYZE_WINDOW_SECS;
    return rateLimitResponse(request, env, retryAfter, kvResult);
  }
  const withRl = res => addRateLimitHeaders(res, kvResult);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return withRl(jsonResponse({ message: 'Request body tidak valid' }, 400, request, env));
  }

  // Accept common aliases so direct API callers don't need to guess the canonical names.
  const cv = body.cv ?? body.cv_text;
  const rawJobDesc = body.job_desc ?? body.jd ?? body.job_description;

  if (!cv) {
    return withRl(jsonResponse({ message: 'CV wajib diisi' }, 400, request, env));
  }

  // cv must arrive as a JSON string — non-string values fail deep inside validateFileData;
  // we reject early here to surface a clear error instead of a cryptic parse failure.
  if (typeof cv !== 'string') {
    return withRl(jsonResponse({ message: 'Format data CV tidak valid' }, 400, request, env));
  }

  // Direct API callers may send cv_text as a plain text string rather than the internal
  // {"type":"txt","data":"..."} envelope the frontend uses. Auto-wrap so both forms work.
  const cvNormalized = cv.trimStart().startsWith('{') ? cv : JSON.stringify({ type: 'txt', data: cv });

  // Guard against excessively large payloads before base64 decode — a 2MB base64 string
  // decodes to ~1.5MB which is within Worker memory limits, but wastes CPU and Claude tokens.
  const MAX_CV_SIZE = 2 * 1024 * 1024; // 2MB
  if (cv.length > MAX_CV_SIZE) {
    return withRl(jsonResponse({ message: 'CV terlalu besar (maks 2MB). Coba kompres atau konversi ke format teks.' }, 413, request, env));
  }

  if (rawJobDesc === undefined || rawJobDesc === null) {
    logError('analyze_invalid_input', { reason: 'jd_missing', ip });
    return withRl(jsonResponse({ message: 'Job description wajib diisi.' }, 400, request, env));
  }

  if (typeof rawJobDesc !== 'string' || rawJobDesc.length > 5000) {
    return withRl(jsonResponse({ message: 'Job description terlalu panjang (maks 5.000 karakter)' }, 400, request, env));
  }

  // Hard-reject inputs that contain dangerous HTML/script payloads before any processing.
  // Prevents XSS payloads from being stored in KV or echoed in future responses.
  // This check runs on the raw input (before stripping) so that obfuscated patterns
  // such as `java&#115;cript:` are not silently normalised away.
  const UNSAFE_HTML_RE = /<script|<iframe|<img\b|onerror\s*=|onload\s*=|javascript\s*:/i;
  if (UNSAFE_HTML_RE.test(rawJobDesc)) {
    logError('analyze_invalid_input', { reason: 'jd_unsafe_html', ip });
    return withRl(jsonResponse({ message: 'Input contains unsafe content.' }, 400, request, env));
  }

  // Strip any remaining HTML tags — treat job description as plain text only.
  const rawJobDescStripped = rawJobDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Hard-reject before any further processing if the JD contains injection patterns.
  if (hasPromptInjection(rawJobDescStripped)) {
    logError('analyze_invalid_input', { reason: 'jd_injection', ip });
    return withRl(jsonResponse({ message: 'Job description mengandung konten yang tidak diizinkan.' }, 400, request, env));
  }

  const job_desc = sanitizeForLLM(rawJobDescStripped);

  if (!job_desc.length) {
    logError('analyze_invalid_input', { reason: 'jd_missing', ip });
    return withRl(jsonResponse({ message: 'Job description wajib diisi.' }, 400, request, env));
  }

  if (job_desc.length < 100) {
    logError('analyze_invalid_input', { reason: 'jd_too_short', trimLen: job_desc.length, ip });
    return withRl(jsonResponse({ message: 'Job description terlalu pendek. Tulis minimal 100 karakter.' }, 400, request, env));
  }

  // Validate file
  const validation = validateFileData(cvNormalized);
  if (!validation.valid) {
    return withRl(jsonResponse({ message: validation.error }, 400, request, env));
  }

  // Extract text from CV
  const extraction = await extractCVText(cvNormalized, env);
  if (!extraction.success) {
    return withRl(jsonResponse({ message: extraction.error }, 422, request, env));
  }

  // Universal minimum-length gate — covers PDF and DOCX paths that only check >100 chars
  // internally. txt already rejects below 1500 in extractCVText, so this is a safety net.
  if (extraction.text.trim().length < 1500) {
    return withRl(jsonResponse(
      { message: 'CV kamu terlalu singkat. Pastikan CV lengkap dikirim — minimal 1.500 karakter.' },
      422,
      request,
      env,
    ));
  }

  // Run scoring and store extracted text under a short-lived key
  // so /create-payment can reuse it without re-extracting the file
  try {
    const scoring = await analyzeCV(extraction.text, job_desc, env);
    // 256-bit random token (not UUID) so the key space is unguessable even under
    // targeted enumeration. Also bind to the requesting IP so the key cannot be
    // used from a different network if leaked from client storage.
    const cvTextKey = `cvtext_${hexToken(32)}`;

    // Cryptographically random ID for analytics correlation across analyze→generate.
    // Generated server-side so clients cannot forge or enumerate other users' IDs.
    const resultId = crypto.randomUUID();

    // Store the full scoring result alongside cv_text so GET /get-scoring can serve
    // it to hasil.html without the client carrying the entire blob in sessionStorage.
    // cv_text stays server-side and is consumed later by /generate.
    await env.GASLAMAR_SESSIONS.put(cvTextKey, JSON.stringify({
      text: extraction.text,
      job_desc: escapeHtml(job_desc.slice(0, 5000)),
      // Carry inferred_role so /create-payment can copy it into the session,
      // enabling /generate to switch between targeted and inferred tailoring mode.
      inferred_role: scoring.inferred_role ?? null,
      ip,
      result_id: resultId,
      scoring, // used by GET /get-scoring; cv_text is never exposed via that endpoint
    }), { expirationTtl: 86400 }); // 24 hours — gives users time to review hasil before paying

    // Create a lightweight analysis session record. The sessionToken cookie carries the
    // UUID; the cvtext_ entry is never exposed directly to the browser.
    const analysisSessionId = crypto.randomUUID();
    const now = Date.now();
    await env.GASLAMAR_SESSIONS.put(
      `analysis_session_${analysisSessionId}`,
      JSON.stringify({
        sessionId:  analysisSessionId,
        resultId,
        cvKey:      cvTextKey,
        createdAt:  now,
        expiresAt:  now + 86400 * 1000,
      }),
      { expirationTtl: 86400 },
    );

    // Build response with both cookies (cv_key + sessionToken) and X-RateLimit-* headers.
    // Headers API is used directly so multiple Set-Cookie values are preserved — plain
    // object spreading collapses duplicate keys and loses the second cookie.
    const corsHeaders = getCorsHeaders(request, env);
    const rlHeaders = {};
    if (kvResult.limit     !== undefined) rlHeaders['X-RateLimit-Limit']     = String(kvResult.limit);
    if (kvResult.remaining !== undefined) rlHeaders['X-RateLimit-Remaining'] = String(kvResult.remaining);
    if (kvResult.reset     !== undefined) rlHeaders['X-RateLimit-Reset']     = String(kvResult.reset);
    const responseHeaders = new Headers({
      ...SECURITY_HEADERS,
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...rlHeaders,
    });
    responseHeaders.append('Set-Cookie', makeCvKeyCookie(cvTextKey, env));
    responseHeaders.append('Set-Cookie', makeSessionTokenCookie(analysisSessionId, env));
    const sampleLine = extractSampleLineFromText(extraction.text);
    // analysis_session_id is returned so browsers that block cross-site cookies (e.g. Safari ITP)
    // can store it in sessionStorage and pass it via X-Analysis-Session header as a fallback.
    return new Response(JSON.stringify({ ...scoring, result_id: resultId, analysis_session_id: analysisSessionId, ...(sampleLine ? { sample_line: sampleLine } : {}) }), { status: 200, headers: responseHeaders });
  } catch (e) {
    logError('analyze_failed', {
      reason: e.message,
      cvLength: extraction.text.length,
      isTimeout: e.message && e.message.includes('timeout'),
    });
    const schemaFailure = e.message && e.message.includes('format_cv');
    if (schemaFailure) {
      return withRl(jsonResponse({ message: 'CV format tidak didukung. Gunakan PDF berbasis teks, bukan hasil scan.' }, 422, request, env));
    }
    return withRl(jsonResponse({ message: 'Analisis gagal. Coba lagi.' }, 500, request, env));
  }
}
