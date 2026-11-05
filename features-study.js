/** StudyMate AI — Saved Questions, Practice runner, History, Analytics, Smart Search (see features.js header). */
(function () {
  'use strict';
  const SMF = window.SMF = window.SMF || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => { try { return state.activeUserId || 'anon'; } catch (_) { return 'anon'; } };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } };
  const toast = m => { try { showToast(m); } catch (_) { } };
  const pct = (c, t) => t ? Math.round(c / t * 100) : 0;
  const Sess = () => SMF.Sessions;
  const TYPE_LABEL = { practice: 'Practice', mock: 'Mock exam', cbt: 'CBT simulation', quiz: 'Lesson quiz', retry: 'Retry' };
  const TYPE_ICON = { practice: '🎯', mock: '⏱️', cbt: '🖥️', quiz: '🎓', retry: '🔁' };
  const MIN_TOPIC_Q = 5;   // below this a topic is "not enough data", never "weak"/"strong"
  const WEAK_BELOW = 50, STRONG_FROM = 75;
  const AI_SOURCE = 'AI-generated practice question';

  // Inline handlers: HTML-escaping is NOT enough inside onclick='…' (the browser decodes &#39; back to ' before JS runs).
  // Every value placed in a handler argument must pass through jid() (strict charset) — or be an index.
  const jid = v => String(v == null ? '' : v).replace(/[^A-Za-z0-9_:.\-]/g, '');
  const qKey = (subject, q) => String(subject || '').toLowerCase() + '|' + String(q || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };
  const fmtDur = s => s == null ? '' : s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.round(s % 3600 / 60) + 'm' : s >= 60 ? Math.floor(s / 60) + 'm ' + (Math.round(s % 60)) + 's' : Math.round(s) + 's';
  const rc = p => p >= 70 ? 'var(--sm-ok)' : p >= 40 ? 'var(--sm-warn)' : 'var(--sm-bad)';

  // ═══════════════════════════ SAVED QUESTIONS ═══════════════════════════
  const notesKey = () => 'sm_saved_notes:' + uid();
  const notesObj = () => { const v = lsGet(notesKey(), {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  const getNote = id => { const n = notesObj()[id]; return typeof n === 'string' ? n : ''; };
  const SQ = { q: '', subject: 'All', topic: 'All', kind: 'All' };

  const isMcq = h => h && h.kind === 'mcq' && Array.isArray(h.options);
  const savedKeys = () => new Set((state.history || []).map(h => qKey(h.subject, h.question)));
  SMF.isSaved = (subject, q) => savedKeys().has(qKey(subject, q));

  SMF.saveMcq = async function (item, btn) {
    if (!window.sbClient || !state.activeUserId) { toast('Sign in to save questions'); return false; }
    if (!item || !item.q || !Array.isArray(item.o) || !Number.isInteger(item.ci)) { toast('This question can’t be saved'); return false; }
    if (SMF.isSaved(item.subject, item.q)) { toast('Already saved'); if (btn) { btn.textContent = '🔖 Saved'; btn.classList.add('on'); } return true; }
    const payload = { kind: 'mcq', options: item.o, correctIndex: item.ci, explanation: item.ex || '', topic: item.topic || null, source: item.source || 'practice', sourceLabel: AI_SOURCE, style: item.style || null, savedAt: new Date().toISOString() };
    try {
      const { data, error } = await window.sbClient.from('saved_questions').insert({ user_id: state.activeUserId, question: item.q, subject: item.subject, answer_data: payload })
        .select('id, question, subject, answer_data, created_at').single();
      if (error) { if (error.code === '23505') { await loadSavedQuestions(); } else throw error; }
      else state.history.unshift(savedRowToHistoryItem(data));
      if (btn) { btn.textContent = '🔖 Saved'; btn.classList.add('on'); }
      toast('Saved to your question library'); try { updateProfile(); } catch (_) { }
      return true;
    } catch (e) { console.error('[StudyMate] save question failed', e && e.message); toast('Couldn’t save — check your connection and try again.'); return false; }
  };
  SMF.removeSaved = async function (id) {
    const h = (state.history || []).find(x => String(x.id) === String(id)); if (!h) return;
    if (!confirm('Remove this question from your saved list?')) return;
    try {
      const { error } = await window.sbClient.from('saved_questions').delete().eq('id', id).eq('user_id', state.activeUserId);
      if (error) throw error;
      state.history = state.history.filter(x => String(x.id) !== String(id));
      const n = notesObj(); delete n[id]; lsSet(notesKey(), n);
      closeSheet(); toast('Removed'); renderSaved(); try { updateProfile(); } catch (_) { }
    } catch (e) { toast('Couldn’t remove it — try again.'); }
  };
  SMF.saveNote = async function (id) {
    const ta = $('sq-note'); if (!ta) return; const note = ta.value.slice(0, 1000);
    const n = notesObj(); if (note.trim()) n[id] = note; else delete n[id]; lsSet(notesKey(), n);   // always keep a device copy
    let cloud = false;
    try { const { error } = await window.sbClient.from('saved_questions').update({ note: note.trim() ? note : null }).eq('id', id).eq('user_id', state.activeUserId); cloud = !error; } catch (_) { }
    toast(cloud ? 'Note saved' : 'Note saved on this device'); renderSaved();
  };
  SMF.pullNotes = async function () {   // optional: only works after schema 15 adds the `note` column
    try {
      if (!window.sbClient || !state.activeUserId) return;
      const { data, error } = await window.sbClient.from('saved_questions').select('id, note').eq('user_id', state.activeUserId).not('note', 'is', null).limit(300);
      if (error || !data) return; const n = notesObj(); data.forEach(r => { if (r.note) n[r.id] = r.note; }); lsSet(notesKey(), n);
    } catch (_) { }
  };

  // ── bottom sheet (used for saved-question detail and session detail) ──
  function openSheet(html) {
    closeSheet();
    const d = document.createElement('div'); d.id = 'sm-sheet'; d.className = 'sm-sheet';
    d.innerHTML = `<div class="sm-sheet-bg" onclick="SMF.closeSheet()"></div><div class="sm-sheet-box" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(d); document.body.classList.add('sm-noscroll');
  }
  function closeSheet() { const d = $('sm-sheet'); if (d) d.remove(); document.body.classList.remove('sm-noscroll'); }
  SMF.closeSheet = closeSheet;

  const mcqToItem = h => ({ q: h.question, o: h.options, ci: h.correctIndex, topic: h.topic, ex: h.explanation, subject: h.subject, source: h.source });

  function savedFiltered() {
    const q = norm(SQ.q);
    return (state.history || []).filter(h => {
      if (SQ.subject !== 'All' && h.subject !== SQ.subject) return false;
      if (SQ.kind === 'mcq' && !isMcq(h)) return false;
      if (SQ.kind === 'ai' && isMcq(h)) return false;
      if (SQ.topic !== 'All' && (h.topic || '') !== SQ.topic) return false;
      if (state.filter && state.filter !== 'All' && h.subject !== state.filter) return false;   // existing subject tabs still work
      if (q) { const hay = norm([h.question, h.subject, h.topic, getNote(h.id), (h.options || []).join(' '), h.answer].join(' ')); if (!q.split(/\s+/).every(t => hay.includes(t))) return false; }
      return true;
    });
  }
  function renderSaved() {
    const list = $('history-list'); if (!list) return;
    ensureSavedToolbar();
    const all = state.history || [];
    const items = savedFiltered();
    const topics = Array.from(new Set(all.map(h => h.topic).filter(Boolean))).sort();
    const tsel = $('sq-topic'); if (tsel) { const cur = SQ.topic; tsel.innerHTML = '<option value="All">All topics</option>' + topics.map(t => `<option ${t === cur ? 'selected' : ''} value="${esc(t)}">${esc(t)}</option>`).join(''); }
    const mcqs = items.filter(isMcq);
    const pr = $('sq-practise'); if (pr) { pr.style.display = mcqs.length ? '' : 'none'; pr.textContent = `🎯 Practise these (${mcqs.length})`; }
    if (!items.length) {
      list.innerHTML = `<div class="history-empty"><div class="history-empty-icon">🔖</div><div class="history-empty-text">${all.length === 0 ? 'No saved questions yet.<br>Save a practice question or an AI answer and it will appear here.' : 'No saved questions match your search or filters.'}</div></div>`;
      return;
    }
    list.innerHTML = items.map(h => {
      const note = getNote(h.id);
      return `<div class="history-item" onclick="SMF.openSaved('${jid(h.id)}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')SMF.openSaved('${jid(h.id)}')">
        <div class="history-meta"><span class="history-subject">${esc(h.subject)}${h.topic ? ' · ' + esc(h.topic) : ''}</span><span class="history-time">${isMcq(h) ? 'Practice question' : 'AI answer'} · ${esc(typeof formatTime === 'function' ? formatTime(h.time) : fmtDate(h.time))}</span></div>
        <div class="history-q">${esc(h.question.length > 110 ? h.question.slice(0, 110) + '…' : h.question)}</div>
        ${isMcq(h) ? `<div class="history-answer-preview">Answer: ${esc(h.options[h.correctIndex] || '')}</div>` : `<div class="history-answer-preview">Answer: ${esc(h.answer || '')}</div>`}
        ${note ? `<div class="sq-notechip">📝 ${esc(note.length > 70 ? note.slice(0, 70) + '…' : note)}</div>` : ''}</div>`;
    }).join('');
  }
  function ensureSavedToolbar() {
    if ($('sq-toolbar')) return;
    const tabs = $('filter-tabs'); if (!tabs) return;
    const d = document.createElement('div'); d.id = 'sq-toolbar'; d.className = 'sq-toolbar';
    d.innerHTML = `<div class="sm-search"><input id="sq-q" type="search" placeholder="Search saved questions and notes…" aria-label="Search saved questions" oninput="SMF.sqQuery(this.value)"></div>
      <div class="sq-row"><select id="sq-kind" aria-label="Type" onchange="SMF.sqKind(this.value)"><option value="All">All types</option><option value="mcq">Practice questions</option><option value="ai">AI answers</option></select>
      <select id="sq-topic" aria-label="Topic" onchange="SMF.sqTopic(this.value)"><option value="All">All topics</option></select></div>
      <button id="sq-practise" class="sm-btn primary block" onclick="SMF.sqPractise()" style="display:none"></button>`;
    tabs.parentNode.insertBefore(d, tabs);
  }
  let sqTimer; SMF.sqQuery = v => { SQ.q = v; clearTimeout(sqTimer); sqTimer = setTimeout(renderSaved, 120); };
  SMF.sqKind = v => { SQ.kind = v; renderSaved(); }; SMF.sqTopic = v => { SQ.topic = v; renderSaved(); };
  SMF.sqPractise = function () { const items = savedFiltered().filter(isMcq).map(mcqToItem); if (!items.length) return; SMF.runQuestions(items, 'Saved questions', { from: 'saved' }); };
  SMF.openSaved = function (id) {
    const h = (state.history || []).find(x => String(x.id) === String(id)); if (!h) return;
    if (!isMcq(h)) { if (typeof viewHistory === 'function') viewHistory(id); return; }   // existing AI-answer viewer, untouched
    const note = getNote(h.id);
    openSheet(`<div class="sh-head"><b>${esc(h.subject)}${h.topic ? ' · ' + esc(h.topic) : ''}</b><button class="sm-link" onclick="SMF.closeSheet()" aria-label="Close">✕</button></div>
      <div class="sh-src">${esc(h.sourceLabel || AI_SOURCE)} · saved ${esc(fmtDate(h.time))}</div>
      <p class="sh-q">${esc(h.question)}</p>
      ${h.options.map((o, i) => `<div class="sh-opt${i === h.correctIndex ? ' ok' : ''}"><span>${String.fromCharCode(65 + i)}</span>${esc(o)}${i === h.correctIndex ? ' <em>✓ correct</em>' : ''}</div>`).join('')}
      ${h.explanation ? `<div class="sh-ex"><b>Explanation</b><br>${esc(h.explanation)}</div>` : ''}
      <label class="sh-nl" for="sq-note">My note</label><textarea id="sq-note" rows="3" maxlength="1000" placeholder="Add a reminder or the trick you learned…">${esc(note)}</textarea>
      <div class="sh-btns"><button class="sm-btn" onclick="SMF.saveNote('${jid(h.id)}')">Save note</button><button class="sm-btn primary" onclick="SMF.closeSheet();SMF.runQuestions([SMF._saved('${jid(h.id)}')],'Saved question',{from:'saved'})">🎯 Practise again</button><button class="sm-btn danger" onclick="SMF.removeSaved('${jid(h.id)}')">Remove</button></div>`);
  };
  SMF._saved = id => { const h = state.history.find(x => String(x.id) === String(id)); return h ? mcqToItem(h) : null; };

  // Wrap (not replace) the existing renderHistory so every existing caller keeps working.
  const origRenderHistory = window.renderHistory;
  window.renderHistory = function () { try { renderSaved(); } catch (e) { console.error(e); if (origRenderHistory) origRenderHistory(); } };
  SMF.renderSaved = renderSaved;

  // Save buttons placed in the practice flow and after a mock exam.
  SMF.afterPracticeAnswer = function (q, session) {
    try {
      const area = $('practice-result-area'); if (!area || area.querySelector('.sm-savebtn')) return;
      const item = { q: q.question, o: q.options, ci: q.correctIndex, topic: q.topic, ex: q.explanation, subject: session.subject, source: 'practice', style: null };
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sm-btn sm-savebtn block';
      const saved = SMF.isSaved(item.subject, item.q); b.textContent = saved ? '🔖 Saved' : '🔖 Save question'; if (saved) b.classList.add('on');
      b.onclick = () => SMF.saveMcq(item, b);
      const next = area.querySelector('.ask-btn'); area.insertBefore(b, next || null);
    } catch (e) { console.warn(e); }
  };
  SMF.afterMock = function (items, subject) {
    try {
      const el = $('mockexam-content'); if (!el) return;
      const missed = items.filter(i => !i.correct);
      const wrap = document.createElement('div'); wrap.className = 'sm-after';
      wrap.innerHTML = `<button class="sm-btn block" id="mk-save" ${missed.length ? '' : 'disabled'}>🔖 Save ${missed.length ? missed.length + ' missed question' + (missed.length === 1 ? '' : 's') : 'missed questions (none missed)'}</button><button class="sm-btn block" onclick="SMF.openHistory()">📋 See this in your history</button>`;
      el.appendChild(wrap);
      const b = $('mk-save'); if (b) b.onclick = async () => { b.disabled = true; let n = 0; for (const i of missed) { if (await SMF.saveMcq({ q: i.question, o: i.options, ci: i.correctIndex, topic: i.topic, ex: i.explanation, subject, source: 'mock' })) n++; } b.textContent = '🔖 Saved ' + n; };
    } catch (e) { console.warn(e); }
  };

  // ═══════════════════════════ PRACTICE RUNNER (saved / history / search / weak topics) ═══════════════════════════
  const RUN = { items: [], i: 0, results: [], title: '', ctx: {}, started: 0, sel: null, done: false };
  SMF.runQuestions = function (items, title, ctx) {
    items = (items || []).filter(x => x && x.q && Array.isArray(x.o) && x.o.length > 1 && Number.isInteger(x.ci));
    if (!items.length) { toast('No practisable questions here'); return; }
    Object.assign(RUN, { items, i: 0, results: [], title: title || 'Practice', ctx: ctx || {}, started: Date.now(), sel: null, done: false });
    closeSheet(); goScreen('qrun', null); renderRun();
  };
  function renderRun() {
    const el = $('qrun-content'); if (!el) return;
    if (RUN.done) return renderRunSummary(el);
    const it = RUN.items[RUN.i];
    el.innerHTML = `<button class="sm-back" onclick="SMF.runExit()">‹ Exit</button>
      <div class="sess-bar"><span class="pill on">${esc(RUN.title)}</span><span class="pill">${RUN.i + 1} / ${RUN.items.length}</span></div>
      <div class="answer-card"><div class="sh-src">${esc(it.subject || '')}${it.topic ? ' · ' + esc(it.topic) : ''} · ${AI_SOURCE}</div>
        <div class="final-answer-value" style="font-size:15px;line-height:1.5;margin:6px 0 14px">${esc(it.q)}</div>
        <div id="qr-opts">${it.o.map((o, i) => `<div class="option-item" id="qr-o${i}" onclick="SMF.runPick(${i})" role="button" tabindex="0"><div class="toggle-label">${esc(o)}</div></div>`).join('')}</div>
        <button class="ask-btn" id="qr-submit" style="margin-top:14px;opacity:.5;pointer-events:none" onclick="SMF.runSubmit()">Submit Answer</button>
        <div id="qr-result"></div></div>`;
  }
  SMF.runPick = function (i) { if (RUN.results[RUN.i]) return; RUN.sel = i; document.querySelectorAll('#qr-opts .option-item').forEach((e, k) => e.classList.toggle('selected', k === i)); const b = $('qr-submit'); b.style.opacity = '1'; b.style.pointerEvents = 'auto'; };
  SMF.runSubmit = function () {
    if (RUN.sel == null || RUN.results[RUN.i]) return;
    const it = RUN.items[RUN.i], ok = RUN.sel === it.ci; RUN.results[RUN.i] = { sel: RUN.sel, ok };
    document.querySelectorAll('#qr-opts .option-item').forEach((e, k) => { e.classList.remove('selected'); if (k === it.ci) e.style.cssText += 'border-color:var(--sm-ok);'; else if (k === RUN.sel) e.style.cssText += 'border-color:var(--sm-bad);'; });
    $('qr-submit').style.display = 'none';
    try { if (window.WeaknessProfile && it.subject) WeaknessProfile.recordAttempt({ subject: it.subject, topic: it.topic && it.topic !== 'General' ? it.topic : null, level: ok ? 'knew' : 'lost', difficulty: 'Review', mistakeType: null }); } catch (_) { }
    const last = RUN.i === RUN.items.length - 1, saved = SMF.isSaved(it.subject, it.q);
    $('qr-result').innerHTML = `<div class="qr-fb ${ok ? 'ok' : 'bad'}"><b>${ok ? '✅ Correct' : '❌ Not quite'}</b>${ok ? '' : `<div>Correct answer: <b>${esc(it.o[it.ci])}</b></div>`}<div class="qr-ex">${esc(it.ex || '')}</div></div>
      <button class="sm-btn block" id="qr-save" onclick="SMF.saveMcq(SMF._runItem(),this)">${saved ? '🔖 Saved' : '🔖 Save question'}</button>
      <button class="ask-btn" style="margin-top:10px" onclick="SMF.runNext()">${last ? 'Finish' : 'Next →'}</button>`;
  };
  SMF._runItem = () => RUN.items[RUN.i];
  SMF.runNext = function () { if (RUN.i >= RUN.items.length - 1) { RUN.done = true; finishRun(); } else { RUN.i++; RUN.sel = null; } renderRun(); };
  function finishRun() {
    try {
      const bySub = {};
      RUN.items.forEach((it, i) => { const r = RUN.results[i]; if (!r) return; (bySub[it.subject || 'General'] = bySub[it.subject || 'General'] || []).push({ q: it.q, o: it.o, ci: it.ci, si: r.sel, topic: it.topic, ex: it.ex, ok: r.ok }); });
      Object.keys(bySub).forEach(sub => Sess().add({ type: 'retry', subject: sub, difficulty: null, questions: bySub[sub], durationSec: (Date.now() - RUN.started) / 1000 }));
    } catch (e) { console.warn(e); }
  }
  function renderRunSummary(el) {
    const done = RUN.results.filter(Boolean), c = done.filter(r => r.ok).length, p = pct(c, done.length);
    const missed = RUN.items.filter((_, i) => RUN.results[i] && !RUN.results[i].ok);
    el.innerHTML = `<div class="res-hero"><div class="score-ring" style="--p:${p}; --rc:${rc(p)}"><b>${done.length ? p + '%' : '–'}</b></div><div class="res-title">Done</div><div class="res-sub">${c} of ${done.length} correct · ${esc(RUN.title)}</div></div>
      ${missed.length ? '<button class="ask-btn" onclick="SMF.runMissed()">🔁 Retry the ' + missed.length + ' you missed</button>' : ''}
      <button class="modal-dismiss" onclick="SMF.runExit()">Back</button>`;
  }
  SMF.runMissed = function () { const m = RUN.items.filter((_, i) => RUN.results[i] && !RUN.results[i].ok); SMF.runQuestions(m, RUN.title + ' — retry', RUN.ctx); };
  SMF.runExit = function () {
    const from = RUN.ctx && RUN.ctx.from;
    if (from === 'history') { goScreen('progress', document.querySelectorAll('.nav-item')[4]); SMF.progTab('history'); }
    else if (from === 'search') goScreen('search', null);
    else if (from === 'saved') goScreen('history', document.querySelectorAll('.nav-item')[3]);
    else goScreen('home', document.querySelectorAll('.nav-item')[0]);
  };

  // ═══════════════════════════ PROGRESS TABS: Overview | Performance | History ═══════════════════════════
  const PT = { tab: 'overview', hf: { subject: 'All', type: 'All', limit: 20 } };
  const OLD_PROGRESS = ['academic-intelligence-report-container', 'progress-content'];
  SMF.onProgress = function () {
    const scr = $('screen-progress'); if (!scr) return;
    if (!$('prog-tabs')) {
      const head = scr.querySelector('.scr-head');
      const d = document.createElement('div'); d.id = 'prog-tabs'; d.className = 'sm-tabs';
      d.innerHTML = '<button data-t="overview" onclick="SMF.progTab(\'overview\')">Overview</button><button data-t="performance" onclick="SMF.progTab(\'performance\')">Performance</button><button data-t="history" onclick="SMF.progTab(\'history\')">History</button>';
      scr.insertBefore(d, head ? head.nextSibling : scr.firstChild);
      ['perf', 'hist'].forEach(n => { const c = document.createElement('div'); c.id = 'sm-' + n; c.style.display = 'none'; scr.appendChild(c); });
    }
    Sess().pull().then(() => { if (PT.tab !== 'overview') renderProgTab(); });
    renderProgTab();
  };
  SMF.progTab = function (t) { PT.tab = t; renderProgTab(); };
  function renderProgTab() {
    const tabs = $('prog-tabs'); if (!tabs) return;
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === PT.tab));
    OLD_PROGRESS.forEach(id => { const e = $(id); if (e) e.style.display = PT.tab === 'overview' ? '' : 'none'; });
    const hd = $('screen-progress').querySelector('.scr-head'); if (hd) hd.style.display = PT.tab === 'overview' ? '' : 'none';
    $('sm-perf').style.display = PT.tab === 'performance' ? '' : 'none'; $('sm-hist').style.display = PT.tab === 'history' ? '' : 'none';
    if (PT.tab === 'performance') renderPerformance(); if (PT.tab === 'history') renderHistoryTab();
  }
  SMF.openHistory = function () { goScreen('progress', document.querySelectorAll('.nav-item')[4]); setTimeout(() => SMF.progTab('history'), 0); };
  SMF.openPerformance = function () { goScreen('progress', document.querySelectorAll('.nav-item')[4]); setTimeout(() => SMF.progTab('performance'), 0); };

  // ═══════════════════════════ HISTORY ═══════════════════════════
  const typeOf = s => TYPE_LABEL[s.type] || 'Session';
  function renderHistoryTab() {
    const el = $('sm-hist'); const all = Sess().list();
    const subjects = ['All'].concat(Array.from(new Set(all.map(s => s.subject))).sort());
    const types = ['All'].concat(Array.from(new Set(all.map(s => s.type))));
    let f = all.filter(s => (PT.hf.subject === 'All' || s.subject === PT.hf.subject) && (PT.hf.type === 'All' || s.type === PT.hf.type));
    const shown = f.slice(0, PT.hf.limit);
    el.innerHTML = `<div class="scr-head"><span class="ic" style="--ci:var(--sm-c5)">📋</span><div><h1>Exam & Practice History</h1><p>${all.length ? all.length + ' recorded session' + (all.length === 1 ? '' : 's') : 'Completed sessions appear here'}</p></div></div>` +
      (all.length ? `<div class="sq-row"><select aria-label="Subject" onchange="SMF.hFilter('subject',this.value)">${subjects.map(s => `<option ${s === PT.hf.subject ? 'selected' : ''} value="${esc(s)}">${s === 'All' ? 'All subjects' : esc(s)}</option>`).join('')}</select>
        <select aria-label="Activity type" onchange="SMF.hFilter('type',this.value)">${types.map(t => `<option ${t === PT.hf.type ? 'selected' : ''} value="${esc(t)}">${t === 'All' ? 'All activities' : esc(TYPE_LABEL[t] || t)}</option>`).join('')}</select></div>` : '') +
      (!all.length ? `<div class="sm-empty"><div class="e-ic">📋</div>No sessions recorded yet.<br><small>Finish a Practice session, Mock Exam or CBT run and it will be saved here with every question for review.</small><br><button class="sm-btn primary" style="margin-top:12px" onclick="goScreen('practice',document.querySelectorAll('.nav-item')[2])">Start practising</button><div class="sm-note">Activity from before this feature existed isn’t listed here, because individual questions weren’t stored then. It still counts in your Weakness Profile (Overview tab).</div></div>`
        : !f.length ? '<div class="sm-empty">No sessions match these filters.</div>'
        : shown.map(s => { const p = pct(s.correct, s.total); return `<button class="h-card" onclick="SMF.openSession('${jid(s.clientId)}')"><span class="h-ring" style="--p:${p};--rc:${rc(p)}"><b>${p}%</b></span><span class="h-main"><b>${TYPE_ICON[s.type] || '📘'} ${esc(s.subject)}</b><small>${esc(typeOf(s))} · ${esc(fmtDate(s.completedAt))}${s.durationSec != null ? ' · ' + fmtDur(s.durationSec) : ''}</small><small>${s.correct} correct · ${s.total - s.correct} incorrect · ${s.total} question${s.total === 1 ? '' : 's'}</small></span><span class="chev">›</span></button>`; }).join('') +
          (f.length > shown.length ? `<button class="sm-btn block" onclick="SMF.hMore()">Show more (${f.length - shown.length})</button>` : ''));
  }
  SMF.hFilter = (k, v) => { PT.hf[k] = v; PT.hf.limit = 20; renderHistoryTab(); }; SMF.hMore = () => { PT.hf.limit += 20; renderHistoryTab(); };
  const withSub = s => s.questions.map(q => ({ q: q.q, o: q.o, ci: q.ci, topic: q.topic, ex: q.ex, subject: s.subject, source: s.type, ok: q.ok, si: q.si }));
  SMF.openSession = function (id) {
    const s = Sess().list().find(x => x.clientId === id); if (!s) return; const p = pct(s.correct, s.total);
    const qs = withSub(s), missed = qs.filter(q => !q.ok).length, canRun = qs.every(q => q.o && q.o.length > 1 && Number.isInteger(q.ci));
    openSheet(`<div class="sh-head"><b>${TYPE_ICON[s.type] || ''} ${esc(s.subject)} — ${esc(typeOf(s))}</b><button class="sm-link" onclick="SMF.closeSheet()" aria-label="Close">✕</button></div>
      <div class="sh-src">${esc(fmtDate(s.completedAt))}${s.durationSec != null ? ' · ' + fmtDur(s.durationSec) : ''}${s.difficulty ? ' · ' + esc(s.difficulty) : ''}${s.style ? ' · exam-style setting: ' + esc(s.style) + ' (AI-generated, not official past questions)' : ''}</div>
      <div class="h-sum"><span class="h-ring big" style="--p:${p};--rc:${rc(p)}"><b>${p}%</b></span><div><b>${s.correct} / ${s.total} correct</b><small>${s.total - s.correct} incorrect</small>${s.topics.length ? '<small>Topics: ' + esc(s.topics.join(', ')) + '</small>' : ''}</div></div>
      ${canRun ? `<div class="sh-btns"><button class="sm-btn primary" ${missed ? '' : 'disabled'} onclick="SMF.retryMistakes('${jid(s.clientId)}')">🔁 Retry mistakes (${missed})</button><button class="sm-btn" onclick="SMF.retryAll('${jid(s.clientId)}')">↻ Retry all</button></div>` : ''}
      <div class="sh-list">${qs.map((q, i) => `<div class="sh-qa ${q.ok ? 'ok' : 'bad'}"><div class="sh-qn">${q.ok ? '✅' : (q.si == null && s.type !== 'quiz') ? '⬜ Unanswered' : '❌'} Q${i + 1}${q.topic ? ' · ' + esc(q.topic) : ''}</div><div class="sh-q">${esc(q.q)}</div>
        ${q.o && q.o.length ? `<div class="sh-ans">${q.si != null && !q.ok ? `<div>Your answer: <b>${esc(q.o[q.si] || '')}</b></div>` : ''}<div>Correct: <b>${esc(q.o[q.ci] || '')}</b></div></div>` : ''}
        ${q.ex ? `<div class="sh-ex">${esc(q.ex)}</div>` : ''}
        ${q.o && q.o.length && Number.isInteger(q.ci) ? `<button class="sm-btn small" onclick="SMF.saveFromSession('${jid(s.clientId)}',${i},this)">${SMF.isSaved(s.subject, q.q) ? '🔖 Saved' : '🔖 Save'}</button>` : ''}</div>`).join('')}</div>`);
  };
  SMF.saveFromSession = function (id, i, btn) { const s = Sess().list().find(x => x.clientId === id); if (!s) return; SMF.saveMcq(withSub(s)[i], btn); };
  SMF.retryMistakes = function (id) { const s = Sess().list().find(x => x.clientId === id); if (!s) return; SMF.runQuestions(withSub(s).filter(q => !q.ok), s.subject + ' — mistakes', { from: 'history' }); };
  SMF.retryAll = function (id) { const s = Sess().list().find(x => x.clientId === id); if (!s) return; SMF.runQuestions(withSub(s), s.subject + ' — retry', { from: 'history' }); };

  // ═══════════════════════════ PERFORMANCE ANALYTICS ═══════════════════════════
  // Pure aggregation over recorded sessions → unit-testable (see tests/features-logic.test.js).
  SMF.analyse = function (sessions) {
    const A = { sessions: sessions.length, attempted: 0, correct: 0, subjects: {}, topics: {}, trend: [], recent: [] };
    const chron = sessions.slice().sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
    chron.forEach(s => {
      A.attempted += s.total; A.correct += s.correct;
      const sb = A.subjects[s.subject] = A.subjects[s.subject] || { attempted: 0, correct: 0, sessions: 0 };
      sb.attempted += s.total; sb.correct += s.correct; sb.sessions++;
      s.questions.forEach(q => {
        if (!q.topic) return; const k = s.subject + '||' + q.topic;
        const t = A.topics[k] = A.topics[k] || { subject: s.subject, topic: q.topic, attempted: 0, correct: 0 };
        t.attempted++; if (q.ok) t.correct++;
      });
      A.trend.push({ at: s.completedAt, acc: pct(s.correct, s.total), subject: s.subject, total: s.total });
    });
    A.accuracy = A.attempted ? pct(A.correct, A.attempted) : null;
    A.incorrect = A.attempted - A.correct;
    Object.values(A.subjects).forEach(s => s.accuracy = pct(s.correct, s.attempted));
    A.topicList = Object.values(A.topics).map(t => ({ ...t, accuracy: pct(t.correct, t.attempted), enough: t.attempted >= MIN_TOPIC_Q }));
    A.weak = A.topicList.filter(t => t.enough && t.accuracy < WEAK_BELOW).sort((a, b) => a.accuracy - b.accuracy);
    A.strong = A.topicList.filter(t => t.enough && t.accuracy >= STRONG_FROM).sort((a, b) => b.accuracy - a.accuracy);
    A.thin = A.topicList.filter(t => !t.enough);
    A.recent = chron.slice(-5).reverse();
    return A;
  };
  function trendSvg(points) {
    const W = 320, H = 110, pad = 18, n = points.length;
    const x = i => n === 1 ? W / 2 : pad + i * (W - 2 * pad) / (n - 1), y = v => H - pad - (v / 100) * (H - 2 * pad);
    const path = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.acc).toFixed(1)).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="pf-svg" role="img" aria-label="Accuracy by session, ${points.map(p => p.acc + '%').join(', ')}"><g stroke="var(--border-1)" stroke-width="1"><line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}"/><line x1="${pad}" x2="${W - pad}" y1="${y(50)}" y2="${y(50)}" stroke-dasharray="3 4"/><line x1="${pad}" x2="${W - pad}" y1="${y(100)}" y2="${y(100)}"/></g>
      <text x="2" y="${y(100) + 3}" class="pf-ax">100</text><text x="6" y="${y(50) + 3}" class="pf-ax">50</text><text x="10" y="${y(0) + 3}" class="pf-ax">0</text>
      <path d="${path}" fill="none" stroke="var(--indigo)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.acc).toFixed(1)}" r="3.5" fill="var(--indigo)"><title>${p.acc}% — ${esc(p.subject)}</title></circle>`).join('')}</svg>`;
  }
  let WEAK_LIST = [];
  SMF.practiseWeak = k => { const t = WEAK_LIST[k]; if (t) SMF.practiseTopic(t.subject, t.topic); };
  function renderPerformance() {
    const el = $('sm-perf'); const A = SMF.analyse(Sess().list());
    const head = `<div class="scr-head"><span class="ic" style="--ci:var(--sm-c1)">📊</span><div><h1>Performance</h1><p>Built only from questions you’ve answered</p></div></div>`;
    if (!A.sessions) { el.innerHTML = head + `<div class="sm-empty"><div class="e-ic">📊</div>No graded sessions recorded yet.<br><small>Complete a Practice session or Mock Exam and your accuracy, strengths and weak spots will show up here.</small><br><button class="sm-btn primary" style="margin-top:12px" onclick="goScreen('practice',document.querySelectorAll('.nav-item')[2])">Start practising</button></div>`; return; }
    const subs = Object.entries(A.subjects).sort((a, b) => b[1].attempted - a[1].attempted);
    const trend = A.trend.slice(-20);
    const topicRow = (t, kind) => `<div class="pf-trow"><div><b>${esc(t.topic)}</b><small>${esc(t.subject)} · ${t.correct}/${t.attempted} correct</small></div><span class="pf-pct" style="color:${kind === 'weak' ? 'var(--sm-bad)' : 'var(--sm-ok)'}">${t.accuracy}%</span>${kind === 'weak' ? `<button class="sm-btn small primary" onclick="SMF.practiseWeak(${t._i})">Practise</button>` : ''}</div>`;
    const recs = [];
    if (A.weak.length) recs.push(`Focus on <b>${esc(A.weak[0].topic)}</b> (${esc(A.weak[0].subject)}): ${A.weak[0].correct} of ${A.weak[0].attempted} correct so far.`);
    const lowSub = subs.filter(([, s]) => s.attempted >= MIN_TOPIC_Q && s.accuracy < WEAK_BELOW).sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
    if (lowSub) recs.push(`<b>${esc(lowSub[0])}</b> accuracy is ${lowSub[1].accuracy}% across ${lowSub[1].attempted} questions — it needs more practice.`);
    if (A.thin.length) recs.push(`${A.thin.length} topic${A.thin.length === 1 ? ' has' : 's have'} fewer than ${MIN_TOPIC_Q} answers, so there isn’t enough data to judge ${A.thin.length === 1 ? 'it' : 'them'} yet.`);
    if (!recs.length) recs.push(A.attempted < MIN_TOPIC_Q ? `Answer a few more questions — you need at least ${MIN_TOPIC_Q} per topic before StudyMate calls anything a strength or weakness.` : 'No topic is currently below the practice threshold. Keep varying topics.');
    el.innerHTML = head + `
      <div class="pf-kpis"><div><b>${A.accuracy}%</b><span>Overall accuracy</span></div><div><b>${A.attempted}</b><span>Attempted</span></div><div><b style="color:var(--sm-ok)">${A.correct}</b><span>Correct</span></div><div><b style="color:var(--sm-bad)">${A.incorrect}</b><span>Incorrect</span></div></div>
      <div class="sm-card"><h3>By subject</h3>${subs.map(([n, s]) => `<div class="bd-row"><div class="bd-top"><span>${esc(n)}</span><span style="color:${rc(s.accuracy)}">${s.accuracy}% · ${s.correct}/${s.attempted}</span></div><div class="bd-bar"><i style="width:${s.accuracy}%;background:${rc(s.accuracy)}"></i></div>${s.attempted < MIN_TOPIC_Q ? '<small class="pf-thin">Not enough data yet</small>' : ''}</div>`).join('')}</div>
      <div class="sm-card"><h3>Accuracy over time</h3>${trend.length >= 2 ? trendSvg(trend) + `<small class="pf-thin">Last ${trend.length} sessions, oldest to newest</small>` : '<div class="sm-empty small">Complete at least 2 sessions to see a trend.</div>'}</div>
      <div class="sm-card"><h3>Needs practice</h3>${A.weak.length ? (WEAK_LIST = A.weak.slice(0, 6)).map((t, k) => topicRow({ ...t, _i: k }, 'weak')).join('') : `<div class="sm-empty small">${A.topicList.length ? 'No topic with enough answers (≥' + MIN_TOPIC_Q + ') is below ' + WEAK_BELOW + '%.' : 'Topic data appears once questions are tagged with a topic.'}</div>`}</div>
      <div class="sm-card"><h3>Strengths</h3>${A.strong.length ? A.strong.slice(0, 6).map(t => topicRow(t, 'strong')).join('') : '<div class="sm-empty small">No topic has reached ' + STRONG_FROM + '% over ' + MIN_TOPIC_Q + '+ answers yet.</div>'}</div>
      <div class="sm-card"><h3>Recommendations</h3><ul class="pf-recs">${recs.map(r => `<li>${r}</li>`).join('')}</ul></div>
      <div class="sm-card"><h3>Recent activity</h3>${A.recent.map(s => `<button class="pf-act" onclick="SMF.openSession('${jid(s.clientId)}')"><span>${TYPE_ICON[s.type] || ''} ${esc(s.subject)} <small>${esc(typeOf(s))} · ${esc(fmtDate(s.completedAt))}</small></span><b style="color:${rc(pct(s.correct, s.total))}">${s.correct}/${s.total}</b></button>`).join('')}<button class="sm-link" onclick="SMF.progTab('history')">View full history ›</button></div>
      <p class="sm-note">Based on ${A.sessions} recorded session${A.sessions === 1 ? '' : 's'}. Topic labels come from each question. Older activity (before sessions were stored) is in the Overview tab.</p>`;
  }
  // Weak topic → existing Practice setup, pre-selected as far as the curriculum allows.
  SMF.practiseTopic = function (subject, topic) {
    goScreen('practice', document.querySelectorAll('.nav-item')[2]);
    try {
      const chips = Array.from(document.querySelectorAll('#practice-subject-chips .chip'));
      const sc = chips.find(c => c.textContent.trim() === subject);
      if (!sc) { toast('Opening Practice — pick ' + subject); return; }
      pickPracticeSubject(sc, subject);
      const tn = norm(topic), tchips = Array.from(document.querySelectorAll('#practice-topic-chips .chip'));
      const tc = tchips.find(c => norm(c.textContent) === tn) || tchips.find(c => { const x = norm(c.textContent); return x !== 'mixed / general' && (x.includes(tn) || tn.includes(x)); });
      if (tc) pickPracticeTopic(tc, tc.textContent.trim()); else toast('Practising ' + subject + ' (mixed topics)');
    } catch (e) { console.warn(e); }
  };

  // ═══════════════════════════ SMART QUESTION SEARCH ═══════════════════════════
  function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; let best = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur.push(v); if (v < best) best = v; } if (best > max) return max + 1; prev = cur; }
    return prev[b.length];
  }
  // Token matches if equal, prefix/substring, or within a small edit distance (spelling variants).
  function tokScore(t, words) {
    let best = 0;
    for (const w of words) {
      if (w === t) return 3;
      if (w.startsWith(t) && t.length >= 2) best = Math.max(best, 2);
      else if (t.length >= 3 && w.includes(t)) best = Math.max(best, 1.5);
      else if (t.length >= 4 && w.length >= 4) { const d = lev(t, w, t.length >= 8 ? 2 : 1); if (d <= (t.length >= 8 ? 2 : 1)) best = Math.max(best, 1); }
    }
    return best;
  }
  SMF.fuzzyScore = function (query, text) {
    const toks = norm(query).split(' ').filter(Boolean); if (!toks.length) return 0;
    const words = Array.from(new Set(norm(text).split(' ')));
    let total = 0; for (const t of toks) { const s = tokScore(t, words); if (!s) return 0; total += s; }
    return total / toks.length;
  };
  // Pool: ONLY questions that really exist in this account (saved MCQs + recorded sessions). Pluggable provider for a future real bank.
  const providers = [];
  SMF.registerQuestionSource = fn => { if (typeof fn === 'function') providers.push(fn); };
  SMF.questionPool = function () {
    const seen = new Map();
    const put = it => { const k = qKey(it.subject, it.q); const prev = seen.get(k); if (!prev) seen.set(k, it); else { prev.saved = prev.saved || it.saved; prev.times = (prev.times || 1) + 1; } };
    (state.history || []).filter(isMcq).forEach(h => put({ q: h.question, o: h.options, ci: h.correctIndex, topic: h.topic, ex: h.explanation, subject: h.subject, source: h.sourceLabel || AI_SOURCE, style: h.style || null, kind: 'Multiple choice', saved: true, id: 's' + h.id }));
    Sess().list().forEach(s => s.questions.forEach((q, i) => { if (q.o && q.o.length > 1) put({ q: q.q, o: q.o, ci: q.ci, topic: q.topic, ex: q.ex, subject: s.subject, source: AI_SOURCE, style: s.style || null, kind: 'Multiple choice', date: s.completedAt, id: s.clientId + ':' + i }); }));
    providers.forEach(p => { try { (p() || []).forEach(put); } catch (e) { console.warn('question source failed', e); } });
    return Array.from(seen.values());
  };
  SMF.searchQuestions = function (query, f) {
    f = f || {}; const out = [];
    SMF.questionPool().forEach(it => {
      if (f.subject && f.subject !== 'All' && it.subject !== f.subject) return;
      if (f.topic && f.topic !== 'All' && (it.topic || '') !== f.topic) return;
      if (f.style && f.style !== 'All' && (it.style || 'None') !== f.style) return;
      if (f.saved && !it.saved) return;
      const hay = it.q + ' ' + (it.topic || '') + ' ' + it.subject + ' ' + it.o.join(' ');
      let s = 1;
      if (norm(query)) { s = SMF.fuzzyScore(query, hay); if (!s) return; s += SMF.fuzzyScore(query, it.q) * 0.5 + (it.topic ? SMF.fuzzyScore(query, it.topic) * 0.3 : 0); }
      out.push({ it, s });
    });
    return out.sort((a, b) => b.s - a.s).map(x => x.it);
  };
  const SS = { subject: 'All', topic: 'All', style: 'All', saved: false, last: [] };
  SMF.ssFilter = function (k, v) { SS[k] = v; SMF.ssRender(); };
  SMF.ssRender = function () {
    const box = $('ss-results'); if (!box) return;
    const q = ($('search-input') || {}).value || '';
    const pool = SMF.questionPool(); const has = norm(q) || SS.subject !== 'All' || SS.topic !== 'All' || SS.style !== 'All' || SS.saved;
    const res = has ? SMF.searchQuestions(q, SS) : []; SS.last = res;
    const subjects = Array.from(new Set(pool.map(p => p.subject))).sort(), topics = Array.from(new Set(pool.filter(p => SS.subject === 'All' || p.subject === SS.subject).map(p => p.topic).filter(Boolean))).sort(), styles = Array.from(new Set(pool.map(p => p.style || 'None')));
    const sel = (id, key, opts, label) => `<select aria-label="${label}" onchange="SMF.ssFilter('${key}',this.value)"><option value="All">${label}</option>${opts.map(o => `<option ${SS[key] === o ? 'selected' : ''} value="${esc(o)}">${esc(o === 'None' ? 'No exam style' : o)}</option>`).join('')}</select>`;
    const bar = pool.length ? `<div class="ss-filters">${sel('s', 'subject', subjects, 'All subjects')}${sel('t', 'topic', topics, 'All topics')}${styles.length > 1 || styles[0] !== 'None' ? sel('x', 'style', styles, 'Exam-style setting') : ''}<label class="ss-chk"><input type="checkbox" ${SS.saved ? 'checked' : ''} onchange="SMF.ssFilter('saved',this.checked)"> Saved only</label></div>` : '';
    let body;
    if (!pool.length) body = '<div class="sm-empty small">Questions you practise or save will become searchable here. StudyMate generates practice questions with AI, so there is no built-in past-paper bank to search.</div>';
    else if (!has) body = `<div class="sm-empty small">Search ${pool.length} question${pool.length === 1 ? '' : 's'} you’ve practised or saved — by keyword, topic or subject.</div>`;
    else if (!res.length) body = '<div class="sm-empty small">No practised or saved questions match. Try a different spelling or fewer words.</div>';
    else body = res.slice(0, 25).map((it, i) => `<div class="ss-card"><div class="ss-meta">${esc(it.subject)}${it.topic ? ' · ' + esc(it.topic) : ''}<span>${esc(it.kind)}</span></div><div class="ss-q">${esc(it.q.length > 160 ? it.q.slice(0, 160) + '…' : it.q)}</div><div class="ss-src">${esc(it.source)}${it.style ? ' · exam-style setting: ' + esc(it.style) : ''}${it.saved ? ' · 🔖 saved' : ''}</div><button class="sm-btn small primary" onclick="SMF.ssPractise(${i})">Practise</button></div>`).join('') + (res.length > 25 ? `<div class="sm-note">Showing 25 of ${res.length}. Narrow your search to see more.</div>` : '');
    box.innerHTML = (has ? `<div class="select-label" style="margin:14px 0 6px">Questions</div>` : '') + bar + body;
  };
  SMF.ssPractise = function (i) { const it = SS.last[i]; if (!it) return; SMF.runQuestions([it], 'Search result', { from: 'search' }); };

  // Wrap the existing search: original results stay; a Questions section is added underneath.
  const origRenderSearch = window.renderSearchScreen, origRunSearch = window.runSearch;
  window.renderSearchScreen = function () {
    origRenderSearch && origRenderSearch();
    const c = $('search-content'); if (c && !$('ss-results')) { const d = document.createElement('div'); d.id = 'ss-results'; c.appendChild(d); }
    SMF.ssRender();
  };
  window.runSearch = function (query) { origRunSearch && origRunSearch(query); const c = $('search-content'); if (c && !$('ss-results')) { const d = document.createElement('div'); d.id = 'ss-results'; c.appendChild(d); } SMF.ssRender(); };
  SMF._norm = norm; SMF._qKey = qKey;
})();

// Account load: after the existing saved-question load finishes, also pull session history + notes.
(function () {
  const SMF = window.SMF, orig = window.loadSavedQuestions;
  if (typeof orig !== 'function') return;
  window.loadSavedQuestions = async function () {
    const r = await orig.apply(this, arguments);
    try { SMF.purgeForeignData(); await Promise.all([SMF.Sessions.pull(), SMF.pullNotes()]); if (document.getElementById('screen-history').classList.contains('active')) SMF.renderSaved(); } catch (_) { }
    return r;
  };
})();
