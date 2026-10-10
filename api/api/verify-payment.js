/**
 * StudyMate AI — verify a Paystack payment and grant Premium
 * ─────────────────────────────────────────────────────────────────────────
 * After Paystack's popup reports success, the browser calls THIS endpoint with
 * the reference. Nothing the browser says is trusted:
 *
 *   1. WHO   — the caller's verified Supabase session (never metadata/email).
 *   2. WHAT  — the server-created payment intent for the reference (amount,
 *              currency, region, owner), written by api/checkout.js.
 *   3. PAID? — Paystack's own /transaction/verify API.
 *   4. EXACT — verified amount and currency must EQUAL the intent's. There is
 *              no "at least X" floor: a cheaper regional payment cannot pass.
 *   5. ONCE  — apply_verified_payment_v2() (idempotent ledger keyed by
 *              reference) grants/extends Premium and re-checks 2+4 in the DB.
 *
 * Response contract (the app only says "Premium activated" for status 'success'):
 *   200 { ok:true,  status:'success', alreadyApplied, testMode, currentPeriodEnd }
 *   202 { ok:false, status:'pending', pending:true, error }   keep checking, no Premium
 *   402 { ok:false, status:'failed'|'abandoned'|'rejected', error }  definitive no
 *   409 { ok:false, status:'rejected' }                        belongs to another account
 *   5xx { retryable:true }                                     our side hiccuped; payment may be fine
 *
 * Requires env: PAYSTACK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY (used only
 * here, in checkout, and in the webhook; never reaches the browser).
 */
const { getAuthedUser } = require('./_lib/plan');
const { validateTransaction, checkAgainstIntent, getIntent, markIntent, applyVerifiedPayment, modeMismatch } = require('./_lib/payments');

const MSG_PENDING = 'Payment is still being confirmed. Your Premium access will activate automatically once Paystack confirms it.';
const MSG_FAILED = "Payment wasn't completed. No Premium access was activated.";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const hits = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (hits.get(key) || []).filter(t => t > windowStart);
  timestamps.push(now);
  hits.set(key, timestamps);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => t > windowStart)) hits.delete(k);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited(ip)) { res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' }); return; }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!paystackSecret || !serviceRoleKey) { res.status(503).json({ error: 'Payments are not configured on the server yet.' }); return; }

  const reference = req.body && req.body.reference;
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!reference || typeof reference !== 'string' || reference.length > 100) { res.status(400).json({ error: 'Missing payment reference.' }); return; }
  if (!accessToken) { res.status(401).json({ error: 'You must be signed in to verify a payment.' }); return; }

  try {
    // 1. WHO
    const user = await getAuthedUser(accessToken);
    if (!user) { res.status(401).json({ error: 'Your session has expired — please sign in again.' }); return; }
    const userId = user.id;

    // 2. WHAT — the server-created intent. Unknown reference, or someone
    // else's, never reaches Paystack and never grants anything.
    const intent = await getIntent(reference, serviceRoleKey);
    if (!intent) {
      console.error('verify: no intent for reference', { reference, attemptedBy: userId });
      res.status(402).json({ ok: false, status: 'rejected', error: 'We could not find a StudyMate checkout for that payment reference.' });
      return;
    }
    if (intent.user_id !== userId) {
      console.error('verify: reference belongs to another account', { reference, attemptedBy: userId });
      res.status(409).json({ ok: false, status: 'rejected', error: 'This payment was made for a different account.' });
      return;
    }

    // 3. PAID?
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` }
    });
    let verifyData = null;
    try { verifyData = await verifyRes.json(); } catch { /* handled below */ }
    if (!verifyRes.ok || !verifyData || !verifyData.status || !verifyData.data) {
      console.error('Paystack verify call failed', { reference, status: verifyRes.status });
      if (verifyRes.status >= 500 || verifyRes.status === 429) {
        res.status(502).json({ ok: false, error: 'Could not reach the payment provider to confirm this payment — please try again in a moment.', retryable: true });
      } else {
        // Paystack does not know the reference: the checkout was never completed.
        res.status(402).json({ ok: false, status: 'failed', error: MSG_FAILED });
      }
      return;
    }
    const tx = verifyData.data;

    if (tx.reference !== reference) {
      console.error('Paystack reference mismatch', { asked: reference, got: tx.reference });
      res.status(402).json({ ok: false, status: 'rejected', error: 'Payment could not be verified.' });
      return;
    }

    // Distinct, truthful outcomes. ONLY 'success' continues to the grant.
    if (tx.status !== 'success') {
      if (['pending', 'ongoing', 'processing', 'queued'].includes(tx.status)) {
        res.status(202).json({ ok: false, status: 'pending', pending: true, error: MSG_PENDING });
      } else if (tx.status === 'abandoned') {
        await markIntent(reference, 'abandoned', serviceRoleKey);
        res.status(402).json({ ok: false, status: 'abandoned', error: MSG_FAILED });
      } else { // failed, reversed, cancelled, anything else
        await markIntent(reference, 'failed', serviceRoleKey);
        res.status(402).json({ ok: false, status: 'failed', error: MSG_FAILED });
      }
      return;
    }

    // 4. EXACT terms
    const invalid = validateTransaction(tx);
    const mismatch = invalid || modeMismatch(tx, paystackSecret) || checkAgainstIntent(tx, intent, userId);
    if (mismatch) {
      // Reasons stay in the server log; the client is never told thresholds.
      console.error('Payment rejected', { reference, reason: mismatch, amount: tx.amount, currency: tx.currency, expectedAmount: intent.amount_minor, expectedCurrency: intent.currency });
      res.status(402).json({ ok: false, status: 'rejected', error: 'Payment could not be verified, so Premium was not activated. If you were charged, contact support with reference ' + reference + '.' });
      return;
    }

    // 5. ONCE
    let applied;
    try {
      applied = await applyVerifiedPayment({ userId, tx, serviceRoleKey });
    } catch (err) {
      console.error('applyVerifiedPayment failed', err && err.message);
      res.status(500).json({
        ok: false,
        error: 'Your payment went through, but we could not activate Premium just yet. Please reopen the app in a minute — it will retry automatically. Your payment reference: ' + reference,
        retryable: true
      });
      return;
    }
    if (applied.result === 'other_user') {
      res.status(409).json({ ok: false, status: 'rejected', error: 'This payment reference has already been used on a different account.' });
      return;
    }
    if (applied.result !== 'applied' && applied.result !== 'already_applied') {
      console.error('apply refused', { reference, result: applied.result });
      res.status(402).json({ ok: false, status: 'rejected', error: 'Payment could not be verified, so Premium was not activated.' });
      return;
    }

    res.status(200).json({
      ok: true, status: 'success',
      alreadyApplied: applied.result === 'already_applied',
      testMode: !applied.livemode,
      currentPeriodEnd: applied.currentPeriodEnd
    });
  } catch (err) {
    console.error('verify-payment error', err && err.message);
    res.status(502).json({ ok: false, error: 'Could not verify payment right now — please try again.', retryable: true });
  }
};
