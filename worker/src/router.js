import { jsonResponse } from './cors.js';
import { clientIp, log, logError } from './utils.js';
import { checkRateLimitKV, rateLimitResponse } from './rateLimit.js';
import { sanitizeLogValue } from './sanitize.js';
import { handleAnalyze } from './handlers/analyze.js';
import { handleCreatePayment } from './handlers/createPayment.js';
import { handleMayarWebhook } from './handlers/mayarWebhook.js';
import { handleSessionPing } from './handlers/sessionPing.js';
import { handleCheckSession } from './handlers/checkSession.js';
import { handleValidateSession } from './handlers/validateSession.js';
import { handleGetSession } from './handlers/getSession.js';
import { handleGenerate } from './handlers/generate.js';
import { handleSubmitEmail } from './handlers/submitEmail.js';
import { handleFetchJobUrl } from './handlers/fetchJobUrl.js';
import { handleExchangeToken }  from './handlers/exchangeToken.js';
import { handleResendEmail }    from './handlers/resendEmail.js';
import { handleResendAccess }  from './handlers/resendAccess.js';
import { handleInterviewKit }  from './handlers/interviewKit.js';
import { handleGetResult } from './handlers/getResult.js';
import { handleBypassPayment } from './handlers/bypassPayment.js';
import { handleValidateCoupon } from './handlers/validateCoupon.js';

// CSRF defence: this worker and the Pages frontend are on different origins
// (workers.dev vs gaslamar.com). All state-mutating requests use
// credentials:'include', and getCorsHeaders() only reflects back allowed origins.
// Any future endpoint that mutates state MUST go through getCorsHeaders() so
// cross-origin requests from unlisted origins receive no CORS headers and are
// blocked by the browser. Do NOT add bare jsonResponse() calls to POST routes
// without verifying the Origin header first.
export async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  // Health check — must be first: no rate limiting, no auth, no KV reads.
  // Used by uptime monitors (UptimeRobot, Cloudflare Health Checks, etc.).
  if (method === 'GET' && pathname === '/health') {
    return jsonResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.ENVIRONMENT || 'unknown',
    }, 200, request, env);
  }

  if (method === 'POST' && pathname === '/analyze') {
    return handleAnalyze(request, env);
  }

  if (method === 'POST' && pathname === '/create-payment') {
    return handleCreatePayment(request, env);
  }

  if (method === 'POST' && pathname === '/webhook/mayar') {
    return handleMayarWebhook(request, env, ctx);
  }

  if (method === 'GET' && (pathname === '/session/ping' || pathname === '/api/session/ping')) {
    return jsonResponse({ status: 'ok' }, 200, request, env);
  }

  if (method === 'POST' && (pathname === '/session/ping' || pathname === '/api/session/ping')) {
    return handleSessionPing(request, env);
  }

  if (method === 'GET' && pathname === '/check-session') {
    return handleCheckSession(request, env);
  }

  if (method === 'GET' && pathname === '/validate-session') {
    return handleValidateSession(request, env);
  }

  if (method === 'POST' && pathname === '/get-session') {
    return handleGetSession(request, env);
  }

  if (method === 'POST' && pathname === '/generate') {
    return handleGenerate(request, env, ctx);
  }

  if (method === 'POST' && pathname === '/get-result') {
    return handleGetResult(request, env);
  }

  if (method === 'POST' && pathname === '/submit-email') {
    return handleSubmitEmail(request, env);
  }

  if (method === 'POST' && pathname === '/fetch-job-url') {
    return handleFetchJobUrl(request, env);
  }

  if (method === 'POST' && pathname === '/exchange-token') {
    return handleExchangeToken(request, env);
  }

  if (method === 'POST' && pathname === '/resend-email') {
    return handleResendEmail(request, env);
  }

  if (method === 'POST' && pathname === '/resend-access') {
    return handleResendAccess(request, env);
  }

  if (method === 'POST' && (pathname === '/interview-kit' || pathname === '/api/interview-kit')) {
    return handleInterviewKit(request, env);
  }

  if (method === 'POST' && pathname === '/bypass-payment') {
    return handleBypassPayment(request, env);
  }

  if (method === 'POST' && pathname === '/validate-coupon') {
    return handleValidateCoupon(request, env);
  }


  if (method === 'POST' && pathname === '/api/log') {
    const ip = clientIp(request);
    const kvResult = await checkRateLimitKV(env, ip, 30, 60, 'client_log');
    if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60);
    const contentType = request.headers.get('Content-Type') || '';
    // Read the body as text first and enforce actual byte count — not Content-Length,
    // which is client-supplied and can be absent or falsified (chunked transfer, no header).
    const bodyText = await request.text().catch(() => '');
    if (bodyText.length > 8192) {
      console.warn(JSON.stringify({ event: 'client_log_oversized', bodyLength: bodyText.length, ip }));
      return jsonResponse({ ok: false, message: 'Payload terlalu besar' }, 413, request, env);
    }
    const rawBody = contentType.includes('application/json')
      ? (() => { try { const p = JSON.parse(bodyText); return (p !== null && typeof p === 'object' && !Array.isArray(p)) ? p : {}; } catch { return {}; } })()
      : { raw: bodyText };
    // Sanitize all string values before writing to logs to prevent log injection
    const body = Object.fromEntries(
      Object.entries(rawBody).map(([k, v]) => [sanitizeLogValue(k, 100), sanitizeLogValue(v, 500)])
    );
    log('client_log', { body, ip });
    return jsonResponse({ ok: true }, 200, request, env);
  }

  if (method === 'POST' && pathname === '/feedback') {
    const ip = clientIp(request);
    const kvResult = await checkRateLimitKV(env, ip, 10, 60, 'feedback');
    if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60);
    const feedbackText = await request.text().catch(() => '');
    if (feedbackText.length > 4096) {
      return jsonResponse({ ok: false, message: 'Payload terlalu besar' }, 413, request, env);
    }
    const body = feedbackText
      ? (() => { try { return JSON.parse(feedbackText); } catch { return {}; } })()
      : {};
    // Validate type against an allowlist — reject anything not in it to prevent log spam
    const VALID_FEEDBACK_TYPES = new Set(['interview_outcome', 'cv_quality', 'experience', 'other']);
    const type = typeof body.type === 'string' && VALID_FEEDBACK_TYPES.has(body.type) ? body.type : 'unknown';
    // Cap answer length and sanitize control chars — fire-and-forget, no need to reject
    const answer = sanitizeLogValue(typeof body.answer === 'string' ? body.answer : '', 1000);
    log('user_feedback', { type, answer, ip });
    return jsonResponse({ ok: true }, 200, request, env);
  }

  // In production the Worker owns gaslamar.com/* — proxy unmatched GET/HEAD requests
  // to the Pages deployment so HTML pages and static assets are served correctly.
  // redirect:'manual' prevents an infinite loop if Pages ever redirects pages.dev
  // back to gaslamar.com (the Worker would follow that redirect into itself).
  if ((method === 'GET' || method === 'HEAD') && env.ENVIRONMENT === 'production') {
    // Hardcoded — never sourced from env vars to prevent open proxy misconfiguration.
    // pathname and url.search come from the request but only form path/query, not hostname.
    const pagesUrl = 'https://gaslamar.pages.dev' + pathname + url.search;
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('host');
    try {
      return await fetch(new Request(pagesUrl, {
        method: request.method,
        headers: proxyHeaders,
        redirect: 'manual',
      }));
    } catch (err) {
      logError('pages_proxy_error', { path: pathname, error: String(err) });
      return jsonResponse({ message: 'Service temporarily unavailable' }, 503, request, env);
    }
  }

  return jsonResponse({ message: 'Not found' }, 404, request, env);
}
