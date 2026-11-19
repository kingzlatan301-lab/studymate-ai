/**
 * StudyMate AI - Learning Journey (client side of supabase-schema-21-learning-journey.sql)
 * ─────────────────────────────────────────────────────────────────────────
 * Remembers HOW a student learns: which tool, teaching method and stage of the learning cycle, and how it went.
 * Also holds the student's own choices ("how I like to learn").
 *
 * LOCAL FIRST. Everything works with no network and with NO schema 21: events and preferences live in this
 * account's localStorage. When the student is signed in and the tables exist, a small queue uploads them in the
 * background. If the tables are missing (schema not applied yet) or the network fails, nothing breaks and nothing blocks.
 *
 * PRIVACY. Only fixed-list values plus subject/topic names are stored. No question text, answers, notes or prompts.
 * Preferences are what the student chose; nothing here is inferred. History is append-only on the server.
 *
 * The allowed values below mirror the CHECK constraints in the schema (a test keeps them identical).
 */
(function (root) {
  'use strict';

  const TOOLS = ['ask', 'teach', 'practice', 'mock', 'flashcards', 'revision', 'notes'];
  const STAGES = ['assess', 'explain', 'demonstrate', 'practise', 'evaluate', 'correct', 'adapt', 'reinforce', 'master'];
  const METHODS = ['simple', 'worked_steps', 'analogy', 'socratic', 'summary', 'retrieval', 'exam_focus', 'cause_effect', 'visual', 'derivation'];
  const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Exam'];
  const OUTCOMES = ['knew', 'shaky', 'lost'];
  const PACES = ['gentle', 'steady', 'fast'];
  const DETAILS = ['short', 'balanced', 'detailed'];

  const HISTORY_CAP = 300;       // recent events kept on the device (also what the "which method worked" insight reads)
  const QUEUE_CAP = 200;         // events waiting to upload; the oldest are dropped first if the cloud is unreachable for long
  const BATCH = 50;
  const FLUSH_DELAY_MS = 1500;
  const MAX_BACKOFF_MS = 5 * 60 * 1000;

  const has = (arr, v) => arr.indexOf(v) >= 0;
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>`{}\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const store = () => { try { return root.localStorage || null; } catch (_) { return null; } };
  const read = (k, d) => { try { const s = store(); const v = s && s.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const write = (k, v) => { try { const s = store(); if (s) s.setItem(k, JSON.stringify(v)); } catch (_) { /* storage full or blocked: the app keeps working */ } };

  const uid = () => { try { return (root.sbAuthSession && root.sbAuthSession.user && root.sbAuthSession.user.id) || null; } catch (_) { return null; } };
  const acct = () => uid() || 'anon';
  const K = n => 'sm_lj_' + n + ':' + acct();
  const cloudReady = () => !!(root.sbClient && uid());

  let unavailable = false;       // set when the server says the tables do not exist (schema 21 not applied); reset on reload
  let failures = 0, nextTryAt = 0, timer = null, flushing = false;

  function newId() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (_) { /* fall through */ }
    return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  /** Returns a clean event or null if it is not worth storing. Unknown values become null, never guesses. */
  function normalise(ev, now) {
    if (!ev || typeof ev !== 'object') return null;
    const subject = clean(ev.subject, 80), topic = clean(ev.topic || 'General', 120) || 'General';
    if (!subject || !has(TOOLS, ev.tool)) return null;
    return {
      client_id: newId(), subject, topic, tool: ev.tool,
      stage: has(STAGES, ev.stage) ? ev.stage : null,
      method: has(METHODS, ev.method) ? ev.method : null,
      difficulty: has(DIFFICULTIES, ev.difficulty) ? ev.difficulty : null,
      outcome: has(OUTCOMES, ev.outcome) ? ev.outcome : null,
      occurred_at: new Date(Number.isFinite(now) ? now : Date.now()).toISOString()
    };
  }

  function record(ev, now) {
    const e = normalise(ev, now);
    if (!e) return null;
    const hist = read(K('events'), []); hist.push(e); write(K('events'), hist.slice(-HISTORY_CAP));
    const q = read(K('queue'), []); q.push(e); write(K('queue'), q.slice(-QUEUE_CAP));
    schedule();
    return e;
  }

  function schedule(delay) {
    if (timer || unavailable || !cloudReady()) return;
    const wait = Math.max(delay == null ? FLUSH_DELAY_MS : delay, nextTryAt - Date.now(), 0);
    timer = setTimeout(() => { timer = null; flush(); }, wait);
    if (timer && timer.unref) timer.unref();
  }

  const isMissingTable = err => !!err && (err.code === '42P01' || err.code === 'PGRST205' || err.status === 404 || /does not exist|schema cache|could not find the table/i.test(String(err.message || '')));

  /** Uploads queued events. Never throws. Returns a short status string (used by tests). */
  async function flush() {
    if (flushing) return 'busy';
    if (unavailable) return 'unavailable';
    if (!cloudReady()) return 'offline';
    const q = read(K('queue'), []);
    if (!q.length) return 'empty';
    flushing = true;
    try {
      const batch = q.slice(0, BATCH);
      const rows = batch.map(e => Object.assign({ user_id: uid() }, e));
      const { error } = await root.sbClient.from('learning_events').upsert(rows, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
      if (error) {
        if (isMissingTable(error)) { unavailable = true; return 'unavailable'; }
        failures++; nextTryAt = Date.now() + Math.min(MAX_BACKOFF_MS, 2000 * Math.pow(2, failures));
        schedule(); return 'retry';
      }
      failures = 0; nextTryAt = 0;
      const sent = new Set(batch.map(e => e.client_id));
      write(K('queue'), read(K('queue'), []).filter(e => !sent.has(e.client_id)));
      if (read(K('queue'), []).length) schedule(0);
      return 'sent';
    } catch (_) {
      failures++; nextTryAt = Date.now() + Math.min(MAX_BACKOFF_MS, 2000 * Math.pow(2, failures));
      schedule(); return 'retry';
    } finally { flushing = false; }
  }

  /** Newest first. */
  function getEvents(limit) {
    const h = read(K('events'), []).slice().sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    return limit ? h.slice(0, limit) : h;
  }

  // ── Preferences (student-stated only) ──────────────────────────────────────
  const emptyPrefs = () => ({ preferred_method: null, pace: null, answer_detail: null });
  function cleanPrefs(p) {
    p = p || {};
    return {
      preferred_method: has(METHODS, p.preferred_method) ? p.preferred_method : null,
      pace: has(PACES, p.pace) ? p.pace : null,
      answer_detail: has(DETAILS, p.answer_detail) ? p.answer_detail : null
    };
  }
  function getPreferences() { return cleanPrefs(read(K('prefs'), emptyPrefs())); }

  async function savePreferences(p) {
    const c = cleanPrefs(p);
    write(K('prefs'), c);
    if (!cloudReady() || unavailable) return { saved: 'local' };
    try {
      const { error } = await root.sbClient.from('learning_preferences').upsert(Object.assign({ user_id: uid() }, c), { onConflict: 'user_id' });
      if (error) { if (isMissingTable(error)) unavailable = true; return { saved: 'local' }; }
      return { saved: 'cloud' };
    } catch (_) { return { saved: 'local' }; }
  }

  /** On sign-in: restore this account's recent events and preferences from the cloud (additive merge; never deletes local data). */
  async function pull() {
    if (!cloudReady() || unavailable) return 'skipped';
    try {
      const ev = await root.sbClient.from('learning_events').select('client_id,subject,topic,tool,stage,method,difficulty,outcome,occurred_at').order('occurred_at', { ascending: false }).limit(HISTORY_CAP);
      if (ev.error) { if (isMissingTable(ev.error)) unavailable = true; return 'skipped'; }
      const have = new Set(read(K('events'), []).map(e => e.client_id));
      const merged = read(K('events'), []).concat((ev.data || []).filter(r => r && r.client_id && !have.has(r.client_id) && normalise(Object.assign({}, r), 0)).map(r => ({
        client_id: String(r.client_id), subject: clean(r.subject, 80), topic: clean(r.topic, 120) || 'General', tool: r.tool,
        stage: has(STAGES, r.stage) ? r.stage : null, method: has(METHODS, r.method) ? r.method : null,
        difficulty: has(DIFFICULTIES, r.difficulty) ? r.difficulty : null, outcome: has(OUTCOMES, r.outcome) ? r.outcome : null, occurred_at: String(r.occurred_at || '')
      })));
      merged.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
      write(K('events'), merged.slice(-HISTORY_CAP));
      const pr = await root.sbClient.from('learning_preferences').select('preferred_method,pace,answer_detail').maybeSingle();
      if (!pr.error && pr.data) write(K('prefs'), cleanPrefs(pr.data));
      schedule();
      return 'pulled';
    } catch (_) { return 'skipped'; }
  }

  /**
   * Which teaching method has actually worked for this student in this subject? Computed from events at read time,
   * never stored as a fact. Needs real evidence: >= 5 outcomes for the method AND a second method with >= 3 outcomes
   * to compare against, and a clear gap (>= 15 percentage points) over the average of the others.
   */
  function bestMethod(subject, events) {
    const list = (events || getEvents()).filter(e => e.subject === subject && e.method && e.outcome);
    const by = {};
    list.forEach(e => { const m = (by[e.method] = by[e.method] || { n: 0, score: 0 }); m.n++; m.score += e.outcome === 'knew' ? 1 : e.outcome === 'shaky' ? 0.5 : 0; });
    const names = Object.keys(by);
    let best = null;
    names.forEach(name => {
      const m = by[name]; if (m.n < 5) return;
      const others = names.filter(o => o !== name && by[o].n >= 3);
      if (!others.length) return;
      const otherN = others.reduce((s, o) => s + by[o].n, 0), otherScore = others.reduce((s, o) => s + by[o].score, 0);
      const gap = (m.score / m.n) - (otherScore / otherN);
      if (gap >= 0.15 && (!best || gap > best.gap)) best = { method: name, gap, n: m.n };
    });
    return best ? best.method : null;
  }

  // Every successful attempt in any tool is also a learning moment. Tool/stage/method are passed by the call sites.
  function wrapProfile() {
    const WP = root.WeaknessProfile;
    if (!WP || WP.__journeyWrapped) return;
    const original = WP.recordAttempt;
    WP.recordAttempt = function (args) {
      const ts = original.apply(this, arguments);
      try {
        if (ts && args && args.tool) {
          record({ subject: args.subject, topic: (WP.canonicalTopic ? WP.canonicalTopic(args.subject, args.topic || 'General') : (args.topic || 'General')), tool: args.tool, stage: args.stage, method: args.method,
            difficulty: args.difficulty, outcome: args.level }, ts);
        }
      } catch (_) { /* never affects the student's attempt */ }
      return ts;
    };
    WP.__journeyWrapped = true;
  }

  function init() {
    wrapProfile();
    try { if (cloudReady()) { pull(); schedule(); } } catch (_) { /* optional */ }
  }

  root.SMJourney = {
    record, flush, pull, init, getEvents, getPreferences, savePreferences, bestMethod, normalise,
    TOOLS, STAGES, METHODS, DIFFICULTIES, OUTCOMES, PACES, DETAILS,
    _reset() { unavailable = false; failures = 0; nextTryAt = 0; if (timer) { clearTimeout(timer); timer = null; } }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SMJourney;
  if (typeof window !== 'undefined') {
    try { wrapProfile(); } catch (_) { /* optional */ }
    // Restore this account's journey on sign-in (and again only for a different account).
    let lastUid = null;
    const onAuth = () => { const u = uid(); if (!u) { lastUid = null; return; } if (u === lastUid) return; lastUid = u; init(); };
    try { document.addEventListener('sb-auth-change', onAuth); if (root.sbAuthReady) onAuth(); } catch (_) { /* optional */ }
  }
})(typeof window !== 'undefined' ? window : globalThis);
