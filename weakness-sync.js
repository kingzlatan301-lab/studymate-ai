/**
 * StudyMate AI — Weakness Profile cloud sync
 * ─────────────────────────────────────────────────────────────────────────
 * Deliberately kept as its own file rather than folded into
 * weakness-profile.js, so that module stays a pure, Supabase-unaware local
 * data store (easier to reason about, easier to test, no hard dependency on
 * an external service for something that must keep working offline).
 *
 * HOW THIS WORKS: local storage stays the source of truth the rest of the
 * app reads from — every existing WeaknessProfile.getTopics() /
 * getSubjectSummary() / getInsights() call keeps working exactly as before,
 * synchronously, with zero changes elsewhere in the app. This file wraps
 * WeaknessProfile.recordAttempt() and .tagMistake() so that, in addition to
 * their normal local write, they ALSO fire a best-effort background write
 * to Supabase when the student is signed in. If that background write
 * fails (offline, RLS issue, whatever), the local write already succeeded —
 * nothing about using the app breaks or blocks on network.
 *
 * CLOUD → DEVICE (new): on sign-in, pull() loads the account's attempts from
 * weakness_profiles and merges them into this account's local cache, then
 * pushes any local-only attempts up (idempotent upsert). AUTHORITY: the cloud
 * table is the source of truth for the signed-in account; the local cache is
 * per-account (see weakness-profile.js) so there is exactly one logical
 * profile per student, not two competing ones. Merge rule: an attempt is
 * identified by (subject, topic, client_ts); duplicates never double-count;
 * a mistake tag present on either side is kept.
 */

(function () {
  if (!window.WeaknessProfile) {
    console.error('[StudyMate] weakness-sync.js loaded before weakness-profile.js — cloud sync disabled.');
    return;
  }

  const TABLE = 'weakness_profiles';
  const originalRecordAttempt = WeaknessProfile.recordAttempt;
  const originalTagMistake = WeaknessProfile.tagMistake;

  function cloudReady() {
    return !!(window.sbClient && window.sbAuthSession);
  }

  async function syncAttemptToCloud({ subject, topic, level, difficulty, mistakeType, ts }) {
    if (!cloudReady()) return;
    const { error } = await window.sbClient.from(TABLE).upsert({
      user_id: window.sbAuthSession.user.id,
      subject,
      topic: topic || 'General',
      level,
      difficulty: difficulty || null,
      mistake_type: mistakeType || null,
      client_ts: ts
    }, { onConflict: 'user_id,subject,topic,client_ts', ignoreDuplicates: true });
    if (error) console.error('[StudyMate] cloud sync (attempt) failed — local data is unaffected:', error.message);
  }

  async function syncMistakeTagToCloud({ subject, topic, ts, mistakeType }) {
    if (!cloudReady()) return;
    const { error } = await window.sbClient.from(TABLE)
      .update({ mistake_type: mistakeType })
      .eq('user_id', window.sbAuthSession.user.id)
      .eq('subject', subject)
      .eq('topic', topic || 'General')
      .eq('client_ts', ts);
    // A "no rows matched" case here (e.g. the original insert hadn't synced
    // yet) fails silently by design — the local tag already succeeded, and
    // there's no local queue yet to retry cloud writes. Known limitation.
    if (error) console.error('[StudyMate] cloud sync (mistake tag) failed — local data is unaffected:', error.message);
  }

  WeaknessProfile.recordAttempt = function (args) {
    const ts = originalRecordAttempt(args);
    if (ts) syncAttemptToCloud({ ...args, ts }); // fire-and-forget; never blocks the caller
    return ts;
  };

  WeaknessProfile.tagMistake = function (args) {
    const ok = originalTagMistake(args);
    if (ok) syncMistakeTagToCloud(args);
    return ok;
  };

  // ── PULL (cloud → this device) + PUSH of local-only attempts ──
  const PULL_LIMIT = 2000;          // newest attempts; each topic keeps its latest 50 locally anyway
  let syncing = null;
  const keyOf = a => a.subject + '\u0001' + (a.topic || 'General') + '\u0001' + a.ts;

  async function pull() {
    if (!cloudReady()) return { ok: false, reason: 'Not signed in.' };
    const uid = window.sbAuthSession.user.id;
    const { data, error } = await window.sbClient.from(TABLE)
      .select('subject, topic, level, difficulty, mistake_type, client_ts')
      .eq('user_id', uid)
      .not('client_ts', 'is', null)
      .order('client_ts', { ascending: false })
      .limit(PULL_LIMIT);
    if (error) return { ok: false, reason: error.message };
    if (window.sbAuthSession.user.id !== uid) return { ok: false, reason: 'Account changed.' };
    const rows = (data || []).map(r => ({
      subject: r.subject, topic: r.topic, level: r.level, difficulty: r.difficulty,
      mistakeType: r.mistake_type, ts: Number(r.client_ts)
    }));
    const added = WeaknessProfile.importAttempts(rows);

    // Push attempts that exist only locally (e.g. recorded offline, or adopted
    // from before accounts were scoped). Only the difference is sent.
    const cloudKeys = new Set(rows.map(keyOf));
    const missing = WeaknessProfile.getAllAttempts().filter(a => !cloudKeys.has(keyOf(a)));
    let pushed = 0;
    if (missing.length) {
      const up = missing.map(a => ({
        user_id: uid, subject: a.subject, topic: a.topic || 'General', level: a.level,
        difficulty: a.difficulty || null, mistake_type: a.mistakeType || null, client_ts: a.ts
      }));
      for (let i = 0; i < up.length; i += 200) {
        const { error: e2 } = await window.sbClient.from(TABLE)
          .upsert(up.slice(i, i + 200), { onConflict: 'user_id,subject,topic,client_ts', ignoreDuplicates: true });
        if (e2) { console.error('[StudyMate] weakness push failed:', e2.message); break; }
        pushed += Math.min(200, up.length - i);
      }
    }
    return { ok: true, added, pushed };
  }

  // Lifetime numbers computed by the database from ALL of the account's rows.
  async function getLifetimeStats() {
    if (!cloudReady()) return null;
    const { data, error } = await window.sbClient.rpc('get_lifetime_stats');
    if (error) { console.error('[StudyMate] lifetime stats failed:', error.message); return null; }
    return data || null;
  }

  // Clears this account's progress everywhere (cloud rows + local cache) so a
  // reset on one device is not undone by the next pull on another.
  async function resetEverywhere() {
    if (cloudReady()) {
      const { error } = await window.sbClient.from(TABLE).delete().eq('user_id', window.sbAuthSession.user.id);
      if (error) return { ok: false, reason: error.message };
    }
    WeaknessProfile.reset();
    return { ok: true };
  }

  let lastUid = null, lastPullAt = 0;
  function syncForSession() {
    const uid = window.sbAuthSession && window.sbAuthSession.user && window.sbAuthSession.user.id;
    WeaknessProfile.setAccount(uid || null);
    if (!uid) { lastUid = null; return; }
    // Token refreshes re-fire sb-auth-change; only re-pull for a different
    // account or if the last pull is older than 10 minutes.
    if (syncing || (uid === lastUid && Date.now() - lastPullAt < 10 * 60 * 1000)) return;
    lastUid = uid; lastPullAt = Date.now();
    syncing = pull().then(r => {
      if (!r.ok) console.error('[StudyMate] weakness pull failed:', r.reason);
      document.dispatchEvent(new CustomEvent('weakness-synced', { detail: r }));
    }).finally(() => { syncing = null; });
  }
  window.WeaknessSync = { pull, getLifetimeStats, resetEverywhere, syncForSession };
  document.addEventListener('sb-auth-change', syncForSession);
  if (window.sbAuthReady) syncForSession();

  // One-time backfill of whatever's already stored locally, triggered
  // manually from the Account screen (not automatic — moving a student's
  // existing data anywhere is worth an explicit action, not a surprise
  // background write the moment they sign in). Safe to run more than once:
  // the dedupe constraint on the table makes repeat uploads a no-op for
  // attempts already there.
  window.migrateLocalWeaknessDataToCloud = async function () {
    if (!cloudReady()) return { ok: false, reason: 'Not signed in.' };
    const attempts = WeaknessProfile.getAllAttempts();
    if (!attempts.length) return { ok: true, count: 0 };

    const uid = window.sbAuthSession.user.id;
    const rows = attempts.map(a => ({
      user_id: uid,
      subject: a.subject,
      topic: a.topic || 'General',
      level: a.level,
      difficulty: a.difficulty || null,
      mistake_type: a.mistakeType || null,
      client_ts: a.ts
    }));

    const CHUNK = 200; // keep each request small regardless of local history size
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await window.sbClient.from(TABLE)
        .upsert(chunk, { onConflict: 'user_id,subject,topic,client_ts', ignoreDuplicates: true });
      if (error) return { ok: false, reason: error.message, count: i };
    }
    return { ok: true, count: rows.length };
  };
})();
