import { jsonResponse } from '../cors.js';
import { getSession, updateSession } from '../sessions.js';
import { getMayarApiUrl, getMayarApiKey } from '../mayar.js';
import { log } from '../utils.js';
import { SESSION_STATES } from '../sessionStates.js';

// POST /admin/cancel-invoice
// Staging-only endpoint for cancelling orphaned Mayar invoices after test runs.
// Requires X-Admin-Token header matching the ADMIN_SECRET env var.
// Body: { session_id: "sess_..." }
//
// This is intentionally NOT available in production (returns 404).
// It prevents manual web.mayar.club dashboard cleanup after automated test runs.
export async function handleAdminCancelInvoice(request, env) {
  if (env.ENVIRONMENT === 'production') {
    return jsonResponse({ message: 'Not found' }, 404, request, env);
  }

  // Authenticate — require a secret token that matches the ADMIN_SECRET env var.
  // Fall closed: if ADMIN_SECRET is not configured, reject all requests.
  const adminSecret = env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error(JSON.stringify({ event: 'admin_cancel_no_secret', environment: env.ENVIRONMENT }));
    return jsonResponse({ message: 'Admin endpoint not configured' }, 503, request, env);
  }

  const token = request.headers.get('X-Admin-Token') || request.headers.get('x-admin-token');
  if (!token) {
    return jsonResponse({ message: 'Missing X-Admin-Token header' }, 401, request, env);
  }

  // Constant-time comparison to prevent timing attacks.
  const tokenBytes = new TextEncoder().encode(token);
  const secretBytes = new TextEncoder().encode(adminSecret);
  let diff = tokenBytes.length ^ secretBytes.length;
  const maxLen = Math.max(tokenBytes.length, secretBytes.length);
  for (let i = 0; i < maxLen; i++) diff |= (tokenBytes[i] ?? 0) ^ (secretBytes[i] ?? 0);
  if (diff !== 0) {
    return jsonResponse({ message: 'Invalid admin token' }, 403, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: 'Request body tidak valid' }, 400, request, env);
  }

  const { session_id } = body;
  if (!session_id || typeof session_id !== 'string' || !/^sess_[0-9a-f-]{36}$/.test(session_id)) {
    return jsonResponse({ message: 'session_id tidak valid' }, 400, request, env);
  }

  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ message: 'Session tidak ditemukan' }, 404, request, env);
  }

  if (session.status !== SESSION_STATES.PENDING_PAYMENT) {
    return jsonResponse({
      message: `Session tidak dalam status pending_payment (status: ${session.status})`,
      status: session.status,
    }, 409, request, env);
  }

  const invoiceId = session.mayar_invoice_id;
  if (!invoiceId) {
    return jsonResponse({ message: 'Tidak ada invoice_id di session ini' }, 404, request, env);
  }

  const apiUrl = getMayarApiUrl(env);
  const apiKey = getMayarApiKey(env);

  // Try Mayar's void/cancel endpoint. API path varies across versions — try both.
  let mayarResult = null;
  let mayarError = null;
  for (const endpoint of [
    `${apiUrl}/invoice/${invoiceId}/void`,
    `${apiUrl}/invoice/${invoiceId}/cancel`,
    `${apiUrl}/payment/${invoiceId}/void`,
  ]) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) continue; // Try next endpoint
      const data = await res.json().catch(() => ({}));
      mayarResult = { endpoint, status: res.status, ok: res.ok, data };
      if (res.ok) break;
      mayarError = data?.message || data?.messages?.[0] || `Mayar error: ${res.status}`;
    } catch (e) {
      mayarError = e.message;
    }
  }

  // Clear invoice fields from the session regardless of Mayar API outcome.
  // Even if Mayar rejects the cancel (e.g. already cancelled), we want the
  // local session cleaned up so it doesn't generate more emails on resume.
  await updateSession(env, session_id, {
    invoice_url: null,
    invoice_created_at: null,
    mayar_invoice_id: null,
    admin_cancelled_at: Date.now(),
  });

  log('admin_invoice_cancelled', { session_id, invoiceId, mayarResult });

  if (mayarResult?.ok) {
    return jsonResponse({
      ok: true,
      message: `Invoice ${invoiceId} voided on Mayar. Session cleared.`,
      invoice_id: invoiceId,
      mayar: mayarResult,
    }, 200, request, env);
  }

  // Mayar cancel failed but local session is cleaned up — partial success.
  return jsonResponse({
    ok: false,
    message: `Session cleared locally but Mayar returned an error. Cancel invoice ${invoiceId} manually at web.mayar.club.`,
    invoice_id: invoiceId,
    mayar_error: mayarError,
    mayar: mayarResult,
  }, 207, request, env);
}
