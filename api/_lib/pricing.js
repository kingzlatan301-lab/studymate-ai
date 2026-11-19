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

/**
 * CHARGE CURRENCY (what Paystack is actually asked to collect)  versus  PRICE (what the student is shown).
 *
 * PREMIUM_PRICING above is the PRICE the student sees (naira for Nigeria, dollars elsewhere). Paystack can only settle a
 * currency that is enabled on the merchant account; USD is not enabled on this one, so a USD initialize is refused (HTTP 403).
 * Until USD is enabled, the default mode "ngn" charges every dollar-priced region in NAIRA at the app's fixed reference rate
 * (REFERENCE_NGN_PER_USD, the same rate those dollar prices were derived from), rounded to whole naira. The dollar figure
 * stays the displayed price; the client also tells the student the naira amount they will be charged.
 *
 *   PAYSTACK_CHARGE_MODE = "ngn" (default)   dollar-priced regions are charged in NGN
 *   PAYSTACK_CHARGE_MODE = "native"          charge in the price's own currency (set this once USD is enabled on Paystack)
 *   NGN_PER_USD          optional integer override of the reference rate (accepted range 500-5000; anything else is ignored)
 *
 * The intent stores the CHARGE terms (naira); verification compares Paystack's verified amount+currency with exactly those,
 * so a payment is accepted only for the converted amount that was created server-side. The browser never supplies either figure.
 */
const REFERENCE_NGN_PER_USD = 1330;

function chargeMode(env) {
  const v = String((env || process.env).PAYSTACK_CHARGE_MODE || '').trim().toLowerCase();
  return v === 'native' ? 'native' : 'ngn';
}

/** Whole-number naira per US dollar. An invalid override is ignored (falls back to the reference rate), never half-applied. */
function ngnPerUsd(env) {
  const raw = String((env || process.env).NGN_PER_USD || '').trim();
  if (!raw) return REFERENCE_NGN_PER_USD;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 500 && n <= 5000 ? n : REFERENCE_NGN_PER_USD;
}

/**
 * @param {{currency:string, amount:number}} pricing  the displayed price (from resolvePricing)
 * @returns {{currency:string, amount:number, converted:boolean, rate:number|null}}  what to charge, in minor units
 */
function resolveCharge(pricing, env) {
  if (chargeMode(env) === 'native' || pricing.currency !== 'USD') return { currency: pricing.currency, amount: pricing.amount, converted: false, rate: null };
  const rate = ngnPerUsd(env);
  const naira = Math.round(pricing.amount * rate / 100);          // cents x NGN-per-USD / 100 = naira, to the nearest whole naira
  return { currency: 'NGN', amount: naira * 100, converted: true, rate };   // kobo
}

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

module.exports = { PREMIUM_PRICING, DEFAULT_REGION, SUBSCRIPTION_DAYS, SUPPORTED_PROVIDERS, resolvePricing, isKnownRegion, resolveCharge, chargeMode, ngnPerUsd, REFERENCE_NGN_PER_USD };
