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

  // Probe Mayar with a lightweight coupon-validate call (invalid code → 4xx but proves reachability).
  // Using invoice/create would create a real invoice, so we use a known-invalid probe instead.
  const probe = `${apiUrl}/coupon/validate?couponCode=__health_probe__&finalAmount=1`;
  let mayarStatus = 'unknown';
  let mayarLatencyMs = null;
  let reachable = false;

  try {
    const t0 = Date.now();
    const res = await fetch(probe, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    mayarLatencyMs = Date.now() - t0;
    // Any response (including 4xx for invalid coupon) means Mayar is reachable.
    reachable = true;
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
