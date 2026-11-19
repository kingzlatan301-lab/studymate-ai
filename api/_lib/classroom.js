/**
 * Shared Classroom Notes page cache (server side).
 *
 * WHY: every student asking for "Algebra / Classroom Notes" would otherwise pay for the same text. The FIRST valid page is
 * stored once and served to everyone. A cache hit costs no AI call and NO student quota.
 *
 * TRUST MODEL (why this cannot be poisoned by a student):
 *   - The client sends only a KEY {board, subject, topic, format, lang}. It is checked against the server's own copy of the
 *     curriculum (curriculum-data.js + curriculum-imports.js); an unknown topic is refused.
 *   - On a miss the SERVER builds the prompt (the client's own prompt text is ignored), the provider answers, and the
 *     server validates the reply (classroom-notes.js validateGenerated) before it is stored. Only server-generated, validated
 *     text is ever stored. Students never write to the cache.
 *   - Free (Gemini) text is stored only if no page exists. A Premium regeneration (Claude) may replace it.
 *   - An admin can withdraw a bad page by setting status = 'hidden' (service role / SQL editor).
 * The table has RLS on and NO client policies: only the service role (this code) can read or write it.
 */
const fs = require('fs');
const path = require('path');
const { SUPABASE_URL } = require('./plan');

const ROOT = path.join(__dirname, '..', '..');
let _cn = null, _cur = null;
function core() { return _cn || (_cn = require('../../classroom-notes.js')); }   // static path: the bundler traces it (and math-render.js)
function curriculum() {
  if (_cur) return _cur;
  const w = {};
  const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { return null; } };
  const imp = read('curriculum-imports.js'); if (imp) new Function('window', imp)(w);
  new Function('window', read('curriculum-data.js'))(w);
  return (_cur = w.CURRICULUM);
}
const LANG_RE = /^[a-z]{2}$/;
const str = (v, max) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;

/** Validates a client key against the server curriculum and builds the server-side prompt. */
function resolveRequest(c) {
  if (!c || typeof c !== 'object') return { ok: false, error: 'Malformed request.' };
  const board = str(c.board, 40), subject = str(c.subject, 120), topic = str(c.topic, 160), format = str(c.format, 20);
  const lang = typeof c.lang === 'string' && LANG_RE.test(c.lang) ? c.lang : 'en';
  const cn = core();
  if (!board || !subject || !topic || !cn.FORMAT_IDS.includes(format)) return { ok: false, error: 'Malformed request.' };
  const C = curriculum(); const b = C.getExamBoard(board);
  if (!b) return { ok: false, error: 'Unknown exam.' };
  const t = (C.getTopics(board, subject) || []).find(x => x.name === topic);
  if (!t) return { ok: false, error: 'Unknown topic for this subject.' };
  const subtopics = Array.isArray(t.subtopics) ? t.subtopics.slice() : [];
  const ctx = { subject, topic, subtopics, boardLabel: b.label, level: b.level, language: lang };
  const prompt = cn.buildPrompt(format, ctx);
  if (!prompt) return { ok: false, error: 'Malformed request.' };
  return { ok: true, key: [board, subject, topic, format, lang].join('|'), parts: { board, subject, topic, format, lang }, ctx, prompt };
}

const validate = (text, ctx) => core().validateGenerated(text, ctx);
const textOf = blocks => (typeof blocks === 'string' ? blocks : (Array.isArray(blocks) ? blocks.map(b => (b && b.text) || '').join('') : ''));

function svc() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!k) return null;
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
}
async function getPage(cacheKey) {
  const h = svc(); if (!h) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/cn_shared_pages?cache_key=eq.${encodeURIComponent(cacheKey)}&status=eq.published&select=content,tier,updated_at&limit=1`, { headers: h });
    if (!r.ok) return null; const rows = await r.json(); return rows && rows[0] ? rows[0] : null;
  } catch (_) { return null; }       // a cache problem must never block generation
}
async function putPage(cr, text, tier, overwrite) {
  const h = svc(); if (!h) return false;
  const p = cr.parts;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/cn_shared_pages?on_conflict=cache_key`, {
      method: 'POST', headers: Object.assign({}, h, { Prefer: `resolution=${overwrite ? 'merge-duplicates' : 'ignore-duplicates'},return=minimal` }),
      body: JSON.stringify({ cache_key: cr.key, board_code: p.board, subject: p.subject, topic: p.topic, format: p.format, lang: p.lang, content: text, tier, status: 'published', updated_at: new Date().toISOString() })
    });
    return r.ok;
  } catch (_) { return false; }
}
async function listPages(board, subject, lang, offset, limit) {
  const h = svc(); if (!h) return [];
  try {
    const q = `board_code=eq.${encodeURIComponent(board)}&subject=eq.${encodeURIComponent(subject)}&lang=eq.${encodeURIComponent(lang)}&status=eq.published&select=topic,format,content,updated_at&order=topic.asc,format.asc&offset=${offset}&limit=${limit}`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/cn_shared_pages?${q}`, { headers: h });
    if (!r.ok) return []; return await r.json();
  } catch (_) { return []; }
}
module.exports = { resolveRequest, validate, textOf, getPage, putPage, listPages, curriculum };
