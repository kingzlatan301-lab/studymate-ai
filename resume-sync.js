/**
 * StudyMate AI - Resume sync (client side of supabase-schema-22-study-resume.sql)
 * ─────────────────────────────────────────────────────────────────────────
 * Lets a Teach Me lesson, a Practice session, a Mock Exam or a CBT exam be continued on another device.
 *
 * LOCAL FIRST. The app already saves each of these in this account's localStorage (that is what "continue where you left
 * off" runs on). This module only COPIES that record to the cloud and brings a newer copy back. If the table is missing
 * (schema 22 not applied), the student is offline, or anything fails, nothing breaks and nothing blocks: the local copy
 * keeps working and the cloud is retried later with a back-off.
 *
 * ONE ROW per (student, kind). The heavy part (`content`: lesson text / question sets) is uploaded only when it changes;
 * the small part (`state`: position, answers, flags, end time) is uploaded on every change. A state-only update is
 * filtered by `content_hash`, so a device that is behind can never mix its position into another device's session.
 * Finishing or discarding writes a tombstone (done = true) so another device drops its old copy instead of reviving it.
 * Last write wins by the student's own timestamp (the database ignores anything older than what it holds).
 *
 * The app (index.html) registers, per kind, where its local record lives and how to split / join it.
 */
(function (root) {
  'use strict';

  const KINDS = ['lesson', 'practice', 'mock', 'cbt'];
  const MAX_AGE_MS = 14 * 24 * 3600 * 1000;               // older saves are ignored (same limit as the local copies)
  const PUSH_DELAY_MS = { lesson: 3000, practice: 6000, mock: 10000, cbt: 15000 };   // trailing debounce; bigger sessions upload less often
  const MAX_CONTENT_CHARS = 380000, MAX_STATE_CHARS = 140000;                        // below the table's CHECK limits (400 KB / 150 KB)
  const PULL_MIN_GAP_MS = 30000;
  const MAX_WAIT_MS = 60000;
  const MAX_BACKOFF_MS = 5 * 60 * 1000;
  const TABLE = 'study_resume';

  const reg = {};                                          // kind -> { key(), split(record) -> {content,state}, join(content,state,savedAt) -> record }
  const timers = {}, firstQueued = {};
  const cloudHash = {};                                    // `${uid}:${kind}` -> hash of the content known to be stored in the cloud
  const listeners = [];
  let unavailable = false, failures = 0, nextTryAt = 0, lastPullAt = 0, pulling = null;

  const store = () => { try { return root.localStorage || null; } catch (_) { return null; } };
  const uid = () => { try { return (root.sbAuthSession && root.sbAuthSession.user && root.sbAuthSession.user.id) || null; } catch (_) { return null; } };
  const online = () => { try { return !(root.navigator && root.navigator.onLine === false); } catch (_) { return true; } };
  const ready = () => !!(root.sbClient && uid() && !unavailable && online());
  const backedOff = () => Date.now() < nextTryAt;

  // Small non-cryptographic fingerprint (FNV-1a). Only used to notice that content changed; never for security.
  function hashOf(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16) + '-' + str.length.toString(16);
  }

  function readJson(key) { try { const s = store(); const v = s && s.getItem(key); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
  function writeJson(key, v) { try { const s = store(); if (s) s.setItem(key, JSON.stringify(v)); return true; } catch (_) { return false; } }
  function removeKey(key) { try { const s = store(); if (s) s.removeItem(key); } catch (_) { /* ignore */ } }

  function localRecord(kind) {
    const d = reg[kind]; if (!d) return null;
    const rec = readJson(d.key());
    return rec && typeof rec === 'object' && Number.isFinite(rec.savedAt) ? rec : null;
  }

  // A finished/discarded session whose tombstone could not be sent yet. Without this, a later pull would bring the finished copy back.
  const tombKey = () => 'sm_resume_tomb:' + (uid() || 'anon');
  const tombs = () => { const t = readJson(tombKey()); return t && typeof t === 'object' ? t : {}; };
  const setTomb = (kind, ts) => { const t = tombs(); if (ts) t[kind] = ts; else delete t[kind]; Object.keys(t).length ? writeJson(tombKey(), t) : removeKey(tombKey()); };

  function handleError(e) {
    const code = e && e.code, msg = String((e && e.message) || '');
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || /study_resume/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg)) {
      if (!unavailable) { unavailable = true; try { console.warn('[StudyMate] resume sync is off: schema 22 is not applied yet (local resume still works)'); } catch (_) { /* ignore */ } }
      return;
    }
    failures++;
    nextTryAt = Date.now() + Math.min(MAX_BACKOFF_MS, 15000 * Math.pow(2, Math.min(failures, 5)));
    try { console.warn('[StudyMate] resume sync skipped:', msg); } catch (_) { /* ignore */ }
  }

  async function pushNow(kind) {
    if (!reg[kind] || !ready() || backedOff()) return false;
    const me = uid();
    const rec = localRecord(kind);
    if (!rec) return false;
    let parts = null; try { parts = reg[kind].split(rec); } catch (_) { parts = null; }
    if (!parts || !parts.content || !parts.state) return false;
    const contentJson = JSON.stringify(parts.content), stateJson = JSON.stringify(parts.state);
    if (contentJson.length > MAX_CONTENT_CHARS || stateJson.length > MAX_STATE_CHARS) return false;   // too big for the cloud: stays on this device only
    const hash = hashOf(contentJson), savedAt = new Date(rec.savedAt).toISOString(), ck = me + ':' + kind;
    try {
      let done = false;
      if (cloudHash[ck] === hash) {
        // Small update: only valid if the stored row still holds exactly this content and is live.
        const r = await root.sbClient.from(TABLE).update({ state: parts.state, saved_at: savedAt }).eq('user_id', me).eq('kind', kind).eq('content_hash', hash).eq('done', false).select('kind');
        if (r.error) throw r.error;
        done = Array.isArray(r.data) && r.data.length > 0;
      }
      if (!done) {
        const r = await root.sbClient.from(TABLE).upsert({ user_id: me, kind, content: parts.content, state: parts.state, content_hash: hash, done: false, saved_at: savedAt }, { onConflict: 'user_id,kind' });
        if (r.error) throw r.error;
        cloudHash[ck] = hash;
      }
      failures = 0;
      return true;
    } catch (e) { handleError(e); return false; }
  }

  function queuePush(kind, delayMs) {
    if (!reg[kind]) return;
    setTomb(kind, 0);                                   // a newer live save replaces any finished/discarded marker still waiting to be sent
    const now = Date.now();
    if (timers[kind]) clearTimeout(timers[kind]); else firstQueued[kind] = now;
    // Trailing debounce, but never later than MAX_WAIT after the first change (constant tapping cannot postpone the upload forever).
    const d = Math.max(0, Math.min(delayMs == null ? (PUSH_DELAY_MS[kind] || 5000) : delayMs, (firstQueued[kind] || now) + MAX_WAIT_MS - now));
    timers[kind] = setTimeout(() => { timers[kind] = null; pushNow(kind); }, d);
  }

  function flush() {
    KINDS.forEach(k => { if (timers[k]) { clearTimeout(timers[k]); timers[k] = null; pushNow(k); } });
    sendTombstones();
  }

  async function sendTombstone(kind) {
    if (!ready() || backedOff()) return false;
    const me = uid(), ts = tombs()[kind] || Date.now();
    try {
      const r = await root.sbClient.from(TABLE).upsert({ user_id: me, kind, content: null, state: null, content_hash: null, done: true, saved_at: new Date(ts).toISOString() }, { onConflict: 'user_id,kind' });
      if (r.error) throw r.error;
      delete cloudHash[me + ':' + kind]; setTomb(kind, 0); failures = 0; return true;
    } catch (e) { handleError(e); return false; }
  }
  function sendTombstones() { Object.keys(tombs()).forEach(k => { if (reg[k]) sendTombstone(k); }); }

  // The session is over (finished or discarded). The local copy is removed by the app; this tells the cloud.
  function clear(kind) {
    if (!reg[kind]) return;
    if (timers[kind]) { clearTimeout(timers[kind]); timers[kind] = null; }
    const u = uid(); if (u) delete cloudHash[u + ':' + kind];
    setTomb(kind, Date.now());
    sendTombstone(kind);
  }

  // Brings newer cloud copies to this device (and uploads local copies the cloud does not have or has older). Resolves to
  // true when this device's local records changed, so the app can refresh its Continue cards.
  function pull(force) {
    if (!ready() || backedOff()) return Promise.resolve(false);
    if (pulling) return pulling;
    if (!force && Date.now() - lastPullAt < PULL_MIN_GAP_MS) return Promise.resolve(false);
    lastPullAt = Date.now();
    const me = uid();
    pulling = (async () => {
      let changed = false;
      try {
        const r = await root.sbClient.from(TABLE).select('kind,content,state,content_hash,done,saved_at').eq('user_id', me);
        if (r.error) throw r.error;
        if (uid() !== me) return false;                               // account switched while waiting
        const rows = Array.isArray(r.data) ? r.data : [];
        const myTombs = tombs();
        for (const kind of KINDS) {
          const d = reg[kind]; if (!d) continue;
          const row = rows.find(x => x && x.kind === kind);
          const local = localRecord(kind);
          if (myTombs[kind]) {                                        // we finished it here and the cloud has not heard yet: never revive it
            if (local && local.savedAt > myTombs[kind]) queuePush(kind, 0);   // ...unless a newer session was started here since (this clears the marker)
            else sendTombstone(kind);
            continue;
          }
          if (!row) { if (local) queuePush(kind, 0); continue; }
          const remoteAt = Date.parse(row.saved_at);
          if (!Number.isFinite(remoteAt)) continue;
          if (row.done) {
            if (local && local.savedAt > remoteAt) queuePush(kind, 0); // we kept going after it was finished elsewhere
            else if (local) { removeKey(d.key()); changed = true; }
            continue;
          }
          if (Date.now() - remoteAt > MAX_AGE_MS) continue;
          if (row.content && typeof row.content === 'object' && row.state && typeof row.state === 'object') {
            if (!local || remoteAt > local.savedAt) {
              let rec = null; try { rec = d.join(row.content, row.state, remoteAt); } catch (_) { rec = null; }
              if (rec && writeJson(d.key(), rec)) { cloudHash[me + ':' + kind] = hashOf(JSON.stringify(row.content)); changed = true; }
            } else if (local.savedAt > remoteAt) queuePush(kind, 0);
            else cloudHash[me + ':' + kind] = hashOf(JSON.stringify(row.content));
          }
        }
        failures = 0;
      } catch (e) { handleError(e); }
      finally { pulling = null; }
      if (changed) listeners.forEach(fn => { try { fn(); } catch (_) { /* a listener never breaks sync */ } });
      return changed;
    })();
    return pulling;
  }

  function register(kind, def) {
    if (KINDS.indexOf(kind) < 0 || !def || typeof def.key !== 'function' || typeof def.split !== 'function' || typeof def.join !== 'function') return false;
    reg[kind] = def; return true;
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  root.SMResume = {
    KINDS, register, queuePush, clear, pull, flush, onChange, hashOf,
    _reset() { unavailable = false; failures = 0; nextTryAt = 0; lastPullAt = 0; pulling = null; Object.keys(timers).forEach(k => { if (timers[k]) clearTimeout(timers[k]); timers[k] = null; }); Object.keys(cloudHash).forEach(k => delete cloudHash[k]); listeners.length = 0; },
    _state() { return { unavailable, failures, nextTryAt }; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SMResume;

  if (typeof window !== 'undefined' && root === window) {
    // Bring this account's saved sessions in on sign-in, when the app comes back to the foreground, and push before it goes away.
    let lastUid = null;
    const onAuth = () => { const u = uid(); if (!u) { lastUid = null; return; } if (u === lastUid) return; lastUid = u; pull(true); };
    try {
      document.addEventListener('sb-auth-change', onAuth); if (root.sbAuthReady) onAuth();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else pull(false); });
      root.addEventListener('pagehide', flush);
      root.addEventListener('online', () => { nextTryAt = 0; pull(true); flush(); });
    } catch (_) { /* optional */ }
  }
})(typeof window !== 'undefined' ? window : globalThis);
