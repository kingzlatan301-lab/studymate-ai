/**
 * StudyMate AI — server-owned Premium pricing
 * ─────────────────────────────────────────────────────────────────────────
 * The browser NEVER chooses an amount, a currency or a pricing region. It asks
 * the server for a checkout; the server computes all three from the rules
 * below, stores them as a payment intent (payment_intents table), initializes
 * the Paystack transaction with exactly those terms, and later refuses to
 * grant Premium unless Paystack's verified transaction matches that intent.
 *
 * PRICE TABLE
 * Paystack on this account can only charge NGN, so every regional price point
 * is expressed in NGN (minor unit = kobo). These are the product's existing
 * regional prices, unchanged. `intl` is the price for students who have not
 * chosen a country (and any country without its own price point).
 *
 * PRICING-REGION POLICY (read before changing)
 *   1. A student's first purchase is priced by the country on their ACCOUNT
 *      PROFILE, read server-side from the `profiles` row of the authenticated
 *      user — never from anything in the checkout request. Product decision:
 *      the selected country is the pricing region. It is user-editable, so on
 *      its own it is NOT proof of where someone lives; this is why steps 2–4
 *      exist and why the residual risk is documented in the README.
 *   2. LOCK: once a student has one successful payment, their pricing region is
 *      the region of that payment, permanently. Changing the profile country
 *      afterwards (cheaper region, or back again) does not change what they
 *      are charged — renewals stay on the locked region.
 *   3. Every transaction is bound to the terms it was created with. Changing
 *      country mid-checkout can neither make an old transaction cheaper nor
 *      invalidate a legitimate one: verification compares Paystack's result
 *      with the stored intent, not with the profile.
 *   4. Audit trail: each intent stores the profile country and the edge-
 *      reported IP country. IP is recorded for later review only — it is NEVER
 *      used to authorise or deny a price (VPNs and travellers make it
 *      unreliable as a sole signal).
 */
const PREMIUM_PRICING = {
  ng:   { currency: 'NGN', amount: 200000 },  // ₦2,000
  gh:   { currency: 'NGN', amount: 430000 },
  ke:   { currency: 'NGN', amount: 440000 },
  za:   { currency: 'NGN', amount: 535000 },
  gb:   { currency: 'NGN', amount: 580000 },
  us:   { currency: 'NGN', amount: 570000 },
  ca:   { currency: 'NGN', amount: 520000 },
  in:   { currency: 'NGN', amount: 150000 },
  au:   { currency: 'NGN', amount: 615000 },
  ae:   { currency: 'NGN', amount: 470000 },
  intl: { currency: 'NGN', amount: 570000 }   // International / not selected
};
const DEFAULT_REGION = 'intl';
const SUBSCRIPTION_DAYS = 30;

function isKnownRegion(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(PREMIUM_PRICING, code);
}

/**
 * @param {string|null} lockedRegion  region of the student's first successful payment (or null)
 * @param {string|null} profileCountry country on the student's server-side profile row
 * @returns {{region:string, currency:string, amount:number, source:'locked'|'profile'|'default'}}
 */
function resolvePricing(lockedRegion, profileCountry) {
  let region = DEFAULT_REGION, source = 'default';
  if (isKnownRegion(lockedRegion)) { region = lockedRegion; source = 'locked'; }
  else if (isKnownRegion(profileCountry)) { region = profileCountry; source = 'profile'; }
  const p = PREMIUM_PRICING[region];
  return { region, currency: p.currency, amount: p.amount, source };
}

module.exports = { PREMIUM_PRICING, DEFAULT_REGION, SUBSCRIPTION_DAYS, resolvePricing, isKnownRegion };
