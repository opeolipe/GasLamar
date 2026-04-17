import { log, logError } from '../utils.js';
import { verifyMayarWebhook } from '../mayar.js';
import { getSession, updateSession } from '../sessions.js';
import { sendPaymentConfirmationEmail } from '../email.js';

export async function handleMayarWebhook(request, env, ctx) {
  const { valid, body } = await verifyMayarWebhook(request, env);

  if (!valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return new Response('Bad Request', { status: 400 });
  }

  // Extract session ID from Mayar's invoice data.
  // Mayar sends the invoice data — find our session by:
  //   1. KV secondary index `mayar_session_{invoiceId}` (new path — no session in URL)
  //   2. ?session= in redirect_url (backward compat for invoices created before this change)
  const invoiceId = payload.id || payload.invoice_id || payload.data?.id;
  const redirectUrl = payload.redirect_url || payload.data?.redirect_url || '';
  const status = payload.status || payload.data?.status;

  if (!invoiceId && !redirectUrl) {
    return new Response('OK', { status: 200 });
  }

  // Primary: KV secondary index (set by /create-payment)
  let sessionId = null;
  if (invoiceId) {
    const mapping = await env.GASLAMAR_SESSIONS.get(`mayar_session_${invoiceId}`, { type: 'json' });
    const sid = mapping?.session_id;
    // Validate that the KV-stored session_id has the expected format before using it.
    // This is defence-in-depth: the KV entry is written by /create-payment which already
    // generates a valid sess_ UUID, but we guard against any future KV corruption.
    if (typeof sid === 'string' && sid.startsWith('sess_')) {
      sessionId = sid;
    } else if (sid !== undefined) {
      console.error(JSON.stringify({ event: 'webhook_invalid_session_id_format', invoiceId, sid: String(sid).slice(0, 20) }));
    }
  }

  // Fallback: extract ?session= from redirect URL (invoices created before cookie migration)
  if (!sessionId && redirectUrl) {
    try {
      const url = new URL(redirectUrl);
      const legacy = url.searchParams.get('session');
      if (legacy && legacy.startsWith('sess_')) sessionId = legacy;
    } catch (e) {
      // ignore
    }
  }

  if (!sessionId) {
    // Cannot recover — log for operator visibility and return 200 so Mayar stops retrying
    console.error(JSON.stringify({ event: 'webhook_no_session', invoiceId, status, redirectUrl }));
    return new Response('OK', { status: 200 });
  }

  // Check if payment is successful
  const isPaid = ['paid', 'settlement', 'capture', 'PAID', 'SETTLEMENT'].includes(status);

  if (isPaid) {
    // Idempotency: skip if already processed (prevents duplicate emails on duplicate webhooks)
    const existing = await getSession(env, sessionId);
    if (existing && existing.status !== 'pending') {
      return new Response('OK', { status: 200 });
    }
    await updateSession(env, sessionId, { status: 'paid', paid_at: Date.now() });
    log('payment_confirmed', { sessionId, invoiceId });
    // Email: use ctx.waitUntil so CF Worker doesn't kill the Resend fetch before it completes
    ctx.waitUntil(
      sendPaymentConfirmationEmail(sessionId, env).catch((e) => {
        logError('email_failed', { sessionId, error: e.message });
      })
    );
  }

  return new Response('OK', { status: 200 });
}
