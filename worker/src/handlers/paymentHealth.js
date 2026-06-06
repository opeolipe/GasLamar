import { jsonResponse } from '../cors.js';
import { getMayarApiUrl, getMayarApiKey } from '../mayar.js';

export async function handlePaymentHealth(request, env) {
  const apiUrl = getMayarApiUrl(env);
  const apiKey = getMayarApiKey(env);

  if (!apiKey) {
    return jsonResponse({
      status: 'error',
      gateway: 'mayar',
      reason: 'API key not configured',
      environment: env.ENVIRONMENT ?? 'unknown',
    }, 503, request, env);
  }

  // Probe the exact invoice route with an intentionally invalid empty body.
  // A 400/401 response proves the API route exists without creating an invoice;
  // 404 means the configured gateway/path is wrong, and 5xx means upstream is unhealthy.
  const probe = `${apiUrl}/invoice/create`;
  let mayarStatus = 'unknown';
  let mayarLatencyMs = null;
  let reachable = false;

  try {
    const t0 = Date.now();
    const res = await fetch(probe, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000),
    });
    mayarLatencyMs = Date.now() - t0;
    // 400/401/422 prove the route is live and rejecting the intentionally invalid probe.
    // 404 is a bad gateway/path config; 5xx is an upstream outage.
    reachable = res.ok || [400, 401, 422].includes(res.status);
    mayarStatus = res.ok ? 'ok' : `http_${res.status}`;
  } catch (e) {
    mayarStatus = e.name === 'TimeoutError' ? 'timeout' : 'unreachable';
  }

  const healthy = reachable;
  return jsonResponse({
    status: healthy ? 'ok' : 'degraded',
    gateway: 'mayar',
    gateway_status: mayarStatus,
    gateway_latency_ms: mayarLatencyMs,
    environment: env.ENVIRONMENT ?? 'unknown',
    timestamp: new Date().toISOString(),
  }, healthy ? 200 : 503, request, env);
}
