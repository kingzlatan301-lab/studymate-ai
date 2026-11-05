/**
 * StudyMate AI — tiny structured logger (one JSON line per event).
 * Vercel log drains / search can filter on `event`, `feature`, `provider`.
 * NEVER pass request bodies, prompts, photos, emails or tokens here; the
 * helper also drops obviously sensitive keys as a seatbelt.
 */
const BLOCKED = new Set(['body', 'content', 'prompt', 'text', 'email', 'token', 'authorization', 'access_token', 'password', 'image', 'data']);

function log(level, event, fields) {
  const line = { ts: new Date().toISOString(), level, event };
  for (const [k, v] of Object.entries(fields || {})) {
    if (BLOCKED.has(String(k).toLowerCase())) continue;
    line[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  (level === 'error' || level === 'warn' ? console.error : console.log)(JSON.stringify(line));
}

module.exports = {
  info: (e, f) => log('info', e, f),
  warn: (e, f) => log('warn', e, f),
  error: (e, f) => log('error', e, f)
};
