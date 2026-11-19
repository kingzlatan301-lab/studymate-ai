/**
 * GET /api/curriculum?since=<ISO time>   -> { updatedAt, syllabi:[{ board, subject, version, syllabusYear, source, aliases, topics:[{name,subtopics}], translations:{ fr:[{position,name,subtopics}] } }] }
 * Public (a syllabus is not personal data). Returns only PUBLISHED syllabi changed after `since` (omit `since` for everything).
 * The app merges these over its bundled curriculum and caches them for offline use. See supabase-schema-20-curriculum.sql.
 */
const { SUPABASE_URL } = require('./_lib/plan');
const { rateLimit, clientIp } = require('./_lib/ratelimit');

function svcHeaders() { const k = process.env.SUPABASE_SERVICE_ROLE_KEY; return k ? { apikey: k, Authorization: `Bearer ${k}` } : null; }
const rest = async (h, q) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: h }); if (!r.ok) throw new Error('rest ' + r.status); return r.json(); };
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Only short strings pass through; anything else becomes an empty list (never trusted blindly from the database).
const strs = (a, max, len) => (Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim() && x.length <= len).slice(0, max) : []);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const requiredSecret = process.env.APP_SHARED_SECRET;
  if (requiredSecret && req.headers['x-app-secret'] !== requiredSecret) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const ip = await rateLimit({ scope: 'curriculum-ip', id: clientIp(req), limit: 30 });
  if (ip.limited) { res.status(429).json({ error: 'Too many requests.' }); return; }
  const h = svcHeaders(); if (!h) { res.status(200).json({ updatedAt: null, syllabi: [] }); return; }   // not configured: app uses its bundled curriculum
  const since = typeof (req.query || {}).since === 'string' && !isNaN(Date.parse(req.query.since)) ? new Date(req.query.since).toISOString() : null;
  try {
    const syl = await rest(h, `curriculum_syllabi?status=eq.published${since ? `&updated_at=gt.${encodeURIComponent(since)}` : ''}&select=id,board_code,subject,version,syllabus_year,source,aliases,updated_at&order=updated_at.asc&limit=500`);
    const ids = syl.map(s => s.id); const topics = {}, trans = {};
    for (const part of chunk(ids, 40)) {
      const list = part.join(',');
      let rows;
      try { rows = await rest(h, `curriculum_topics?syllabus_id=in.(${list})&select=syllabus_id,position,name,subtopics,objectives,prerequisites&order=position.asc&limit=5000`); }
      catch (e) { rows = await rest(h, `curriculum_topics?syllabus_id=in.(${list})&select=syllabus_id,position,name,subtopics&order=position.asc&limit=5000`); }   // schema 21 not applied yet
      rows.forEach(t => { (topics[t.syllabus_id] = topics[t.syllabus_id] || []).push(t); });
      (await rest(h, `curriculum_translations?syllabus_id=in.(${list})&select=syllabus_id,topic_position,lang,name,subtopics&limit=20000`)).forEach(t => { ((trans[t.syllabus_id] = trans[t.syllabus_id] || {})[t.lang] = (trans[t.syllabus_id][t.lang] || [])).push({ position: t.topic_position, name: t.name, subtopics: t.subtopics }); });
    }
    const out = syl.filter(s => (topics[s.id] || []).length).map(s => ({
      board: s.board_code, subject: s.subject, version: s.version, syllabusYear: s.syllabus_year, source: s.source || {}, aliases: s.aliases || {},
      topics: (topics[s.id] || []).sort((a, b) => a.position - b.position).map(t => ({ name: t.name, subtopics: Array.isArray(t.subtopics) ? t.subtopics : [], objectives: strs(t.objectives, 20, 300), prerequisites: strs(t.prerequisites, 12, 160) })),
      translations: trans[s.id] || {}
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    res.status(200).json({ updatedAt: syl.length ? syl[syl.length - 1].updated_at : since, syllabi: out });
  } catch (e) { res.status(502).json({ error: 'Curriculum is temporarily unavailable.' }); }
};
