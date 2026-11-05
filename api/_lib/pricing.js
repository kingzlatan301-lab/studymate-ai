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
 * Nigeria is charged in Nigerian Naira (minor unit = kobo, unchanged: NGN 2,000).
 * Every other region is charged in US dollars (minor unit = cents). Each dollar
 * price is the previous naira regional price converted at 1 USD = NGN 1,330
 * (the app's reference rate of 16 Oct 2026) and rounded to the nearest cent.
 * Charging USD requires USD to be enabled on the Paystack account. `intl` is
 * the price for students who have not chosen a country (and any country
 * without its own price point).
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
  ng:   { provider: 'paystack', currency: 'NGN', amount: 200000 },  // ₦2,000 (the only naira price)
  gh:   { provider: 'paystack', currency: 'USD', amount: 323 },
  ke:   { provider: 'paystack', currency: 'USD', amount: 331 },
  za:   { provider: 'paystack', currency: 'USD', amount: 402 },
  gb:   { provider: 'paystack', currency: 'USD', amount: 436 },
  us:   { provider: 'paystack', currency: 'USD', amount: 429 },
  ca:   { provider: 'paystack', currency: 'USD', amount: 391 },
  in:   { provider: 'paystack', currency: 'USD', amount: 113 },
  au:   { provider: 'paystack', currency: 'USD', amount: 462 },
  ae:   { provider: 'paystack', currency: 'USD', amount: 353 },
  intl: { provider: 'paystack', currency: 'USD', amount: 429 }   // International / not selected
};
// Providers the CODE can actually settle today. A region whose `provider` is not in this list is refused by
// checkout (fail closed) — changing a price row to 'stripe' cannot start charging anyone until Stripe support
// (schema 13 + api/stripe-webhook.js, see docs/GLOBAL-READINESS.md §3) is implemented AND added here.
const SUPPORTED_PROVIDERS = ['paystack'];
const DEFAULT_REGION = 'intl';
const SUBSCRIPTION_DAYS = 30;

function isKnownRegion(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(PREMIUM_PRICING, code);
}

/**
 * @param {string|null} lockedRegion  region of the student's first successful payment (or null)
 * @param {string|null} profileCountry country on the student's server-side profile row
 * @returns {{region:string, provider:string, currency:string, amount:number, source:'locked'|'profile'|'default'}}
 */
function resolvePricing(lockedRegion, profileCountry) {
  let region = DEFAULT_REGION, source = 'default';
  if (isKnownRegion(lockedRegion)) { region = lockedRegion; source = 'locked'; }
  else if (isKnownRegion(profileCountry)) { region = profileCountry; source = 'profile'; }
  const p = PREMIUM_PRICING[region];
  return { region, provider: p.provider, currency: p.currency, amount: p.amount, source };
}

module.exports = { PREMIUM_PRICING, DEFAULT_REGION, SUBSCRIPTION_DAYS, SUPPORTED_PROVIDERS, resolvePricing, isKnownRegion };
