/**
 * StudyMate AI — "Export my data" and "Delete my account"
 * ─────────────────────────────────────────────────────────────────────────
 *   GET  /api/account?action=export            → JSON download of the caller's data
 *   POST /api/account {action:'delete', confirm:'DELETE'}
 *
 * TRUST MODEL. Identity comes ONLY from the verified Supabase access token
 * (getAuthedUser). A user id in the query/body is never read, so a student can
 * only ever export or delete THEMSELVES. The service-role key is used, but every
 * query is hard-scoped to the verified user id.
 *
 * EXPORT reads the student's own rows from every user-owned table. Internal
 * anti-abuse columns (payment risk score/flags, IP country) are deliberately not
 * exported. A table that does not exist yet (older schema) is reported under
 * `unavailable` instead of failing the whole export.
 *
 * DELETE is FAIL-CLOSED and has three gates:
 *   1. an explicit retention policy must be chosen by the owner via env
 *      ACCOUNT_DELETION_RETENTION. Every user table (including the `payments`
 *      ledger) is `on delete cascade` from auth.users, so deleting the account
 *      deletes payment records too. Only 'delete_all' is implemented. Unset or any
 *      other value → 503 and NOTHING is deleted. ('anonymise_payments' needs a
 *      schema change first — see docs/GLOBAL-READINESS.md §6.)
 *   2. typed confirmation (confirm === 'DELETE').
 *   3. recent sign-in: the token's `amr` claim must show an authentication within
 *      the last 15 minutes (a stolen long-lived session cannot delete the account).
 * Deletion is one Supabase admin call; the cascade runs in one transaction.
 * Paystack purchases are one-off 30-day payments (no recurring billing), so there
 * is no subscription to cancel at the provider — remaining Premium days are lost.
 */
const { getAuthedUser } = require('./_lib/plan');
const { rateLimit, clientIp } = require('./_lib/ratelimit');
const logger = require('./_lib/log');
const crypto = require('crypto');

const SUPABASE_URL = 'https://xlbnvmkcooueucuayrvy.supabase.co';
const REAUTH_WINDOW_SEC = 15 * 60;
const PAGE = 1000, MAX_PAGES = 50;

// key = the column holding the owner's auth user id.
const EXPORT_TABLES = [
  { table: 'profiles', key: 'id' },
  { table: 'subscriptions', key: 'user_id' },
  { table: 'payments', key: 'user_id' },
  { table: 'payment_intents', key: 'user_id', select: 'reference,status,pricing_region,currency,amount_minor,created_at,paid_at' },
  { table: 'ai_usage', key: 'user_id' },
  { table: 'saved_questions', key: 'user_id' },
  { table: 'study_sessions', key: 'user_id' },
  { table: 'weakness_profiles', key: 'user_id' },
  { table: 'review_schedule', key: 'user_id' },
  { table: 'readiness_snapshots', key: 'user_id' },
  { table: 'past_paper_analyses', key: 'user_id' },
  { table: 'user_visual_preferences', key: 'user_id' },
  { table: 'answer_feedback', key: 'user_id' },
  { table: 'profile_country_changes', key: 'user_id' }
];

function svcHeaders(k, extra) { return Object.assign({ apikey: k, Authorization: `Bearer ${k}` }, extra || {}); }

/** Seconds since the most recent authentication method in the token, or null if the claim is missing/unreadable. */
function secondsSinceAuth(accessToken, nowMs) {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1], 'base64url').toString('utf8'));
    const stamps = (Array.isArray(payload.amr) ? payload.amr : []).map(a => Number(a && a.timestamp)).filter(Number.isFinite);
    if (!stamps.length) return null;
    return Math.max(0, Math.floor(nowMs / 1000) - Math.max(...stamps));
  } catch (_) { return null; }
}

async function readTable(spec, userId, key) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ select: spec.select || '*', [spec.key]: 'eq.' + userId, limit: String(PAGE), offset: String(page * PAGE) });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${spec.table}?${q}`, { headers: svcHeaders(key) });
    if (!res.ok) return { unavailable: true };
    const part = await res.json();
    if (!Array.isArray(part)) return { unavailable: true };
    rows.push(...part);
    if (part.length < PAGE) return { rows };
  }
  return { rows, truncated: true };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const ipLimit = await rateLimit({ scope: 'account-ip', id: clientIp(req), limit: 20, windowSec: 3600 });
  if (ipLimit.limited) { res.status(429).json({ error: 'Too many requests — please try again later.' }); return; }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) { res.status(503).json({ error: 'This feature is not configured on the server yet.' }); return; }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) { res.status(401).json({ error: 'You must be signed in.' }); return; }
  const user = await getAuthedUser(accessToken);
  if (!user || !user.id) { res.status(401).json({ error: 'Your session has expired — please sign in again.' }); return; }

  const userLimit = await rateLimit({ scope: 'account-user', id: user.id, limit: 5, windowSec: 3600 });
  if (userLimit.limited) { res.status(429).json({ error: 'Too many requests — please try again later.' }); return; }

  // ───────────── EXPORT ─────────────
  if (req.method === 'GET') {
    const tables = {}, unavailable = [], truncated = [];
    for (const spec of EXPORT_TABLES) {
      let r;
      try { r = await readTable(spec, user.id, serviceRoleKey); } catch (_) { r = { unavailable: true }; }
      if (r.unavailable) { unavailable.push(spec.table); continue; }
      tables[spec.table] = r.rows;
      if (r.truncated) truncated.push(spec.table);
    }
    logger.info('account_export', { userHash: crypto.createHash('sha256').update(user.id).digest('hex').slice(0, 12), tables: Object.keys(tables).length, unavailable: unavailable.length });
    res.setHeader('Content-Disposition', 'attachment; filename="studymate-data-export.json"');
    res.status(200).json({
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email || null },
      tables, unavailable, truncated,
      notes: 'Includes your profile, progress, saved questions, feedback and payment records. AI prompts and answers are not stored by StudyMate unless you saved them.'
    });
    return;
  }

  // ───────────── DELETE ─────────────
  const body = req.body || {};
  if (body.action !== 'delete') { res.status(400).json({ error: 'Unknown action.' }); return; }

  const retention = process.env.ACCOUNT_DELETION_RETENTION;
  if (retention !== 'delete_all') {
    logger.warn('account_delete_blocked', { reason: retention ? 'retention_not_implemented' : 'retention_not_set' });
    res.status(503).json({ error: 'Account deletion is not available yet. Your data export is available now, and you can contact support to delete your account.', code: 'RETENTION_POLICY_NOT_SET' });
    return;
  }
  if (body.confirm !== 'DELETE') { res.status(400).json({ error: 'Type DELETE to confirm.', code: 'CONFIRM_REQUIRED' }); return; }

  const age = secondsSinceAuth(accessToken, Date.now());
  if (age === null || age > REAUTH_WINDOW_SEC) {
    res.status(403).json({ error: 'For your security, please sign out, sign back in, and try again.', code: 'REAUTH_REQUIRED' });
    return;
  }

  let del;
  try {
    del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: svcHeaders(serviceRoleKey, { 'Content-Type': 'application/json' }) });
  } catch (err) {
    logger.error('account_delete_failed', { reason: 'network' });
    res.status(502).json({ error: 'Could not delete your account right now. Nothing was deleted — please try again.' });
    return;
  }
  if (!del.ok) {
    logger.error('account_delete_failed', { status: del.status });
    res.status(502).json({ error: 'Could not delete your account right now. Nothing was deleted — please try again.' });
    return;
  }
  logger.info('account_deleted', { userHash: crypto.createHash('sha256').update(user.id).digest('hex').slice(0, 12), retention });
  res.status(200).json({ ok: true });
};
module.exports._test = { secondsSinceAuth, EXPORT_TABLES };
