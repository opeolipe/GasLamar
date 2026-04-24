import { jsonResponse } from './cors.js';
import { clientIp, log } from './utils.js';
import { checkRateLimitKV, rateLimitResponse } from './rateLimit.js';
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
import { handleInterviewKit }  from './handlers/interviewKit.js';

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

  if (method === 'POST' && pathname === '/session/ping') {
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

  if (method === 'POST' && pathname === '/interview-kit') {
    return handleInterviewKit(request, env);
  }

  if (method === 'POST' && pathname === '/feedback') {
    const ip = clientIp(request);
    const kvResult = await checkRateLimitKV(env, ip, 10, 60, 'feedback');
    if (!kvResult.allowed) return rateLimitResponse(request, env, kvResult.retryAfter ?? 60);
    const body = await request.json().catch(() => ({}));
    log('user_feedback', { type: body.type, answer: body.answer, ip });
    return jsonResponse({ ok: true }, 200, request, env);
  }

  return jsonResponse({ message: 'Not found' }, 404, request, env);
}
