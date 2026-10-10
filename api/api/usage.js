/**
 * StudyMate AI — authoritative usage snapshot
 * ─────────────────────────────────────────────────────────────────────────
 * GET /api/usage   (Authorization: Bearer <supabase access token>)
 *
 * The SERVER's view of the signed-in student's Free usage for EVERY limited
 * feature in the current UTC period, plus their lifetime count of answered
 * Ask AI questions, so the UI never has to trust localStorage:
 *
 *   200 { premium, limits: { <feature>: { used, max, period, periodKey } },
 *         totalAsked }
 *
 * `used` includes in-flight reservations, so it matches exactly what the next
 * /api/ask call will enforce. Failed provider requests are released and never
 * show up here. Limits come from api/_lib/limits.js (same source as /api/ask).
 * One database round-trip (get_usage_snapshot) plus the Premium check.
 */

const { getAuthedUser, isPremium, periodKeyFor, getUsageSnapshot } = require('./_lib/plan');
const { FREE_FEATURE_LIMITS } = require('./_lib/limits');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) { res.status(401).json({ error: 'You must be signed in.', code: 'AUTH_REQUIRED' }); return; }
  const user = await getAuthedUser(accessToken);
  if (!user) { res.status(401).json({ error: 'Your session has expired — please sign in again.', code: 'AUTH_REQUIRED' }); return; }

  try {
    const features = Object.keys(FREE_FEATURE_LIMITS);
    const items = features.map(f => ({ feature: f, periodKey: periodKeyFor(FREE_FEATURE_LIMITS[f].period) }));
    const [snap, premium] = await Promise.all([
      getUsageSnapshot(accessToken, items),
      isPremium(accessToken, user.id)
    ]);
    const limits = {};
    items.forEach(({ feature, periodKey }) => {
      const cfg = FREE_FEATURE_LIMITS[feature];
      limits[feature] = {
        used: Number((snap[feature] && snap[feature].used) || 0),
        max: cfg.max, period: cfg.period, periodKey
      };
    });
    res.status(200).json({ premium, limits, totalAsked: Number(snap._total_askAI || 0) });
  } catch (err) {
    console.error('usage snapshot failed', err && err.message);
    res.status(502).json({ error: 'Could not load your usage right now.', code: 'USAGE_CHECK_FAILED' });
  }
};
