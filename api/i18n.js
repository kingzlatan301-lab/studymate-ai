/**
 * GET /api/i18n?lang=fr -> { lang, strings: { "<exact English phrase>": "<translation>" } }
 * Public. Lets translations be corrected or added without an app release (table ui_strings, schema 20).
 * The app only ever applies these as plain text (textContent), so a translation can never inject markup.
 */
const { SUPABASE_URL } = require('./_lib/plan');
const { rateLimit, clientIp } = require('./_lib/ratelimit');
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const requiredSecret = process.env.APP_SHARED_SECRET;
  if (requiredSecret && req.headers['x-app-secret'] !== requiredSecret) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const ip = await rateLimit({ scope: 'i18n-ip', id: clientIp(req), limit: 30 });
  if (ip.limited) { res.status(429).json({ error: 'Too many requests.' }); return; }
  const lang = (req.query || {}).lang;
  if (typeof lang !== 'string' || !/^[a-z]{2}$/.test(lang)) { res.status(400).json({ error: 'Malformed request.' }); return; }
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!k) { res.status(200).json({ lang, strings: {} }); return; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ui_strings?lang=eq.${lang}&select=key,text&limit=5000`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
    if (!r.ok) throw new Error('rest');
    const strings = {}; (await r.json()).forEach(x => { if (typeof x.key === 'string' && typeof x.text === 'string') strings[x.key] = x.text; });
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    res.status(200).json({ lang, strings });
  } catch (_) { res.status(502).json({ error: 'Translations are temporarily unavailable.' }); }
};
