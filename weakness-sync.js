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
 * NOT YET BUILT: reading FROM the cloud (e.g. pulling progress down on a
 * new device) and multi-device merge/conflict resolution. Right now this is
 * one-directional (device → cloud) and the local device is still what's
 * actually displayed. That's the next real piece of work, not this one.
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
