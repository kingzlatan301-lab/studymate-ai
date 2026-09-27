/**
 * StudyMate AI — verify a Paystack payment and grant Premium
 * ─────────────────────────────────────────────────────────────────────────
 * Frontend completes Paystack's checkout popup, gets back a `reference`,
 * then calls THIS endpoint with that reference. This function independently
 * re-checks with Paystack's own API whether that reference really
 * represents a successful payment — the frontend's word alone is never
 * trusted, since anyone could call this endpoint directly with a made-up
 * reference otherwise.
 *
 * IDENTITY: who gets Premium is determined by the caller's own verified
 * Supabase access token (sent as "Authorization: Bearer <token>"), NOT by
 * any user_id the client might have attached to the Paystack transaction's
 * metadata. That metadata is set in client-side JS before the transaction
 * ever reaches Paystack, so it's fully attacker-editable — trusting it for
 * *authorization* would let someone pay a small amount and then claim the
 * payment belongs to an arbitrary other account. Metadata is fine for
 * logging/cross-reference, never for "who do we grant access to."
 *
 * AMOUNT: the actual amount Paystack confirms was charged is checked
 * against a server-side minimum (MIN_VALID_AMOUNT_KOBO) — never trust a
 * client-supplied "I paid the full price" claim, since the amount passed
 * into Paystack's checkout popup is also just client-side JS and could be
 * edited to something trivial before it reaches Paystack.
 *
 * Requires env vars: PAYSTACK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security entirely — it is
 * used ONLY here and in api/paystack-webhook.js, and only to write a
 * subscription row after independently verifying a real payment. It must
 * never reach the frontend or be used for anything else.
 *
 * Rate-limited per IP (same in-memory pattern as api/ask.js) — a real
 * student verifies once per purchase or retry, not repeatedly; this just
 * bounds how many times a script can hammer Paystack's verify API through
 * this endpoint.
 */

const SUPABASE_URL = 'https://xlbnvmkcooueucuayrvy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QHKfnwzCQUW23sNWL2YUPg_H2-oxJ3g'; // public, safe — used only to validate the caller's own token

// The lowest of all regional prices right now (India, ₦1,500) — any
// genuinely successful checkout should be at least this much. A real
// per-country amount check would need trusted server-side pricing lookup;
// this floor is a simple, robust guard against the "charge myself ₦1"
// tampering case without needing to trust client-supplied country info.
const MIN_VALID_AMOUNT_KOBO = 150000;

const SUBSCRIPTION_DAYS = 30;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10; // a real student verifies once per purchase/retry, not repeatedly

const hits = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (hits.get(key) || []).filter(t => t > windowStart);
  timestamps.push(now);
  hits.set(key, timestamps);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some(t => t > windowStart)) hits.delete(k);
    }
  }
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
    return;
  }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!paystackSecret || !serviceRoleKey) {
    res.status(503).json({ error: 'Payments are not configured on the server yet.' });
    return;
  }

  const reference = req.body && req.body.reference;
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!reference || typeof reference !== 'string') {
    res.status(400).json({ error: 'Missing payment reference.' });
    return;
  }
  if (!accessToken) {
    res.status(401).json({ error: 'You must be signed in to verify a payment.' });
    return;
  }

  try {
    // 1. Confirm who is actually calling — independently, via Supabase,
    // not via anything the client claims.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Your session has expired — please sign in again.' });
      return;
    }
    const user = await userRes.json();
    const userId = user.id;

    // 2. Confirm the payment really succeeded — independently, via
    // Paystack, not via anything the client claims.
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` }
    });
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.status || !verifyData.data || verifyData.data.status !== 'success') {
      res.status(402).json({ error: 'Payment was not successful.' });
      return;
    }

    const amountKobo = verifyData.data.amount;
    if (typeof amountKobo !== 'number' || amountKobo < MIN_VALID_AMOUNT_KOBO) {
      // Don't reveal the exact floor to the client — just decline.
      console.error('Payment amount below minimum valid threshold', { reference, amountKobo });
      res.status(402).json({ error: 'Payment amount could not be verified.' });
      return;
    }

    // 2b. Reject reference reuse across DIFFERENT accounts. Without this,
    // one real successful payment's reference could be resubmitted by any
    // number of other accounts and each would independently pass the two
    // checks above (Paystack genuinely did confirm that reference once,
    // and the amount genuinely was sufficient) — the checks above verify
    // "was this a real payment", not "is this YOUR real payment", so this
    // is the check that actually ties the two together.
    //
    // Uses the service_role key deliberately — this has to see whether
    // ANY account (not just the caller's own row) already holds this
    // reference, which is exactly the kind of cross-account read RLS is
    // supposed to prevent for normal requests.
    //
    // This check + the upsert below are not atomic with each other, so a
    // genuine backstop against a race (two accounts submitting the same
    // reference within milliseconds of each other) needs a UNIQUE
    // constraint on subscriptions.paystack_reference at the database
    // level too — see supabase-schema-06-payment-reference-unique.sql.
    // This application-level check is what turns that into a clean,
    // friendly rejection instead of a raw DB constraint-violation error;
    // the constraint is what makes it actually safe under concurrency.
    const dupCheckRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?paystack_reference=eq.${encodeURIComponent(reference)}&select=user_id&limit=1`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    if (!dupCheckRes.ok) {
      console.error('Duplicate-reference check failed', await dupCheckRes.text().catch(() => ''));
      res.status(502).json({ error: 'Could not verify this payment right now — please try again.' });
      return;
    }
    const existingRows = await dupCheckRes.json();
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    if (existing && existing.user_id !== userId) {
      console.error('Payment reference reuse attempt', { reference, attemptedBy: userId, alreadyGrantedTo: existing.user_id });
      res.status(409).json({ error: 'This payment reference has already been used on a different account.' });
      return;
    }

    // 3. Everything checks out — grant Premium via the service_role key
    // (bypasses RLS, which is exactly why this only happens here, after
    // both independent checks above have passed).
    const now = new Date();
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        user_id: userId,
        status: 'active',
        plan: 'premium_monthly',
        currency_charged: verifyData.data.currency || 'NGN',
        amount_charged_kobo: amountKobo,
        paystack_reference: reference,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString()
      })
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('Subscription upsert failed', errText);
      res.status(500).json({ error: 'Payment succeeded but activating Premium failed — contact support with your payment reference.' });
      return;
    }

    res.status(200).json({ ok: true, currentPeriodEnd: periodEnd.toISOString() });

  } catch (err) {
    console.error('verify-payment error', err && err.message);
    res.status(502).json({ error: 'Could not verify payment right now — please try again.' });
  }
};
