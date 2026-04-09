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

  // Extract session ID from Mayar's redirect_url or metadata
  // Mayar sends the invoice data — find our session by invoice ID or redirect URL
  const invoiceId = payload.id || payload.invoice_id || payload.data?.id;
  const redirectUrl = payload.redirect_url || payload.data?.redirect_url || '';
  const status = payload.status || payload.data?.status;

  if (!invoiceId && !redirectUrl) {
    return new Response('OK', { status: 200 });
  }

  // Extract session_id from redirect URL
  let sessionId = null;
  if (redirectUrl) {
    try {
      const url = new URL(redirectUrl);
      sessionId = url.searchParams.get('session');
    } catch (e) {
      // ignore
    }
  }

  if (!sessionId) {
    // Cannot recover without a secondary index — log for operator visibility and return 200
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
