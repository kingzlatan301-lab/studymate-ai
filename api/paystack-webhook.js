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
 * IDENTITY (different from verify-payment.js): there is no student session
 * available here — Paystack calls this directly. So this looks up the
 * Supabase account by the EMAIL Paystack recorded for the transaction
 * (verified server-to-server as part of the real charge, not something the
 * frontend can edit at this point) via Supabase's admin API, rather than
 * trusting any client-supplied metadata. Residual risk: Paystack itself
 * doesn't verify that the email typed at checkout belongs to whoever typed
 * it, so in principle someone could pay while entering a different email
 * than their own account's — the worst case is crediting Premium to a
 * different real account than the payer, not any broader compromise, and
 * this is only the backup path (the primary path uses a real verified
 * session, not email matching, and will be what fires in the vast
 * majority of real payments).
 *
 * Requires env vars: PAYSTACK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */

const crypto = require('crypto');

const SUPABASE_URL = 'https://xlbnvmkcooueucuayrvy.supabase.co';
const MIN_VALID_AMOUNT_KOBO = 150000; // same floor as verify-payment.js
const SUBSCRIPTION_DAYS = 30;

module.exports.config = {
  api: { bodyParser: false } // required — see signature verification note above
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!paystackSecret || !serviceRoleKey) { res.status(503).end(); return; }

  const rawBody = await readRawBody(req);

  // Verify this request genuinely came from Paystack before trusting
  // anything in it.
  const expectedSignature = crypto.createHmac('sha512', paystackSecret).update(rawBody).digest('hex');
  const actualSignature = req.headers['x-paystack-signature'];
  if (!actualSignature || actualSignature !== expectedSignature) {
    console.error('Paystack webhook signature mismatch — rejecting');
    res.status(401).end();
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).end();
    return;
  }

  // Acknowledge immediately for any event we don't act on — Paystack
  // retries on non-2xx responses, and we don't want retries for events
  // that were never going to do anything anyway.
  if (event.event !== 'charge.success') {
    res.status(200).end();
    return;
  }

  try {
    const data = event.data;
    const amountKobo = data.amount;
    const email = data.customer && data.customer.email;
    const reference = data.reference;

    if (!email || typeof amountKobo !== 'number' || amountKobo < MIN_VALID_AMOUNT_KOBO) {
      console.error('Webhook charge.success failed validation', { reference, amountKobo, email });
      res.status(200).end(); // acknowledge so Paystack doesn't retry a payload that will never validate
      return;
    }

    // Look up the Supabase account by email — service_role can use the
    // admin API for this (this is the trusted-identity substitute for not
    // having a session token available in a server-to-server webhook).
    const lookupRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
    });
    if (!lookupRes.ok) {
      console.error('Webhook: admin user lookup failed', await lookupRes.text());
      res.status(200).end();
      return;
    }
    const lookupData = await lookupRes.json();
    const matchedUser = (lookupData.users || lookupData || []).find ? (lookupData.users || lookupData).find(u => u.email === email) : null;
    if (!matchedUser) {
      console.error('Webhook: no Supabase account matches paying email', email);
      res.status(200).end();
      return;
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        user_id: matchedUser.id,
        status: 'active',
        plan: 'premium_monthly',
        currency_charged: data.currency || 'NGN',
        amount_charged_kobo: amountKobo,
        paystack_reference: reference,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString()
      })
    });

    res.status(200).end();

  } catch (err) {
    console.error('paystack-webhook error', err && err.message);
    res.status(200).end(); // still acknowledge — we logged it for manual follow-up, retries won't help a code error
  }
};
