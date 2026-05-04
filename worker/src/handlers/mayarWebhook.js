import { log, logError } from '../utils.js';
import { verifyMayarWebhook } from '../mayar.js';
import { getSession, updateSession } from '../sessions.js';
import { sendPaymentConfirmationEmail } from '../email.js';

export async function handleMayarWebhook(request, env, ctx) {
  const { valid, body } = await verifyMayarWebhook(request, env);

  if (!valid) {
    console.error(JSON.stringify({
      event: 'webhook_unauthorized',
      environment: env.ENVIRONMENT ?? 'sandbox',
      has_signature: !!request.headers.get('x-mayar-signature'),
      has_secret: !!env.MAYAR_WEBHOOK_SECRET,
    }));
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
  //   KV secondary index `mayar_session_{invoiceId}` (set by /create-payment)
  const invoiceId = payload.id || payload.invoice_id || payload.data?.id;
  const redirectUrl = payload.redirect_url || payload.data?.redirect_url || '';
  const status = payload.status || payload.data?.status;

  console.log(JSON.stringify({
    event: 'webhook_payload',
    invoiceId,
    status,
    topLevelKeys: Object.keys(payload),
    dataKeys: payload.data ? Object.keys(payload.data) : null,
  }));

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

  if (!sessionId) {
    // Cannot recover — log for operator visibility and return 200 so Mayar stops retrying
    console.error(JSON.stringify({ event: 'webhook_no_session', invoiceId, status, redirectUrl }));
    return new Response('OK', { status: 200 });
  }

  // Check if payment is successful — covers all known Mayar status variants across API versions and sandbox
  const isPaid = ['paid', 'settlement', 'capture', 'PAID', 'SETTLEMENT', 'CAPTURE', 'success', 'SUCCESS'].includes(status);

  if (isPaid) {
    // Idempotency sentinel: a dedicated KV key that persists longer than any Mayar retry
    // window (48 h). Checked before the session read so concurrent deliveries from different
    // Cloudflare edge nodes — which may see stale KV data due to eventual consistency —
    // are caught even when the session status write hasn't propagated yet.
    const processedKey = `payment_processed_${sessionId}`;
    const alreadyProcessed = await env.GASLAMAR_SESSIONS.get(processedKey);
    if (alreadyProcessed) {
      log('webhook_duplicate_skipped', { sessionId, invoiceId });
      return new Response('OK', { status: 200 });
    }

    // Belt-and-suspenders: also check session status (catches retries after KV propagates)
    const existing = await getSession(env, sessionId);
    if (existing && existing.status !== 'pending') {
      return new Response('OK', { status: 200 });
    }

    // Write the sentinel BEFORE updating session and sending the email.
    // This minimises the race window to KV-write latency (~ms) instead of the full
    // read→check→write→send sequence.
    await env.GASLAMAR_SESSIONS.put(processedKey, '1', { expirationTtl: 172800 }); // 48 h

    const updated = await updateSession(env, sessionId, { status: 'paid', paid_at: Date.now() });
    if (!updated) {
      console.error(JSON.stringify({ event: 'webhook_session_update_failed', sessionId, invoiceId, environment: env.ENVIRONMENT ?? 'sandbox' }));
      return new Response('OK', { status: 200 });
    }
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
