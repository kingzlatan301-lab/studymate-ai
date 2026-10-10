/**
 * StudyMate AI — server-priced, risk-aware Premium checkout
 * ─────────────────────────────────────────────────────────────────────────
 *   GET  /api/checkout   → { quote }  what a checkout would cost THIS account right now
 *   POST /api/checkout   → { reference, accessCode, quote }  creates the transaction
 *
 * Both need "Authorization: Bearer <supabase access token>". The request body
 * is NEVER used to decide an amount, currency, region, email, user or IP
 * country. Those come from: the verified session, the server-side profile row,
 * the pricing table (api/_lib/pricing.js), the first-payment region lock, and
 * the edge-supplied IP-country header (x-vercel-ip-country — set by Vercel's
 * edge, a client cannot forge it through the platform).
 *
 * POST flow
 *   1. authenticate → user id + email (from Supabase, not the client)
 *   2. one round-trip of signals (get_pricing_signals): selected country,
 *      region lock, country-change history (written by a DB trigger),
 *      recent checkout attempts
 *   3. price = resolvePricing(lock, selected country); risk = assessPricingRisk
 *      (skipped for students who already paid: their region is locked)
 *   4. restricted (high risk inside a short cool-down) → 429, nothing created
 *   5. confirmation required (e.g. country ≠ detected region) → the client must
 *      send confirmRegion equal to the region being charged, else 409
 *   6. optional expectedAmountMinor/expectedCurrency = "the price I was shown";
 *      a difference → 409 PRICE_CHANGED. Never used to charge.
 *   7. create_payment_intent (atomic, per-user lock; reuses an identical open
 *      intent; hard attempt backstop in the database)
 *   8. Paystack /transaction/initialize with exactly the intent's terms
 *   9. browser completes payment with PaystackPop.resumeTransaction(accessCode)
 *  10. api/verify-payment.js / the webhook compare Paystack's result to the intent
 *
 * The IP country is stored on the intent for review and feeds the risk score.
 * It is never returned to the browser — only a boolean "mismatch".
 *
 * Needs env: PAYSTACK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */
const crypto = require('crypto');
const { getAuthedUser } = require('./_lib/plan');
const { resolvePricing } = require('./_lib/pricing');
const { assessPricingRisk } = require('./_lib/risk');
const { getPricingSignals, createPaymentIntent, setAccessCode, markIntent, paystackMode } = require('./_lib/payments');

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const hits = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const ts = (hits.get(key) || []).filter(t => t > windowStart);
  ts.push(now);
  hits.set(key, ts);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => t > windowStart)) hits.delete(k);
  return ts.length > RATE_LIMIT_MAX_REQUESTS;
}

// What the browser may learn. Deliberately omits the IP country and the score.
function quoteBody(pricing, risk, locked, selectedCountry) {
  return {
    region: pricing.region, currency: pricing.currency, amountMinor: pricing.amount, source: pricing.source,
    locked: !!locked,
    selectedCountry: selectedCountry || null,
    mismatch: !!(risk && risk.mismatch),
    confirmationRequired: !!(risk && risk.confirmationRequired),
    restricted: !!(risk && risk.restricted),
    retryAfterSec: risk ? risk.retryAfterSec : 0,
    // 'test' | 'live' | null — lets the app refuse to start a checkout if its public key (pk_test_/pk_live_) disagrees with this server's secret key mode.
    paystackMode: paystackMode(process.env.PAYSTACK_SECRET_KEY)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!paystackSecret || !serviceRoleKey) { res.status(503).json({ error: 'Payments are not configured on the server yet.' }); return; }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited(ip)) { res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' }); return; }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) { res.status(401).json({ error: 'You must be signed in to subscribe.', code: 'AUTH_REQUIRED' }); return; }
  const user = await getAuthedUser(accessToken);
  if (!user || !user.email) { res.status(401).json({ error: 'Your session has expired — please sign in again.', code: 'AUTH_REQUIRED' }); return; }

  let signals;
  try {
    signals = await getPricingSignals(user.id, serviceRoleKey);
  } catch (err) {
    console.error('checkout: pricing signals failed', err && err.message);
    res.status(502).json({ error: 'Could not determine your price right now — please try again.', retryable: true });
    return;
  }

  const locked = signals.lockedRegion;
  const pricing = resolvePricing(locked, signals.profileCountry);
  // A student who has already paid is region-locked: nothing left to game, so no risk gating.
  const rawIp = (req.headers['x-vercel-ip-country'] || '').toString();
  const risk = locked ? null : assessPricingRisk({
    profileCountry: signals.profileCountry, ipCountry: rawIp, pricing,
    countryChanges: signals.countryChanges, intents: signals.intents
  });
  const quote = quoteBody(pricing, risk, locked, signals.profileCountry);

  if (req.method === 'GET') { res.status(200).json({ quote }); return; }

  // ── POST ──
  const body = req.body || {};

  if (risk && risk.restricted) {
    res.status(429).json({
      error: 'To keep pricing fair, country changes and new checkouts are paused for a short time. You can continue after the wait below — or keep using your previously selected country.',
      code: 'PRICING_REVIEW', retryAfterSec: risk.retryAfterSec, quote
    });
    return;
  }

  let confirmed = false;
  if (risk && risk.confirmationRequired) {
    if (body.confirmRegion !== pricing.region) {
      res.status(409).json({
        error: "We noticed your selected country differs from your detected region. Please confirm that this is your country of residence before continuing.",
        code: 'CONFIRM_COUNTRY_REQUIRED', quote
      });
      return;
    }
    confirmed = true;
  }

  if (body.expectedAmountMinor !== undefined || body.expectedCurrency !== undefined) {
    if (body.expectedAmountMinor !== pricing.amount || String(body.expectedCurrency || '').toUpperCase() !== pricing.currency) {
      res.status(409).json({
        error: 'Your price has changed since it was shown. Please review the updated price and try again.',
        code: 'PRICE_CHANGED', quote
      });
      return;
    }
  }

  const reference = `sm_${user.id.slice(0, 8)}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const edgeIp = risk ? risk.ipCountry : null;   // normalised; stored for review, never returned

  try {
    // Intent FIRST (atomic, per-user serialised): a webhook for this reference
    // can never arrive before it exists, and concurrent checkouts cannot
    // create parallel open intents.
    const intent = await createPaymentIntent({
      userId: user.id, reference, region: pricing.region, currency: pricing.currency, amount: pricing.amount,
      profileCountry: signals.profileCountry, ipCountry: edgeIp,
      riskScore: risk ? risk.score : 0, riskFlags: risk ? risk.flags : [], confirmed
    }, serviceRoleKey);

    if (intent.blocked) {
      res.status(429).json({ error: 'Too many checkout attempts — please wait a while and try again.', code: 'TOO_MANY_ATTEMPTS' });
      return;
    }
    if (intent.reused && !intent.accessCode) {
      // The identical checkout is still being prepared by a simultaneous request.
      res.status(409).json({ error: 'Your checkout is being prepared — please wait a moment and try again.', code: 'CHECKOUT_IN_PROGRESS' });
      return;
    }
    if (intent.reused) {
      // Identical open checkout already exists (e.g. double-tap, second tab): hand it back.
      res.status(200).json({ reference: intent.reference, accessCode: intent.accessCode, quote, reused: true });
      return;
    }

    const init = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email, amount: pricing.amount, currency: pricing.currency, reference,
        metadata: { user_id: user.id, pricing_region: pricing.region } // cross-reference only; never trusted to grant
      })
    });
    const initData = await init.json().catch(() => null);
    if (!init.ok || !initData || !initData.status || !initData.data || !initData.data.access_code) {
      console.error('Paystack initialize failed', init.status);
      await markIntent(reference, 'failed', serviceRoleKey);
      res.status(502).json({ error: 'Could not start checkout right now — please try again in a moment.', retryable: true });
      return;
    }
    await setAccessCode(reference, initData.data.access_code, serviceRoleKey);
    res.status(200).json({ reference, accessCode: initData.data.access_code, quote });
  } catch (err) {
    console.error('checkout error', err && err.message);
    res.status(502).json({ error: 'Could not start checkout right now — please try again in a moment.', retryable: true });
  }
};
