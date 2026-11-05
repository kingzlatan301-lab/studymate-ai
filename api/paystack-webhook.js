/**
 * StudyMate AI — Paystack webhook (backup payment confirmation)
 * ─────────────────────────────────────────────────────────────────────────
 * api/verify-payment.js (called by the paying student's own browser, using
 * their own verified session) is the PRIMARY path that grants Premium.
 * This webhook exists only as a backup: Paystack calls it server-to-server
 * whenever a charge succeeds, which covers the edge case where a student
 * pays but closes the browser/loses connection before the app can call
 * verify-payment itself.
 *
 * SET THIS UP IN PAYSTACK: dashboard → Settings → API Keys & Webhooks →
 * Webhook URL → https://<your-domain>/api/paystack-webhook
 *
 * SIGNATURE VERIFICATION: Paystack signs every webhook body with your
 * secret key (HMAC SHA512). This function verifies that signature against
 * the RAW request bytes before trusting anything in the payload — hence
 * bodyParser is disabled below and the body is read manually. Verifying
 * against a re-serialized JSON.stringify(req.body) instead would be
 * unreliable, since re-serialization isn't guaranteed to byte-for-byte
 * match what Paystack actually signed.
 *
 * IDENTITY: there is no student session here — Paystack calls this directly.
 * The account credited is the OWNER OF THE SERVER-CREATED PAYMENT INTENT for
 * the transaction's reference (api/checkout.js wrote it before the checkout
 * existed) — not an account guessed from the email typed at checkout, and not
 * client metadata. A signed event for a reference with no intent (not one of
 * ours, or a legacy pre-intent reference) is acknowledged and ignored.
 *
 * EXACT TERMS: the event's amount and currency must EQUAL the intent's; any
 * mismatch is logged and never grants Premium. Failed/pending/abandoned
 * payments never produce a charge.success event, and anything that is not
 * status 'success' is ignored here.
 *
 * IDEMPOTENCY: application goes through apply_verified_payment_v2() (ledger
 * keyed by reference), so Paystack's webhook retries, duplicate deliveries, and
 * the same payment also arriving via verify-payment.js can never create
 * duplicate subscriptions or extend Premium twice.
 *
 * RETRIES: a transient failure (database error) returns 500 so Paystack
 * retries — safe because application is idempotent. Payloads that can never
 * succeed (unknown reference, mismatched terms) get 200 so they are not
 * retried forever.
 *
 * Requires env vars: PAYSTACK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */

const crypto = require('crypto');

const { validateTransaction, checkAgainstIntent, getIntent, applyVerifiedPayment, modeMismatch } = require('./_lib/payments');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    // Collect raw BYTES (never decode chunk-by-chunk: a multi-byte character
    // split across chunks would change the bytes and break the HMAC).
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!paystackSecret || !serviceRoleKey) { res.status(503).end(); return; }

  const rawBody = await readRawBody(req);

  // Verify this request genuinely came from Paystack before trusting
  // anything in it.
  const expectedSignature = crypto.createHmac('sha512', paystackSecret).update(rawBody).digest('hex');
  const actualSignature = req.headers['x-paystack-signature'];
  const sigOk = typeof actualSignature === 'string' &&
    actualSignature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(actualSignature), Buffer.from(expectedSignature));
  if (!sigOk) {
    console.error('Paystack webhook signature mismatch — rejecting');
    res.status(401).end();
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).end();
    return;
  }

  // Acknowledge immediately for any event we don't act on — Paystack
  // retries on non-2xx responses, and we don't want retries for events
  // that were never going to do anything anyway.
  if (!event || event.event !== 'charge.success') {
    res.status(200).end();
    return;
  }

  try {
    const data = event.data;
    const invalid = validateTransaction(data) || modeMismatch(data, paystackSecret);
    if (invalid) {
      console.error('Webhook charge.success failed validation', { reference: data && data.reference, reason: invalid });
      res.status(200).end(); // can never validate — don't retry
      return;
    }

    const intent = await getIntent(data.reference, serviceRoleKey);
    if (!intent) {
      console.error('Webhook: no payment intent for reference — ignoring', { reference: data.reference });
      res.status(200).end();
      return;
    }
    const mismatch = checkAgainstIntent(data, intent, intent.user_id);
    if (mismatch) {
      console.error('Webhook: transaction does not match its intent — NOT granting', { reference: data.reference, reason: mismatch });
      res.status(200).end();
      return;
    }

    const applied = await applyVerifiedPayment({ userId: intent.user_id, tx: data, serviceRoleKey });
    if (applied.result !== 'applied' && applied.result !== 'already_applied') {
      console.error('Webhook: apply refused', { reference: data.reference, result: applied.result });
    }
    res.status(200).end();

  } catch (err) {
    console.error('paystack-webhook error', err && err.message);
    res.status(500).end(); // apply is idempotent, so a Paystack retry is safe and is how a transient failure self-heals
  }
}

module.exports = handler;
// IMPORTANT: assigned AFTER `module.exports = handler`. Previously the config
// was set first and then clobbered by the later `module.exports = ...`, so
// bodyParser was never actually disabled, the raw body could not be read,
// and every real Paystack webhook failed signature verification.
module.exports.config = {
  api: { bodyParser: false } // required — see signature verification note above
};
