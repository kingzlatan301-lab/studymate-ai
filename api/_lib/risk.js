/**
 * StudyMate AI — explainable pricing-risk assessment (first purchase)
 * ─────────────────────────────────────────────────────────────────────────
 * Pure function, no I/O: given the signals the server has gathered, return a
 * score, the reasons behind it, and what the student must do to continue.
 * Every point has a named reason (flags) so a decision can always be explained.
 *
 * PHILOSOPHY — a risk score never bans anyone:
 *   low     (< MEDIUM)  proceed normally
 *   medium  (>= MEDIUM) proceed after the student CONFIRMS their country of
 *                       residence (server requires `confirmRegion` to equal the
 *                       region it is about to charge)
 *   high    (>= HIGH)   pause country-based pricing for a short, bounded
 *                       cool-down (max COOLDOWN_MS since the last country change
 *                       or different-region attempt), then proceed after
 *                       confirmation. Windows roll, so nobody stays flagged.
 * VPN/proxy use is NOT penalised on its own; a Tor exit node adds a token
 * amount only. IP country is a signal, never an authority over the price.
 *
 * Students who already completed a purchase are region-LOCKED and skip all of
 * this (their price cannot change, so there is nothing to game).
 */
const { PREMIUM_PRICING } = require('./pricing');

const MEDIUM = 15;
const HIGH = 40;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// Edge "country" values that mean "unknown" rather than a real country.
const UNKNOWN_IP = new Set(['', 'XX', 'ZZ']);

function normalizeIpCountry(raw) {
  const c = String(raw || '').trim().toUpperCase();
  if (UNKNOWN_IP.has(c)) return null;
  if (c === 'T1') return 'T1';               // Tor exit — kept only as a tiny signal
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/**
 * @param {object} s
 * @param {string|null} s.profileCountry   selected country (server-read)
 * @param {string|null} s.ipCountry        edge-reported country (raw header value)
 * @param {{region:string, amount:number}} s.pricing  what this student would be charged
 * @param {Array<{at:string}>} s.countryChanges   changes in the last 30 days
 * @param {Array<{region:string, amount:number, at:string}>} s.intents  checkout attempts, last 7 days
 * @param {number} [s.now]
 */
function assessPricingRisk(s) {
  const now = s.now || Date.now();
  const flags = [];
  let score = 0;
  const add = (pts, flag) => { score += pts; flags.push(flag); };

  const ip = normalizeIpCountry(s.ipCountry);
  const selected = (s.profileCountry || '').toLowerCase();
  const selectedKnown = selected && selected !== 'intl';

  // 1. Selected country vs detected region (small; many innocent causes).
  let mismatch = false;
  if (ip && ip !== 'T1' && selectedKnown && ip.toLowerCase() !== selected) {
    mismatch = true;
    add(15, 'country_ip_mismatch');
  }
  if (ip === 'T1') add(5, 'anonymizer_ip');

  // 2. How often the selected country has changed (30-day window).
  const changes = (s.countryChanges || []).map(c => Date.parse(c.at)).filter(Number.isFinite);
  if (changes.length >= 6) add(40, 'many_country_changes');
  else if (changes.length >= 3) add(20, 'repeated_country_changes');

  // 3. Checkout attempts in the last 7 days.
  const intents = (s.intents || []).map(i => ({ region: i.region, amount: Number(i.amount), at: Date.parse(i.at) }))
    .filter(i => Number.isFinite(i.at));
  const regions = new Set(intents.map(i => i.region));
  regions.add(s.pricing.region);
  if (regions.size >= 3) add(35, 'attempts_in_many_regions');
  else if (regions.size === 2) add(20, 'attempts_in_two_regions');

  const last24h = intents.filter(i => now - i.at < DAY).length;
  if (last24h >= 6) add(25, 'many_attempts_24h');
  else if (last24h >= 3) add(10, 'repeated_attempts_24h');

  // 4. Moving to a CHEAPER region than one already attempted this week.
  if (intents.some(i => i.region !== s.pricing.region && i.amount > s.pricing.amount)) {
    add(25, 'switched_to_cheaper_region');
  }

  // 5. Cool-down: only while the latest "pricing-shopping" event is recent.
  const lastChange = changes.length ? Math.max(...changes) : 0;
  const lastDifferent = intents.filter(i => i.region !== s.pricing.region).reduce((m, i) => Math.max(m, i.at), 0);
  const cooldownEnd = Math.max(lastChange, lastDifferent) + COOLDOWN_MS;
  const inCooldown = Math.max(lastChange, lastDifferent) > 0 && cooldownEnd > now;

  const level = score >= HIGH ? 'high' : score >= MEDIUM ? 'medium' : 'low';
  const restricted = level === 'high' && inCooldown;
  return {
    score, level, flags, mismatch,
    restricted,
    retryAfterSec: restricted ? Math.max(1, Math.ceil((cooldownEnd - now) / 1000)) : 0,
    confirmationRequired: !restricted && score >= MEDIUM,
    ipCountry: ip                              // server-side only — never put this in a response
  };
}

/** Region of a past payment amount (legacy fallback helper for tests/diagnostics). */
function regionForAmount(amount) {
  const hit = Object.keys(PREMIUM_PRICING).find(r => PREMIUM_PRICING[r].amount === amount);
  return hit || null;
}

module.exports = { assessPricingRisk, normalizeIpCountry, regionForAmount, MEDIUM, HIGH, COOLDOWN_MS };
