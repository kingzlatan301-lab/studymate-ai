/**
 * GET /api/classroom : read shared Classroom Notes pages (no AI call, no quota).
 *   ?action=get&board=&subject=&topic=&format=&lang=   -> { found, content? }
 *   ?action=list&board=&subject=&lang=&offset=         -> { pages:[{topic,format,content}], next }   (for "Save for offline")
 * Needs a signed-in student (any plan). Pages are written only by api/ask.js (see api/_lib/classroom.js for the trust model).
 */
const { getAuthedUser } = require('./_lib/plan');
const { rateLimit, clientIp } = require('./_lib/ratelimit');
const classroom = require('./_lib/classroom');

const PAGE = 40;
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const requiredSecret = process.env.APP_SHARED_SECRET;
  if (requiredSecret && req.headers['x-app-secret'] !== requiredSecret) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const ip = await rateLimit({ scope: 'classroom-ip', id: clientIp(req), limit: 60 });
  if (ip.limited) { res.status(429).json({ error: 'Too many requests.' }); return; }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = token ? await getAuthedUser(token) : null;
  if (!user) { res.status(401).json({ error: 'Please sign in.', code: 'AUTH_REQUIRED' }); return; }
  const u = await rateLimit({ scope: 'classroom-user', id: user.id, limit: 60 });
  if (u.limited) { res.status(429).json({ error: 'Too many requests.' }); return; }

  const q = req.query || {};
  const lang = typeof q.lang === 'string' && /^[a-z]{2}$/.test(q.lang) ? q.lang : 'en';
  if (q.action === 'get') {
    const cr = classroom.resolveRequest({ board: q.board, subject: q.subject, topic: q.topic, format: q.format, lang });
    if (!cr.ok) { res.status(400).json({ error: cr.error }); return; }
    const hit = await classroom.getPage(cr.key);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.status(200).json(hit ? { found: true, content: hit.content, tier: hit.tier } : { found: false });
    return;
  }
  if (q.action === 'list') {
    const C = classroom.curriculum();
    if (typeof q.board !== 'string' || typeof q.subject !== 'string' || !C.getExamBoard(q.board) || !C.getSubject(q.board, q.subject)) { res.status(400).json({ error: 'Unknown exam or subject.' }); return; }
    const offset = Math.max(0, Math.min(100000, parseInt(q.offset, 10) || 0));
    const rows = await classroom.listPages(q.board, q.subject, lang, offset, PAGE);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.status(200).json({ pages: rows.map(r => ({ topic: r.topic, format: r.format, content: r.content })), next: rows.length === PAGE ? offset + PAGE : null });
    return;
  }
  res.status(400).json({ error: 'Malformed request.' });
};
