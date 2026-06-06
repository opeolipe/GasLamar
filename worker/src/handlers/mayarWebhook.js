import { log, logError } from '../utils.js';
import { verifyMayarWebhook } from '../mayar.js';
import { getSession, updateSession } from '../sessions.js';
import { sendPaymentConfirmationEmail } from '../email.js';
import { SESSION_STATES, PENDING_LEGACY } from '../sessionStates.js';

const WEBHOOK_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cache-Control': 'no-store',
};

function webhookResponse(body, status) {
  return new Response(body, { status, headers: WEBHOOK_SECURITY_HEADERS });
}

export async function handleMayarWebhook(request, env, ctx) {
  const { valid, body } = await verifyMayarWebhook(request, env);

  console.log(JSON.stringify({
    event: 'webhook_verification',
    valid,
    environment: env.ENVIRONMENT ?? 'sandbox',
    has_signature: !!request.headers.get('x-mayar-signature'),
    has_callback_token: !!request.headers.get('x-callback-token'),
    has_secret: !!env.MAYAR_WEBHOOK_SECRET,
    body_preview: typeof body === 'string' ? body.slice(0, 500) : null,
  }));

  if (!valid) {
    return webhookResponse('Unauthorized', 401);
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return webhookResponse('Bad Request', 400);
  }

  // Extract session ID from Mayar's invoice data.
  // Mayar sends the invoice data — find our session by:
  //   KV secondary index `mayar_session_{invoiceId}` (set by /create-payment)
  //
  // Mayar's webhook structure varies across API versions and event types:
  //   Flat:   { id: <invoiceId>, status: '...', ... }
  //   Nested: { event: '...', data: { id: <txnId>, productId: <invoiceId>, ... } }
  //
  // CRITICAL: in Mayar sandbox (and production), the webhook `data.id` is the
  // TRANSACTION ID created at payment time — NOT the payment-link ID stored
  // during /invoice/create.  The payment-link ID appears in `data.productId`.
  // We must try both so the KV secondary index (keyed by payment-link ID) is found.
  const candidateInvoiceIds = [
    payload.id,
    payload.order_id,           // explicit order_id field used by some Mayar API versions
    payload.invoice_id,
    payload.reference,          // echoed back from our reference field set at invoice creation
    payload.data?.id,
    payload.data?.productId,    // payment-link ID — matches the index set by /create-payment
    payload.data?.invoice_id,   // alternate field name used in some API versions
    payload.data?.transactionId, // belt-and-suspenders for reverse mapping
    payload.data?.order_id,
    payload.data?.reference,    // echoed back from our `reference: sessionId` at invoice creation
    payload.data?.externalId,
    payload.data?.extraData?.noCustomer, // our documented invoice extraData session reference
  ].filter((id, i, arr) => id && typeof id === 'string' && id.length <= 200 && arr.indexOf(id) === i); // dedupe + KV key length guard

  const redirectUrl = payload.redirect_url || payload.data?.redirect_url || '';
  const status = payload.status || payload.data?.status;

  console.log(JSON.stringify({
    event: 'webhook_payload',
    candidateInvoiceIds,
    status,
    topLevelKeys: Object.keys(payload),
    dataKeys: payload.data ? Object.keys(payload.data) : null,
  }));

  if (!candidateInvoiceIds.length) {
    console.error(JSON.stringify({
      event: 'webhook_missing_order_id',
      reason: 'no_identifiable_invoice_or_order_id',
      topLevelKeys: Object.keys(payload),
      dataKeys: payload.data ? Object.keys(payload.data) : null,
    }));
    return webhookResponse('Bad Request: missing order_id', 400);
  }

  // Primary: KV secondary index (set by /create-payment).
  // Try each candidate ID in order; the first one that resolves to a valid session wins.
  // This handles Mayar placing the webhook-event ID at payload.id while the actual
  // invoice ID is at payload.data.id.
  let sessionId = null;
  let invoiceId = candidateInvoiceIds[0] ?? null; // best candidate for logging
  const SESSION_ID_RE = /^sess_[0-9a-f-]{36}$/i;

  // Step 1: Check if any candidate IS a session ID (echoed back via our `reference` field).
  for (const candidateId of candidateInvoiceIds) {
    if (SESSION_ID_RE.test(candidateId)) {
      sessionId = candidateId.toLowerCase();
      invoiceId = candidateId;
      console.log(JSON.stringify({ event: 'webhook_session_id_from_reference', sessionId, candidateId }));
      break;
    }
  }

  // Step 2: Primary lookup — KV secondary index set by /create-payment.
  if (!sessionId) {
    for (const candidateId of candidateInvoiceIds) {
      const mapping = await env.GASLAMAR_SESSIONS.get(`mayar_session_${candidateId}`, { type: 'json' });
      const sid = mapping?.session_id;
      // Validate that the KV-stored session_id has the expected format before using it.
      // Full format: "sess_" + 36-char lowercase UUID (e.g. sess_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
      if (typeof sid === 'string' && SESSION_ID_RE.test(sid)) {
        sessionId = sid;
        invoiceId = candidateId; // use the ID that found the session for downstream logging
        break;
      }
      if (sid !== undefined) {
        console.error(JSON.stringify({ event: 'webhook_invalid_session_id_format', candidateId, sid: String(sid).slice(0, 20) }));
      }
    }
  }

  // Step 3: Fallback — result_id index set by /create-payment alongside the invoice index.
  // Activated when Mayar sends a transaction ID we didn't store under mayar_session_.
  if (!sessionId) {
    for (const candidateId of candidateInvoiceIds) {
      const mapping = await env.GASLAMAR_SESSIONS.get(`result_id_session_${candidateId}`, { type: 'json' });
      const sid = mapping?.session_id;
      if (typeof sid === 'string' && SESSION_ID_RE.test(sid)) {
        sessionId = sid;
        invoiceId = candidateId;
        console.log(JSON.stringify({ event: 'webhook_session_found_via_result_id_index', sessionId, candidateId }));
        break;
      }
    }
  }

  if (!sessionId) {
    // Cannot recover — log all tried IDs so the operator can compare against the KV index
    // stored by /create-payment (logged as mayar_session_index_stored at payment creation).
    console.error(JSON.stringify({ event: 'webhook_no_session', triedIds: candidateInvoiceIds, status, redirectUrl }));
    return webhookResponse('OK', 200);
  }

  // Check if payment is successful — case-insensitive to handle all Mayar status variants
  // across API versions, sandbox, and any future mixed-case additions.
  const isPaid = typeof status === 'string' &&
    ['paid', 'settlement', 'capture', 'success', 'completed', 'confirmed'].includes(status.toLowerCase());

  if (!isPaid) {
    console.log(JSON.stringify({ event: 'webhook_status_not_paid', sessionId, invoiceId, status }));
  }

  if (isPaid) {
    // Idempotency sentinel: a dedicated KV key that persists longer than any Mayar retry
    // window (48 h). Checked before the session read so concurrent deliveries from different
    // Cloudflare edge nodes — which may see stale KV data due to eventual consistency —
    // are caught even when the session status write hasn't propagated yet.
    const processedKey = `payment_processed_${sessionId}`;
    const alreadyProcessed = await env.GASLAMAR_SESSIONS.get(processedKey);
    if (alreadyProcessed) {
      log('webhook_duplicate_skipped', { sessionId, invoiceId });
      return webhookResponse('OK', 200);
    }

    // Belt-and-suspenders: also check session status (catches retries after KV propagates).
    // Accept both 'pending_payment' (new) and 'pending' (legacy sessions created before rename).
    const existing = await getSession(env, sessionId);
    const isPendingPayment = existing &&
      (existing.status === SESSION_STATES.PENDING_PAYMENT || existing.status === PENDING_LEGACY);
    if (existing && !isPendingPayment) {
      return webhookResponse('OK', 200);
    }

    // Write the sentinel BEFORE updating session and sending the email.
    // This minimises the race window to KV-write latency (~ms) instead of the full
    // read→check→write→send sequence.
    await env.GASLAMAR_SESSIONS.put(processedKey, '1', { expirationTtl: 172800 }); // 48 h

    let updated = false;
    try {
      updated = await updateSession(env, sessionId, { status: SESSION_STATES.PAID, paid_at: Date.now() });
    } catch (e) {
      // Transient KV error — remove the sentinel so Mayar's next retry can succeed.
      await env.GASLAMAR_SESSIONS.delete(processedKey).catch(() => {});
      logError('webhook_update_threw', { sessionId, invoiceId, error: e.message });
      return webhookResponse('Internal Error', 500);
    }
    if (!updated) {
      // Session is permanently gone (expired/deleted before payment confirmed).
      // Keep the sentinel to stop infinite Mayar retries; log for operator.
      console.error(JSON.stringify({ event: 'webhook_session_update_failed', sessionId, invoiceId, environment: env.ENVIRONMENT ?? 'sandbox' }));
      return webhookResponse('OK', 200);
    }
    log('payment_confirmed', { sessionId, invoiceId });
    // Email: use ctx.waitUntil so CF Worker doesn't kill the Resend fetch before it completes
    ctx.waitUntil(
      sendPaymentConfirmationEmail(sessionId, env).catch((e) => {
        logError('email_failed', { sessionId, error: e.message });
      })
    );
  }

  return webhookResponse('OK', 200);
}
