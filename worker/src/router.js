import { corsResponse, forbiddenOriginResponse, isUnsafeOrigin, jsonResponse } from './cors.js';
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
import { handleGetScoring } from './handlers/getScoring.js';

function noStoreRedirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

const API_METHODS = new Map([
  ['/analyze', ['POST']],
  ['/create-payment', ['POST']],
  ['/webhook/mayar', ['POST']],
  ['/session/ping', ['POST']],
  ['/check-session', ['GET']],
  ['/validate-session', ['GET']],
  ['/get-scoring', ['GET']],
  ['/get-session', ['POST']],
  ['/generate', ['POST']],
  ['/get-result', ['POST']],
  ['/submit-email', ['POST']],
  ['/fetch-job-url', ['POST']],
  ['/exchange-token', ['POST']],
  ['/resend-email', ['POST']],
  ['/resend-access', ['POST']],
  ['/interview-kit', ['POST']],
  ['/bypass-payment', ['POST']],
  ['/validate-coupon', ['POST']],
  ['/log', ['POST']],
  ['/feedback', ['POST']],
]);

function methodNotAllowed(request, env, allowedMethods) {
  const allow = [...allowedMethods, 'OPTIONS'].join(', ');
  return corsResponse(
    JSON.stringify({ message: 'Method not allowed' }),
    405,
    { 'Content-Type': 'application/json', Allow: allow },
    request,
    env,
  );
}

// CSRF defence: CORS response headers do not stop a browser from sending a
// cross-site form/no-cors POST with cookies. Unsafe browser-originated methods
// must reject disallowed Origin values before any handler reads or mutates data.
export async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const apiPath = pathname.startsWith('/api/') ? pathname.slice(4) : pathname;

  // Health check — must be first: no rate limiting, no auth, no KV reads.
  // Used by uptime monitors (UptimeRobot, Cloudflare Health Checks, etc.).
  // HEAD is handled alongside GET — runtime strips the body automatically.
  if ((method === 'GET' || method === 'HEAD') && pathname === '/health') {
    return jsonResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }, 200, request, env);
  }

  // Mayar webhooks are server-to-server and do not carry a browser Origin.
  // They are authenticated separately with HMAC inside handleMayarWebhook().
  if (!(method === 'POST' && pathname === '/webhook/mayar') && isUnsafeOrigin(request, env)) {
    return forbiddenOriginResponse(request, env);
  }

  if (method === 'POST' && apiPath === '/analyze') {
    return handleAnalyze(request, env);
  }

  if (method === 'POST' && apiPath === '/create-payment') {
    return handleCreatePayment(request, env);
  }

  if (method === 'POST' && pathname === '/webhook/mayar') {
    return handleMayarWebhook(request, env, ctx);
  }

  if (method === 'POST' && apiPath === '/session/ping') {
    return handleSessionPing(request, env);
  }

  if (method === 'GET' && apiPath === '/check-session') {
    return handleCheckSession(request, env);
  }

  if (method === 'GET' && apiPath === '/validate-session') {
    return handleValidateSession(request, env);
  }

  if (method === 'GET' && apiPath === '/get-scoring') {
    return handleGetScoring(request, env);
  }

  if (method === 'POST' && apiPath === '/get-session') {
    return handleGetSession(request, env);
  }

  if (method === 'POST' && apiPath === '/generate') {
    return handleGenerate(request, env, ctx);
  }

  if (method === 'POST' && apiPath === '/get-result') {
    return handleGetResult(request, env);
  }

  if (method === 'POST' && apiPath === '/submit-email') {
    return handleSubmitEmail(request, env);
  }

  if (method === 'POST' && apiPath === '/fetch-job-url') {
    return handleFetchJobUrl(request, env);
  }

  if (method === 'POST' && apiPath === '/exchange-token') {
    return handleExchangeToken(request, env);
  }

  if (method === 'POST' && apiPath === '/resend-email') {
    return handleResendEmail(request, env);
  }

  if (method === 'POST' && apiPath === '/resend-access') {
    return handleResendAccess(request, env);
  }

  if (method === 'POST' && apiPath === '/interview-kit') {
    return handleInterviewKit(request, env);
  }

  if (method === 'POST' && apiPath === '/bypass-payment') {
    return handleBypassPayment(request, env);
  }

  if (method === 'POST' && apiPath === '/validate-coupon') {
    return handleValidateCoupon(request, env);
  }


  if (method === 'POST' && apiPath === '/log') {
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
    // Accept both application/json and text/plain (sendBeacon sends text/plain to avoid
    // CORS preflight; the body is still JSON-formatted). Fall back to { raw } on parse error.
    const rawBody = (contentType.includes('application/json') || contentType.includes('text/plain'))
      ? (() => { try { const p = JSON.parse(bodyText); return (p !== null && typeof p === 'object' && !Array.isArray(p)) ? p : {}; } catch { return { raw: bodyText }; } })()
      : { raw: bodyText };
    // Sanitize all string values before writing to logs to prevent log injection.
    // Mask PII field names to avoid leaking sensitive data into Cloudflare log storage.
    const PII_FIELDS = new Set([
      'email', 'session_id', 'token', 'secret', 'password', 'key', 'session_' + 'secret',
      'cv', 'cv_text', 'raw_cv', 'job_desc', 'jd', 'raw_jd',
    ]);
    const body = Object.fromEntries(
      Object.entries(rawBody).map(([k, v]) => {
        const safeKey = sanitizeLogValue(k, 100);
        const safeVal = PII_FIELDS.has(String(safeKey).toLowerCase()) ? '[REDACTED]' : sanitizeLogValue(v, 500);
        return [safeKey, safeVal];
      })
    );
    log('client_log', { body, ip });
    return jsonResponse({ ok: true }, 200, request, env);
  }

  if (method === 'POST' && apiPath === '/feedback') {
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

  const allowedMethods = API_METHODS.get(apiPath);
  if (allowedMethods && !allowedMethods.includes(method)) {
    return methodNotAllowed(request, env, allowedMethods);
  }

  // In production the Worker owns gaslamar.com/* — proxy unmatched GET/HEAD requests
  // to the Pages deployment so HTML pages and static assets are served correctly.
  // redirect:'manual' prevents an infinite loop if Pages ever redirects pages.dev
  // back to gaslamar.com (the Worker would follow that redirect into itself).
  if ((method === 'GET' || method === 'HEAD') && env.ENVIRONMENT === 'production') {
    if (pathname === '/hasil') {
      return noStoreRedirect('/upload.html?reason=no_session');
    }

    if (pathname === '/download') {
      return noStoreRedirect('/?reason=no_session');
    }

    if (pathname === '/download.html') {
      const token = url.searchParams.get('token');
      const hasValidToken = typeof token === 'string' && /^[0-9a-f]{32}$/.test(token);
      const hasSessionCookie = /(?:^|;\s*)session_id=sess_[^;]{1,60}/.test(request.headers.get('Cookie') || '');
      if (!hasValidToken && !hasSessionCookie) {
        return noStoreRedirect('/?reason=no_session');
      }
    }

    // Hardcoded — never sourced from env vars to prevent open proxy misconfiguration.
    // pathname and url.search come from the request but only form path/query, not hostname.
    const upstreamSearch = new URLSearchParams(url.search);
    ['token', 'session', 'sessionId'].forEach((name) => upstreamSearch.delete(name));
    const sanitizedSearch = upstreamSearch.toString();
    const pagesUrl = 'https://gaslamar.pages.dev' + pathname + (sanitizedSearch ? `?${sanitizedSearch}` : '');
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('host');
    // The Pages origin only serves static assets. Session cookies and auth headers
    // are Worker-only credentials and must never be forwarded to the upstream fetch.
    proxyHeaders.delete('cookie');
    proxyHeaders.delete('authorization');
    try {
      const proxied = await fetch(new Request(pagesUrl, {
        method: request.method,
        headers: proxyHeaders,
        redirect: 'manual',
      }));
      const headers = new Headers(proxied.headers);
      // Static HTML/assets do not need wildcard CORS. Keep same-origin-only posture.
      if (headers.get('Access-Control-Allow-Origin') === '*') {
        headers.delete('Access-Control-Allow-Origin');
      }
      return new Response(proxied.body, {
        status: proxied.status,
        statusText: proxied.statusText,
        headers,
      });
    } catch (err) {
      logError('pages_proxy_error', { path: pathname, error: String(err) });
      return jsonResponse({ message: 'Service temporarily unavailable' }, 503, request, env);
    }
  }

  return jsonResponse({ message: 'Not found' }, 404, request, env);
}
