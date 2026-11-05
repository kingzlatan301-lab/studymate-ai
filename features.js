/**
 * StudyMate AI — integrated study features (Formula Book, Calculator, Saved Questions,
 * Exam & Practice History, Performance Analytics, Smart Question Search).
 * ─────────────────────────────────────────────────────────────────────────
 * Loaded AFTER the main inline script, so it can call its globals (state, goScreen,
 * showToast, escapeHtml, WeaknessProfile …). Everything here is additive:
 *   • no existing function is edited; a few are WRAPPED (renderHistory, runSearch) and the
 *     originals are kept and still used for the existing result kinds;
 *   • no colours are defined here — only theme tokens (var(--indigo), var(--navy-card) …) so every
 *     existing theme/preset keeps its own look.
 * Data: sessions are stored per account in localStorage (cache) and in Supabase `study_sessions`
 * (schema 15, append-only, RLS own-rows). Nothing is ever fabricated: empty = empty state.
 */
(function () {
  'use strict';
  const SMF = window.SMF = window.SMF || {};
  const $ = id => document.getElementById(id);
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const attr = s => esc(s).replace(/`/g, '&#96;');
  const toast = m => { try { showToast(m); } catch (_) { } };
  const uid = () => { try { return (state && state.activeUserId) || 'anon'; } catch (_) { return 'anon'; } };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
  const nowIso = () => new Date().toISOString();
  const pct = (c, t) => t ? Math.round(c / t * 100) : 0;
  const clipboard = async text => {
    try { if (typeof copyTextToClipboard === 'function') return await copyTextToClipboard(text); } catch (_) { }
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
  };
  SMF._esc = esc;

  // ════════════════════ SESSION STORE (history + analytics source) ════════════════════
  const SESS_MAX_LOCAL = 300;
  const Sessions = SMF.Sessions = {
    _key() { return 'sm_sessions:' + uid(); },
    _arr() { const v = lsGet(this._key(), []); return Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && typeof x.clientId === 'string' && Array.isArray(x.questions)) : []; },
    list() { return this._arr().slice().sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))); },
    _save(arr) { lsSet(this._key(), arr.slice(-SESS_MAX_LOCAL)); },
    // Validates, de-duplicates by clientId, never overwrites an existing record.
    add(rec) {
      const r = Sessions.normalise(rec);
      if (!r) return null;
      const arr = this._arr();
      if (arr.some(x => x.clientId === r.clientId)) return null;
      arr.push(r); this._save(arr);
      Sessions._push(r);
      return r;
    },
    normalise(rec) {
      if (!rec || !rec.subject || !Array.isArray(rec.questions) || !rec.questions.length) return null;
      const qs = rec.questions.map(q => ({
        q: String(q.q || '').slice(0, 2000), o: Array.isArray(q.o) ? q.o.map(x => String(x).slice(0, 500)).slice(0, 8) : [],
        ci: Number.isInteger(q.ci) ? q.ci : null, si: Number.isInteger(q.si) ? q.si : null,
        topic: q.topic ? String(q.topic).slice(0, 120) : null, ex: q.ex ? String(q.ex).slice(0, 1500) : '',
        ok: q.ok === true ? true : q.ok === false ? false : (Number.isInteger(q.ci) && Number.isInteger(q.si) ? q.ci === q.si : false)
      })).filter(q => q.q);
      if (!qs.length) return null;
      const correct = qs.filter(q => q.ok).length;
      const topics = Array.from(new Set(qs.map(q => q.topic).filter(Boolean))).slice(0, 30);
      return {
        clientId: (typeof rec.clientId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(rec.clientId)) ? rec.clientId : ('ses_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
        type: ['practice', 'mock', 'cbt', 'quiz', 'retry'].includes(rec.type) ? rec.type : 'practice',
        subject: String(rec.subject).slice(0, 80), topics, difficulty: rec.difficulty ? String(rec.difficulty).slice(0, 40) : null,
        style: rec.style ? String(rec.style).slice(0, 80) : null,
        total: qs.length, correct, durationSec: Number.isFinite(rec.durationSec) && rec.durationSec >= 0 ? Math.round(rec.durationSec) : null,
        completedAt: rec.completedAt || nowIso(), questions: qs
      };
    },
    async _push(r) {
      try {
        if (!window.sbClient || !state.activeUserId) return;
        if (SMF._cloudRetryAfter && Date.now() < SMF._cloudRetryAfter) return;   // back-off after a failure (pull() retries later)
        const { error } = await window.sbClient.from('study_sessions').insert({
          user_id: state.activeUserId, client_id: r.clientId, type: r.type, subject: r.subject, topics: r.topics, difficulty: r.difficulty,
          style: r.style, total: r.total, correct: r.correct, duration_sec: r.durationSec, completed_at: r.completedAt, questions: r.questions
        });
        if (error && error.code !== '23505') throw error;
      } catch (e) { SMF._cloudRetryAfter = Date.now() + 60000; console.warn('[StudyMate] session cloud sync skipped:', e && e.message); }
    },
    // Merges cloud rows into the local cache (idempotent by clientId). Local-only records are kept.
    async pull() {
      try {
        if (!window.sbClient || !state.activeUserId) return;
        const me = state.activeUserId;
        const { data, error } = await window.sbClient.from('study_sessions')
          .select('client_id,type,subject,topics,difficulty,style,total,correct,duration_sec,completed_at,questions')
          .eq('user_id', me).order('completed_at', { ascending: false }).limit(300);
        if (error) throw error;
        if (state.activeUserId !== me) return;
        const arr = this._arr();
        const have = new Set(arr.map(x => x.clientId));
        (data || []).forEach(d => {
          if (have.has(d.client_id)) return;
          // Cloud rows pass through the same validation as local ones (never trust stored text blindly).
          const clean = Sessions.normalise({ clientId: d.client_id, type: d.type, subject: d.subject, difficulty: d.difficulty, style: d.style,
            durationSec: d.duration_sec, completedAt: d.completed_at, questions: Array.isArray(d.questions) ? d.questions : [] });
          if (clean && clean.clientId === d.client_id) arr.push(clean);
        });
        this._save(arr);
        // Upload anything recorded while offline / before the table existed (idempotent: unique(user_id, client_id)).
        if (!SMF._cloudRetryAfter || Date.now() >= SMF._cloudRetryAfter) {
          const inCloud = new Set((data || []).map(d => d.client_id));
          const pending = arr.filter(x => !inCloud.has(x.clientId)).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, 25);
          for (const r of pending) { if (SMF._cloudRetryAfter && Date.now() < SMF._cloudRetryAfter) break; await this._push(r); }
        }
      } catch (e) { SMF._cloudRetryAfter = Date.now() + 60000; console.warn('[StudyMate] could not load session history:', e && e.message); }
    }
  };

  // ── Hooks called from the existing practice / mock / CBT / Teach Me code ──
  const styleLabel = () => {
    try {
      if (state.examMode && state.examMode.enabled && state.examMode.board && state.examMode.board !== 'none') {
        const b = EXAM_BOARDS.find(x => x.code === state.examMode.board); return b ? b.label : null;
      }
    } catch (_) { } return null;
  };
  const qShape = (q, si) => ({ q: q.question, o: q.options, ci: q.correctIndex, si: si == null ? null : si, topic: q.topic || null, ex: q.explanation || '' });

  SMF.logPracticeQ = function (sess, q, selected) {
    try { (sess.log = sess.log || []).push(qShape(q, selected)); if (!sess.startedAt) sess.startedAt = Date.now(); } catch (_) { }
  };
  SMF.finishPractice = function (sess) {
    try {
      if (!sess || sess.sessionSaved || !sess.log || !sess.log.length) return;
      sess.sessionSaved = true;
      Sessions.add({ type: 'practice', subject: sess.subject, difficulty: sess.difficulty, style: styleLabel(), questions: sess.log,
        durationSec: sess.startedAt ? (Date.now() - sess.startedAt) / 1000 : null });
    } catch (e) { console.warn('[StudyMate] could not record practice session', e && e.message); }
  };
  SMF.recordMock = function (exam, items) {
    try {
      let dur = null;
      if (exam.timed && Number.isFinite(exam.secondsRemaining) && exam.questions.length) {
        const total = Math.round(exam.questions.length * (typeof MOCK_MINUTES_PER_QUESTION === 'number' ? MOCK_MINUTES_PER_QUESTION : 0) * 60);
        if (total > 0) dur = Math.max(0, total - Math.max(0, exam.secondsRemaining));
      }
      Sessions.add({ type: 'mock', subject: exam.subject, difficulty: exam.difficulty, style: styleLabel(), durationSec: dur,
        questions: items.map(i => ({ ...qShape(i, i.selected), ok: i.selected !== null && i.selected === i.correctIndex })) });
    } catch (e) { console.warn('[StudyMate] could not record mock exam', e && e.message); }
  };
  SMF.recordCbt = function (s) {
    try {
      const qs = [];
      s.subjects.forEach(sub => s.questionsBySubject[sub].forEach((q, i) => qs.push({ ...qShape(q, s.answers[sub][i]), subjectName: sub })));
      // One history record per subject so subject filters and analytics stay accurate.
      s.subjects.forEach(sub => {
        const mine = qs.filter(q => q.subjectName === sub).map(q => ({ ...q, ok: q.si !== null && q.si === q.ci }));
        const total = typeof CBT_TOTAL_MINUTES === 'number' ? CBT_TOTAL_MINUTES * 60 : null;
        Sessions.add({ type: 'cbt', subject: sub, difficulty: 'CBT', style: styleLabel(), questions: mine,
          durationSec: total && Number.isFinite(s.secondsRemaining) ? Math.max(0, total - s.secondsRemaining) : null });
      });
    } catch (e) { console.warn('[StudyMate] could not record CBT session', e && e.message); }
  };
  SMF.recordLesson = function (s) {
    try {
      const qs = (s.lesson.miniTest || []).map((q, i) => ({ q: q.question, o: q.options, ci: q.correctIndex, si: null, topic: s.topic || null, ex: q.explanation || '', ok: !!s.testResults[i] }));
      if (qs.length && qs.every(q => Array.isArray(q.o) && q.o.length)) Sessions.add({ type: 'quiz', subject: s.subject, difficulty: 'Teach Me', questions: qs });
    } catch (e) { console.warn('[StudyMate] could not record lesson quiz', e && e.message); }
  };

  // Shared-device privacy: another account's study data (history, notes, favourites, calculator history/memory) must not linger
  // on this device once a different student signs in. Keys are uid-scoped, so this only removes OTHER accounts' keys.
  SMF.purgeForeignData = function () {
    try {
      const me = state && state.activeUserId; if (!me) return 0; let n = 0;
      const re = /^(sm_sessions|sm_saved_notes|sm_fav_formulas|sm_recent_formulas|sm_calc_hist|sm_calc_mem):(.+)$/;
      for (const k of Object.keys(localStorage)) { const m = re.exec(k); if (m && m[2] !== me) { localStorage.removeItem(k); n++; } }
      localStorage.removeItem('sm_calc_mem');   // legacy un-scoped key from the first build
      return n;
    } catch (_) { return 0; }
  };
  SMF.onAccount = function () { SMF.purgeForeignData(); Sessions.pull(); };
  SMF.onScreen = function (name) {
    try {
      if (name === 'formulas') SMF.openFormulas();
      else if (name === 'calculator') SMF.openCalculator();
      else if (name === 'progress') SMF.onProgress && SMF.onProgress();
      else if (name === 'qrun') { /* rendered by the runner */ }
    } catch (e) { console.error('[StudyMate] screen error', name, e); const el = $('screen-' + name); if (el) el.insertAdjacentHTML('afterbegin', '<div class="sm-err">Something went wrong loading this screen. Please try again.</div>'); }
  };
  SMF.go = function (name) { goScreen(name, null); };
})();
