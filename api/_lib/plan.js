/**
 * StudyMate AI — shared server-side identity & plan helpers
 * ─────────────────────────────────────────────────────────────────────────
 * Used by api/ask.js and api/analyze-paper.js so both endpoints verify
 * "who is calling" and "are they Premium" the exact same way, instead of
 * each reimplementing it slightly differently.
 *
 * TRUST MODEL (read this before changing anything here):
 * - The caller's identity comes ONLY from a Supabase access token sent as
 *   "Authorization: Bearer <token>", verified against Supabase's own
 *   /auth/v1/user endpoint. A client can send any "user_id" or "plan"
 *   field it likes in the request body — those are NEVER read for
 *   authorization anywhere in this file.
 * - Premium status comes ONLY from a live read of the `subscriptions`
 *   table, scoped by Postgres Row Level Security to the caller's own
 *   token (the anon/publishable key here grants nothing by itself — it's
 *   RLS, keyed off the verified token, that limits the row to the caller's
 *   own account). This mirrors the same query index.html already runs
 *   client-side in refreshPremiumStatus() — this is just the
 *   tamper-proof, server-side version of that same check.
 * - Every function here fails CLOSED: any network error, malformed
 *   response, or missing row is treated as "not Premium" / "not
 *   authenticated", never the reverse.
 *
 * This file intentionally never touches SUPABASE_SERVICE_ROLE_KEY — that
 * key bypasses RLS and has no business here; see the notes in
 * api/verify-payment.js for where it actually belongs.
 */

const SUPABASE_URL = 'https://xlbnvmkcooueucuayrvy.supabase.co';
// Publishable/anon key — safe to embed server-side too (same key already
// shipped in supabase-client.js). It only ever grants what RLS allows.
const SUPABASE_ANON_KEY = 'sb_publishable_QHKfnwzCQUW23sNWL2YUPg_H2-oxJ3g';

/**
 * Verifies a Supabase access token and returns the authenticated user, or
 * null if the token is missing/invalid/expired.
 */
async function getAuthedUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch (err) {
    console.error('[plan] getAuthedUser error', err && err.message);
    return null;
  }
}

/**
 * True only if the caller's own subscriptions row is active and unexpired.
 * Uses the caller's own token (RLS-scoped) — never the service_role key.
 */
async function isPremium(accessToken, userId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,current_period_end&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return false; // fail closed — never grant Premium on an error
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return !!(row && row.status === 'active' && new Date(row.current_period_end) > new Date());
  } catch (err) {
    console.error('[plan] isPremium error', err && err.message);
    return false; // fail closed
  }
}

/**
 * Period key for a usage window. ALWAYS computed from UTC so the server, every
 * device, and index.html's getPeriodKey() agree for the same instant:
 *   daily  → 'YYYY-MM-DD' (UTC date) — a new UTC day is a brand-new counter row,
 *            so a question asked several days ago can never count against today.
 *   weekly → 'YYYY-Www' (ISO week, UTC).
 */
function periodKeyFor(period, now = new Date()) {
  if (period === 'daily') return now.toISOString().slice(0, 10);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

async function rpc(accessToken, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${fn} RPC failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * USAGE ACCOUNTING — reserve → (commit | release).
 * See supabase-schema-07-*.sql for the database side.
 *
 *   reserveUsage()  atomically takes ONE slot (row-locked in Postgres, so
 *                   concurrent requests cannot both take the last slot).
 *   commitUsage()   call after the AI provider answered successfully.
 *   releaseUsage()  call if the provider failed/timed out/returned junk, so
 *                   the student does not lose a question.
 *
 * Reservations also expire on their own after 2 minutes, so a crashed
 * invocation cannot hold a slot forever.
 *
 * reserveUsage/getUsage throw on infrastructure failure (callers answer
 * "try again"; they never silently allow the request through).
 */
async function reserveUsage(accessToken, feature, periodKey, max) {
  const d = await rpc(accessToken, 'reserve_usage', { p_feature: feature, p_period_key: periodKey, p_max: max });
  return {
    allowed: !!(d && d.allowed),
    used: (d && d.used) || 0,
    committed: (d && d.committed) || 0,
    reservationId: (d && d.reservation_id) || null
  };
}

/**
 * Run-aware reservation (supabase-schema-09). Same lifecycle as reserveUsage,
 * plus an optional client-generated run id so multi-call features (Mock Exam)
 * cost ONE slot. The database — not the client — decides whether a run id is
 * honoured (see reserve_usage_run). `reason` is one of
 * 'limit_reached' | 'run_calls_exceeded' | 'run_in_flight' when not allowed.
 */
async function reserveUsageRun(accessToken, feature, periodKey, max, runId, maxCalls) {
  const d = await rpc(accessToken, 'reserve_usage_run', {
    p_feature: feature, p_period_key: periodKey, p_max: max,
    p_run_id: runId || null, p_max_calls: maxCalls || 1
  });
  return {
    allowed: !!(d && d.allowed),
    reused: !!(d && d.reused),
    reason: (d && d.reason) || null,
    used: (d && d.used) || 0,
    committed: (d && d.committed) || 0,
    reservationId: (d && d.reservation_id) || null
  };
}

/** One round-trip: usage for several (feature, periodKey) pairs + lifetime askAI total. */
async function getUsageSnapshot(accessToken, items) {
  const d = await rpc(accessToken, 'get_usage_snapshot', {
    p_items: items.map(i => ({ feature: i.feature, period_key: i.periodKey }))
  });
  return d || {};
}

async function commitUsage(accessToken, reservationId) {
  const d = await rpc(accessToken, 'commit_usage', { p_reservation_id: reservationId });
  return { ok: !!(d && d.ok), committed: (d && d.committed) || 0, total: Number((d && d.total) || 0) };
}

async function releaseUsage(accessToken, reservationId) {
  try {
    await rpc(accessToken, 'release_usage', { p_reservation_id: reservationId });
  } catch (err) {
    // Not fatal: the reservation expires by itself within 2 minutes.
    console.error('[plan] releaseUsage failed (will auto-expire):', err && err.message);
  }
}

async function getUsage(accessToken, feature, periodKey) {
  const d = await rpc(accessToken, 'get_usage', { p_feature: feature, p_period_key: periodKey });
  return { used: (d && d.used) || 0, committed: (d && d.committed) || 0, total: Number((d && d.total) || 0) };
}

/**
 * @deprecated Superseded by reserveUsage/commitUsage/releaseUsage — it
 * incremented BEFORE the provider answered, so provider failures consumed a
 * question. Kept only so older code paths/rollbacks still load.
 */
async function checkAndIncrementUsage(accessToken, feature, periodKey, max) {
  const data = await rpc(accessToken, 'check_and_increment_usage', { p_feature: feature, p_period_key: periodKey, p_max: max });
  return { allowed: !!(data && data.allowed), count: (data && data.count) || 0 };
}

module.exports = {
  getAuthedUser, isPremium, periodKeyFor,
  reserveUsage, reserveUsageRun, commitUsage, releaseUsage, getUsage, getUsageSnapshot,
  checkAndIncrementUsage,
  SUPABASE_URL, SUPABASE_ANON_KEY
};
