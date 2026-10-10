/**
 * StudyMate AI — shared, server-only payment logic
 * ─────────────────────────────────────────────────────────────────────────
 * Used by api/checkout.js (create intent), api/verify-payment.js (primary
 * confirmation) and api/paystack-webhook.js (backup confirmation), so every
 * path applies a payment the same exact, idempotent way.
 *
 * EXACT-TERMS VERIFICATION. A Paystack transaction grants Premium only if ALL
 * of these hold:
 *   • Paystack says status === 'success' for the reference,
 *   • a payment intent exists for the reference (the server created it),
 *   • the intent belongs to the authenticated user (verify) / is the account
 *     the webhook credits (webhook: identity comes FROM the intent, never
 *     from an email typed into a checkout form),
 *   • tx.amount === intent.amount_minor  (exact — no "at least" floor),
 *   • tx.currency === intent.currency    (exact).
 * The apply_verified_payment_v2() database function re-checks user, amount and
 * currency inside the same transaction that grants Premium, so even a bug here
 * could not grant Premium for the wrong terms.
 *
 * IDEMPOTENCY. The `payments` ledger's primary key is the Paystack reference:
 * the same reference applied twice (verify + webhook + retries + refreshes)
 * extends Premium once. Needs SUPABASE_SERVICE_ROLE_KEY — never ship this
 * module to the browser.
 */

const SUPABASE_URL = 'https://xlbnvmkcooueucuayrvy.supabase.co';
const { SUBSCRIPTION_DAYS } = require('./pricing');

function svcHeaders(serviceRoleKey, extra) {
  return Object.assign({ apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' }, extra || {});
}

/** Basic shape/status check of a Paystack transaction object. Null = ok, else a machine reason. */
function validateTransaction(tx) {
  if (!tx || tx.status !== 'success') return 'not_success';
  if (!tx.reference || typeof tx.reference !== 'string') return 'no_reference';
  if (!Number.isInteger(tx.amount) || tx.amount <= 0) return 'bad_amount';
  if (typeof tx.currency !== 'string' || !tx.currency) return 'bad_currency';
  return null;
}

/**
 * Which Paystack mode the SERVER's secret key is in: 'live' (sk_live_…), 'test' (sk_test_…) or null
 * (unrecognised). Used to stop test and live keys being mixed: the UI compares this with its public key
 * (pk_test_/pk_live_) and refuses to start a checkout on a mismatch, and a verified transaction whose own
 * `domain` disagrees with the key mode is never applied.
 */
function paystackMode(secretKey) {
  const k = String(secretKey || '');
  if (k.startsWith('sk_live_')) return 'live';
  if (k.startsWith('sk_test_')) return 'test';
  return null;
}
/** Returns 'mode_mismatch' when a transaction's domain contradicts the server key mode, else null. */
function modeMismatch(tx, secretKey) {
  const mode = paystackMode(secretKey);
  if (mode && tx && typeof tx.domain === 'string' && tx.domain && tx.domain !== mode) return 'mode_mismatch';
  return null;
}

/** Reads the server-created intent for a reference (service role). Returns row or null; throws on infra failure. */
async function getIntent(reference, serviceRoleKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/payment_intents?reference=eq.${encodeURIComponent(reference)}&select=reference,user_id,pricing_region,currency,amount_minor,status&limit=1`,
    { headers: svcHeaders(serviceRoleKey) }
  );
  if (!res.ok) throw new Error(`getIntent failed: ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Compares a verified Paystack transaction with the stored intent.
 * Returns null when everything matches exactly, else a reason string:
 * 'no_intent' | 'other_user' | 'amount_mismatch' | 'currency_mismatch'.
 * `userId` is the account being credited (verify: the caller; webhook: intent owner).
 */
function checkAgainstIntent(tx, intent, userId) {
  if (!intent) return 'no_intent';
  if (!userId || intent.user_id !== userId) return 'other_user';
  if (tx.amount !== intent.amount_minor) return 'amount_mismatch';
  if (String(tx.currency).toUpperCase() !== String(intent.currency).toUpperCase()) return 'currency_mismatch';
  return null;
}

/** Best-effort status note on the intent (audit only; never gates anything). */
async function markIntent(reference, status, serviceRoleKey) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/payment_intents?reference=eq.${encodeURIComponent(reference)}&status=eq.initialized`, {
      method: 'PATCH', headers: svcHeaders(serviceRoleKey, { Prefer: 'return=minimal' }), body: JSON.stringify({ status })
    });
  } catch (_) { /* audit only */ }
}

/**
 * Applies a validated, intent-matched payment, atomically and idempotently.
 * Returns { result: 'applied'|'already_applied'|'other_user'|'no_intent'|'mismatch', currentPeriodEnd, livemode }.
 * Throws on infrastructure failure (callers must NOT tell the student the
 * payment failed — it may have succeeded at Paystack; they should retry).
 */
async function applyVerifiedPayment({ userId, tx, serviceRoleKey }) {
  const livemode = tx.domain ? tx.domain === 'live' : true;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_verified_payment_v2`, {
    method: 'POST',
    headers: svcHeaders(serviceRoleKey),
    body: JSON.stringify({
      p_user_id: userId,
      p_reference: tx.reference,
      p_amount_minor: tx.amount,
      p_currency: String(tx.currency).toUpperCase(),
      p_livemode: livemode,
      p_days: SUBSCRIPTION_DAYS
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 404 / PGRST202 = schema-09 not deployed. Fail loudly; never fall back to a weaker path.
    throw new Error(`apply_verified_payment_v2 failed: ${res.status} ${text}`);
  }
  const d = await res.json();
  return { result: d.result, currentPeriodEnd: d.current_period_end || null, livemode };
}

/**
 * Everything needed to price and risk-assess a checkout, in one round trip
 * (get_pricing_signals, schema 10): selected country, first-payment region
 * lock, paid count, country changes (30d) and checkout attempts (7d).
 * Server-only (service role). Throws on infra failure.
 */
async function getPricingSignals(userId, serviceRoleKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_pricing_signals`, {
    method: 'POST', headers: svcHeaders(serviceRoleKey), body: JSON.stringify({ p_user_id: userId })
  });
  if (!res.ok) throw new Error(`get_pricing_signals failed: ${res.status} ${await res.text().catch(() => '')}`);
  const d = await res.json();
  return {
    profileCountry: d.profile_country || null,
    lockedRegion: d.locked_region || null,
    paidCount: Number(d.paid_count || 0),
    countryChanges: Array.isArray(d.country_changes) ? d.country_changes : [],
    intents: Array.isArray(d.intents) ? d.intents : []
  };
}

/**
 * Atomically creates (or reuses an identical open) payment intent.
 * Returns { reused, reference, accessCode? } or { blocked:true }.
 */
async function createPaymentIntent(args, serviceRoleKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_payment_intent`, {
    method: 'POST', headers: svcHeaders(serviceRoleKey),
    body: JSON.stringify({
      p_user_id: args.userId, p_reference: args.reference, p_region: args.region, p_currency: args.currency,
      p_amount_minor: args.amount, p_profile_country: args.profileCountry || null, p_ip_country: args.ipCountry || null,
      p_risk_score: args.riskScore || 0, p_risk_flags: args.riskFlags || [], p_confirmed: !!args.confirmed
    })
  });
  if (!res.ok) throw new Error(`create_payment_intent failed: ${res.status} ${await res.text().catch(() => '')}`);
  const d = await res.json();
  return { reused: !!d.reused, blocked: !!d.blocked, reference: d.reference, accessCode: d.access_code || null };
}

/** Stores the Paystack access code on the intent so an identical retry can reuse it. */
async function setAccessCode(reference, accessCode, serviceRoleKey) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/payment_intents?reference=eq.${encodeURIComponent(reference)}`, {
      method: 'PATCH', headers: svcHeaders(serviceRoleKey, { Prefer: 'return=minimal' }), body: JSON.stringify({ access_code: accessCode })
    });
  } catch (_) { /* reuse is an optimisation only */ }
}

module.exports = {
  paystackMode, modeMismatch, validateTransaction, checkAgainstIntent, getIntent, markIntent, applyVerifiedPayment,
  getPricingSignals, createPaymentIntent, setAccessCode,
  SUPABASE_URL
};
