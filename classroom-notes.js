/**
 * StudyMate AI -- Global Classroom Notes (inside Study Material)
 * -------------------------------------------------------------------------
 * Four connected formats for ONE topic: Classroom Notes, At a Glance, Worked Examples, Exam Practice.
 *
 * HONESTY RULES (enforced here, covered by tests/classroom-notes.test.js)
 *   o Topics come ONLY from window.CURRICULUM (country -> exam board -> subject -> topic -> subtopics).
 *     A subject with no topic list is shown as "not available yet": nothing is generated for it.
 *   o StudyMate's topic lists are outlines, never an official syllabus. Every screen says so, and
 *     every generated text is labelled "AI-generated", never "official" or "past paper".
 *   o Exam Practice is AI-generated practice. It is never labelled as a past examination question.
 *   o No hidden country/exam default: students pick any board from any country; location locks nothing.
 *
 * AI / QUOTA: generation goes through the existing callAskApi(..., 'classroomNotes'): its own Free counter in
 *   api/_lib/limits.js (2 pages per week, because pages are long), the same server routing as every feature
 *   (Free = Gemini, Premium = Claude, never a silent Claude fallback). This file adds NO provider or key.
 *   Generated text is saved on the device and re-shown for free; it is only regenerated on an explicit tap.
 *
 * STORAGE: localStorage per account is always the working copy. Goals, progress, bookmarks and the student's own notes ALSO
 *   sync to Supabase (schema 18, RLS own-rows-only) when that schema exists; if it does not, everything stays on-device and nothing breaks.
 *   AI-generated text is stored on the device only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SMCN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // maths: LaTeX -> MathML (math-render.js). In Node (tests, server) it is required; in the browser it is a global.
  const MR = (typeof module === 'object' && typeof require === 'function') ? require('./math-render.js') : ((typeof self !== 'undefined' && self.SMMathRender) || null);
  let _mathml = null;
  const mathOk = () => { if (_mathml === null) _mathml = MR && typeof document !== 'undefined' ? MR.supportsMathML() : true; return _mathml; };

  const FORMATS = [
    { id: 'notes',    icon: '📖', label: 'Notes',     title: 'Classroom Notes' },
    { id: 'glance',   icon: '⚡', label: 'At a Glance', title: 'At a Glance' },
    { id: 'examples', icon: '🧮', label: 'Examples',  title: 'Worked Examples' },
    { id: 'practice', icon: '📝', label: 'Practice',  title: 'Exam Practice' }
  ];
  const FORMAT_IDS = FORMATS.map(f => f.id);
  const SOURCE_LABEL = 'AI-generated from a general topic outline. Not an official syllabus, not past-paper content.';
  const CUSTOM_LABEL = 'AI-generated from a topic you typed. Private to you. Not an official syllabus, not past-paper content.';
  const PRACTICE_LABEL = 'AI-generated practice questions. These are NOT official past examination questions.';
  const MAX_TEXT = 12000;
  const MAX_SAVED = 800;     // pages kept on the device (IndexedDB; about 8 MB at 10 KB a page)

  // ---------- pure helpers (unit-tested) ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jid = v => String(v == null ? '' : v).replace(/[^A-Za-z0-9_:.\-]/g, '');

  function topicKey(board, subject, topic) { return [board, subject, topic].map(x => String(x || '').trim()).join('|'); }
  function contentKey(board, subject, topic, format) { return topicKey(board, subject, topic) + '|' + format; }

  /** Flattens CURRICULUM into the topic list for one board+subject. [] when the subject has no outline. */
  function listTopics(C, board, subject) {
    const raw = (C && C.getTopics) ? C.getTopics(board, subject) : [];
    return (raw || []).map((t, i) => ({ index: i, name: t.name, subtopics: Array.isArray(t.subtopics) ? t.subtopics.slice() : [] }));
  }

  /** How a board's topic list may be described to the student. Never "official". */
  function provenance(boardObj) {
    const note = boardObj && boardObj.topicsNote;
    return {
      official: false,
      label: note ? String(note) : 'General topic coverage',
      warning: 'StudyMate shows a general topic outline. Check your exam board\'s own syllabus for the exact requirements.'
    };
  }

  /** Builds the generation prompt. Returns null when there is no curriculum context (so nothing is invented). */
  function buildPrompt(format, ctx) {
    if (!ctx || !ctx.subject || !ctx.topic || !FORMAT_IDS.includes(format)) return null;
    const sub = (ctx.subtopics && ctx.subtopics.length) ? ` Subtopics to cover: ${ctx.subtopics.join('; ')}.` : '';
    const exam = ctx.boardLabel ? ` for the ${ctx.boardLabel} examination` : '';
    const level = ctx.level ? ` (${ctx.level} level)` : '';
    const lang = ctx.language && ctx.language !== 'en' ? ` Write in the language with code "${ctx.language}".` : '';
    const rules = ' Write ALL mathematics in LaTeX: inline maths between single dollar signs like $x^2 + 3x = 10$, and every important equation or step on its own line between double dollar signs like $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$. Use only standard commands (\\frac, \\sqrt, ^, _, \\times, \\div, \\pm, \\le, \\ge, \\ne, \\approx, \\pi, \\theta, \\sum, \\int, \\lim, \\text{...}, \\begin{pmatrix}...\\end{pmatrix}). Never use a bare dollar sign for money: write amounts with the currency symbol or name (₦, £, €) or in words. Use "## " for section headings, "- " for bullets, and simple "|" tables only where they help. ' +
      'Do not claim this is the official syllabus or an official examination requirement. Do not invent past-paper references, years or exam-board quotations. If something differs between exam boards, say to check the board\'s own syllabus.' + lang;
    const head = `Topic: "${ctx.topic}" in ${ctx.subject}${exam}${level}.${sub}`;
    const body = {
      notes: 'Write comprehensive classroom-style notes, like a good teacher explaining to a student, in simple clear language. Sections: ## Introduction, ## Learning objectives, ## Key definitions, ## Explanation, ## Rules and principles, ## Formulas (with every symbol and unit explained, only if the topic uses formulas), ## Comparisons (a table if useful), ## Worked example, ## Common examination mistakes, ## Examination tips, ## Recap.',
      glance: 'Write a concise revision sheet only (it must fit on one phone screen or two). Sections: ## Definitions, ## Key facts, ## Rules, ## Formulas (only if relevant), ## Must remember, ## Quick comparison, ## Exam traps. Short bullets, no long paragraphs.',
      examples: 'Write 3 worked examples of rising difficulty, each under its own "## Example n" heading. For calculation topics write the question, then "Given:", "Required:", "Formula:", then numbered lines "Step 1: ...", "Step 2: ..." (one idea per step, each equation on its own display line), then "Final answer: ..." and a one-line "Why it works:" explanation. For non-calculation topics give the question, a model answer in short steps and why it earns marks. Use notation suited to this level.',
      practice: 'Write 5 multiple-choice questions (options A to D) then 2 theory or structured questions and, where the topic involves calculation, 2 calculation questions. After each, give the answer and a short explanation. Start with the line: "AI-generated practice, not official past questions."'
    }[format];
    return `${head} ${body}${rules} Respond with ONLY the content, no preamble.`;
  }

  /** Rejects empty / runaway / HTML-ish model output instead of saving it. */
  function validateGenerated(text, ctx) {
    if (typeof text !== 'string') return { ok: false, reason: 'empty' };
    const t = text.trim();
    if (t.length < 80) return { ok: false, reason: 'too_short' };
    if (t.length > MAX_TEXT * 2) return { ok: false, reason: 'too_long' };
    if (/<\s*(script|iframe|object|embed)\b/i.test(t)) return { ok: false, reason: 'unsafe_markup' };
    if (/\b(official (waec|neco|jamb|gcse|cbse) (syllabus|past question)|this is an official)\b/i.test(t)) return { ok: false, reason: 'false_official_claim' };
    if (ctx && ctx.topic) {
      const words = String(ctx.topic).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
      if (words.length && !words.some(w => t.toLowerCase().includes(w)) && !(ctx.subtopics || []).some(s => t.toLowerCase().includes(String(s).toLowerCase().slice(0, 6)))) {
        return { ok: false, reason: 'off_topic' };
      }
    }
    return { ok: true, text: t.slice(0, MAX_TEXT) };
  }

  /** Safe mini-markdown: escape FIRST, then add structure. Never injects raw model HTML. Maths ($..$ / $$..$$) becomes MathML. */
  function renderText(text, query) {
    // 1) lift maths out so it is never touched by escaping, bold or search highlighting
    const maths = []; let src = '';
    if (MR) MR.split(text).forEach(seg => {
      if (seg.t === 'text') src += seg.v;
      else { maths.push(seg); src += '\uE000' + String.fromCharCode(0xE100 + maths.length - 1) + '\uE001'; }
    }); else src = String(text || '');
    const mathHtml = ch => {
      const seg = maths[ch.charCodeAt(0) - 0xE100]; if (!seg) return '';
      const h = mathOk() ? MR.texToMathML(seg.v, seg.display)
        : '<span class="cn-tex">' + esc((typeof self !== 'undefined' && self.MathText && self.MathText.cleanProse) ? self.MathText.cleanProse('$' + seg.v + '$') : seg.v) + '</span>';
      return h;
    };
    const putMath = h => h.replace(/\uE000([\uE100-\uE4FF])\uE001/g, (_, ch) => mathHtml(ch));
    const lines = src.split('\n');
    const out = []; let list = false; let table = [];
    const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const hl = h => {
      if (!query) return h;
      const q = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return h.replace(new RegExp('(' + q + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>');
    };
    const flushList = () => { if (list) { out.push('</ul>'); list = false; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim()));
      out.push('<div class="cn-tablewrap"><table class="cn-table">' + rows.map((r, i) => '<tr>' + r.map(c => (i === 0 ? '<th>' : '<td>') + hl(inline(c)) + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</table></div>');
      table = [];
    };
    lines.forEach(raw => {
      const l = raw.replace(/\s+$/, '');
      if (/^\s*\|.*\|\s*$/.test(l)) { flushList(); table.push(l); return; }
      flushTable();
      if (/^#{1,4}\s+/.test(l)) { flushList(); out.push('<h3 class="cn-h">' + hl(inline(l.replace(/^#{1,4}\s+/, ''))) + '</h3>'); return; }
      if (/^\s*[-•*]\s+/.test(l)) { if (!list) { out.push('<ul class="cn-ul">'); list = true; } out.push('<li>' + hl(inline(l.replace(/^\s*[-•*]\s+/, ''))) + '</li>'); return; }
      flushList();
      const lone = /^\s*\uE000([\uE100-\uE4FF])\uE001\s*$/.exec(l);
      if (lone && maths[lone[1].charCodeAt(0) - 0xE100] && maths[lone[1].charCodeAt(0) - 0xE100].display) { out.push('<div class="cn-mathblock">' + mathHtml(lone[1]) + '</div>'); return; }
      const step = /^\s*(?:\*\*)?Step\s+(\d{1,2})\s*[:.)]\s*(?:\*\*)?\s*(.*)$/i.exec(l);
      if (step) { out.push('<div class="cn-step"><span class="cn-stepn">' + step[1] + '</span><div>' + hl(inline(step[2])) + '</div></div>'); return; }
      const fin = /^\s*(?:\*\*)?(Final answer|Answer)\s*[:.]\s*(?:\*\*)?\s*(.*)$/i.exec(l);
      if (fin) { out.push('<div class="cn-answer"><b>' + esc(fin[1]) + ':</b> ' + hl(inline(fin[2])) + '</div>'); return; }
      if (l.trim()) out.push('<p>' + hl(inline(l)) + '</p>');
    });
    flushList(); flushTable();
    return putMath(out.join(''));
  }

  function countMatches(text, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 0;
    const t = String(text || '').toLowerCase(); let n = 0, i = 0;
    while ((i = t.indexOf(q, i)) !== -1) { n++; i += q.length; }
    return n;
  }

  /** Topic search across a list of {board, subject, topics[]}. Matches topic and subtopic names. */
  function searchTopics(entries, query) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return [];
    const hits = [];
    entries.forEach(e => (e.topics || []).forEach(t => {
      const sub = (t.subtopics || []).filter(s => String(s).toLowerCase().includes(q));
      if (String(t.name).toLowerCase().includes(q) || sub.length) hits.push({ board: e.board, subject: e.subject, topic: t.name, matchedSubtopics: sub });
    }));
    return hits.slice(0, 50);
  }

  function nextPrev(topics, name) {
    const i = topics.findIndex(t => t.name === name);
    return { prev: i > 0 ? topics[i - 1].name : null, next: i >= 0 && i < topics.length - 1 ? topics[i + 1].name : null };
  }

  function summarizeProgress(topics, progress) {
    const done = topics.filter(t => progress[t.name] && progress[t.name].done).length;
    return { done, total: topics.length, pct: topics.length ? Math.round(done / topics.length * 100) : 0 };
  }

  const api = { FORMATS, FORMAT_IDS, SOURCE_LABEL, PRACTICE_LABEL, MAX_TEXT, esc, jid, topicKey, contentKey, listTopics, provenance, buildPrompt, validateGenerated, renderText, countMatches, searchTopics, nextPrev, summarizeProgress };

  if (typeof window === 'undefined' || typeof document === 'undefined') return api;

  // ====================================================================
  // BROWSER UI (only runs in the app)
  // ====================================================================
  const $ = id => document.getElementById(id);
  const uid = () => { try { return state.activeUserId || 'anon'; } catch (_) { return 'anon'; } };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
  const toast = m => { try { showToast(window.SMI18nUI ? SMI18nUI.t(m) : m); } catch (_) { } };
  const K = n => 'sm_cn_' + n + ':' + uid();

  let _bmCache = [];
  const _pushed = {};
  const S = { view: 'home', board: '', subject: '', topic: '', custom: false, format: 'notes', q: '', find: '', pickCountry: '', busy: {} };
  const goals = () => { const g = lsGet(K('goals'), []); return Array.isArray(g) ? g.filter(x => x && x.board) : []; };
  const saveGoals = g => lsSet(K('goals'), g.slice(0, 12));
  const progressAll = () => { const p = lsGet(K('progress'), {}); return p && typeof p === 'object' ? p : {}; };
  const bookmarks = () => { const b = lsGet(K('bookmarks'), []); return Array.isArray(b) ? b : []; };
  const notesAll = () => { const n = lsGet(K('mynotes'), {}); return n && typeof n === 'object' ? n : {}; };
  const textScale = () => { const n = Number(lsGet('sm_cn_text', 1)); return n >= 0.9 && n <= 1.5 ? n : 1; };

  const boardObj = code => { try { return CURRICULUM.getExamBoard(code); } catch (_) { return null; } };
  const subjectNames = code => { try { return CURRICULUM.getSubjects(code).map(s => s.name); } catch (_) { return []; } };
  const topicsFor = (b, s) => listTopics(CURRICULUM, b, s);
  const progFor = (b, s) => progressAll()[topicKey(b, s, '')] || {};
  function setProg(b, s, t, patch) {
    const all = progressAll(); const k = topicKey(b, s, '');
    all[k] = all[k] || {}; all[k][t] = Object.assign({}, all[k][t], patch, { updated: Date.now() });
    lsSet(K('progress'), all);
    lsSet(K('resume'), { board: b, subject: s, topic: t, format: S.format, at: Date.now() });
    // renderTopic() calls this on every render, so only sync when something the cloud stores actually changed
    const sig = (all[k][t].done ? 1 : 0) + '|' + (all[k][t].lastFormat || ''), mk = k + '|' + t;
    if (_pushed[mk] !== sig) { _pushed[mk] = sig; pushProgress(b, s, t, all[k][t]); }
  }
  const isBookmarked = (b, s, t) => bookmarks().some(x => x.key === topicKey(b, s, t));
  const label = code => { const b = boardObj(code); return b ? b.label : code; };
  // display name of a topic in the student's language (canonical English name stays the storage key)
  const tl = (b, sj, name) => { try { const l = (window.SMI18n && window.SMI18n.locale) ? window.SMI18n.locale() : 'en'; return l === 'en' || !window.SMRemote ? name : window.SMRemote.translateTopic(window.CURRICULUM, b, sj, name, l); } catch (_) { return name; } };

  function shell(inner) {
    const el = $('studymaterial-content'); if (!el) return;
    el.innerHTML = `<div class="cn-root" style="--cn-scale:${textScale()}">${inner}</div>`;
    try { SMPresets.refreshSlots(); } catch (_) { }
  }
  const back = (fn, txt) => `<button type="button" class="cn-back" onclick="${fn}">← ${esc(txt)}</button>`;

  function ensureDefaultGoal() {
    const g = goals();
    if (g.length) return g;
    try {
      const code = state.examGoal;
      if (code && code !== 'none' && boardObj(code)) { saveGoals([{ board: code }]); return goals(); }
    } catch (_) { }
    return g;
  }

  function renderHome() {
    S.view = 'home';
    const g = ensureDefaultGoal();
    const resume = lsGet(K('resume'), null);
    const bm = bookmarks();
    shell(`
      ${back('renderStudyMaterialHome()', 'Study Material')}
      <h2 class="cn-title">🎓 Classroom Notes</h2>
      <p class="cn-sub">Notes, quick revision, worked examples and practice for each topic.</p>
      ${resume && boardObj(resume.board) ? `<button type="button" class="ask-btn cn-wide" onclick="SMCN.resume()">▶ Resume: ${esc(resume.topic)} <small>(${esc(resume.subject)})</small></button>` : ''}
      ${(function () { try { if (state.premium) return ''; const l = USAGE_LIMITS.classroomNotes; const left = Math.max(0, l.max - getUsageCount('classroomNotes', l.period)); return `<p class="cn-muted">Free plan: ${left} of ${l.max} new pages left this week. Pages you already generated are free to reread.</p>`; } catch (_) { return ''; } })()}
      <input class="field cn-search" id="cn-search" type="search" aria-label="Search topics" placeholder="Search topics in your exams…" value="${esc(S.q)}" oninput="SMCN.search(this.value)">
      <div id="cn-search-results">${S.q ? searchHtml(S.q) : ''}</div>
      <div class="select-label">Your exam goals</div>
      ${g.length ? g.map((x, i) => `<div class="cn-goal"><button type="button" class="chip" onclick="SMCN.openBoard('${jid(x.board)}')">${esc(label(x.board))}</button><button type="button" class="cn-x" aria-label="Remove ${esc(label(x.board))}" onclick="SMCN.removeGoal(${i})">✕</button></div>`).join('') : '<p class="cn-muted">No exam goal yet. Add one below. You can add several, from any country.</p>'}
      <button type="button" class="action-btn cn-wide" onclick="SMCN.pickGoal()">＋ Add an exam goal</button>
      ${bm.length ? `<div class="select-label">🔖 Bookmarks</div>${(_bmCache = bm.slice(0, 8)).map((b, i) => `<button type="button" class="note-card cn-bm" onclick="SMCN.openHit(${i})"><div class="nc-title">${esc(b.topic)}</div><div class="nc-sub">${esc(b.subject)} · ${esc(label(b.board))}</div></button>`).join('')}` : ''}
    `);
  }

  // Topic names can contain characters that are unsafe in inline handlers, so handlers pass INDEXES, never names.

  function searchHtml(q) {
    const entries = [];
    goals().forEach(gl => subjectNames(gl.board).forEach(s => entries.push({ board: gl.board, subject: s, topics: topicsFor(gl.board, s) })));
    const hits = searchTopics(entries, q);
    _bmCache = hits;
    if (!hits.length) return '<p class="cn-muted">No matching topics in your exam goals.</p>';
    return hits.map((h, i) => `<button type="button" class="note-card cn-bm" onclick="SMCN.openHit(${i})"><div class="nc-title">${esc(h.topic)}</div><div class="nc-sub">${esc(h.subject)} · ${esc(label(h.board))}${h.matchedSubtopics.length ? ' · ' + esc(h.matchedSubtopics.join(', ')) : ''}</div></button>`).join('');
  }

  function pickGoal() {
    const countries = CURRICULUM.getCountries();
    shell(`
      ${back('SMCN.home()', 'Classroom Notes')}
      <h2 class="cn-title">Add an exam goal</h2>
      <p class="cn-sub">Pick any country's exam. Your location never limits you.</p>
      <div class="subject-chips">${countries.map(c => `<button type="button" class="chip${S.pickCountry === c.code ? ' selected' : ''}" onclick="SMCN.pickCountry('${jid(c.code)}')">${esc(c.flag || '')} ${esc(c.name)}</button>`).join('')}</div>
      <div id="cn-boards">${S.pickCountry ? boardsHtml(S.pickCountry) : ''}</div>`);
  }
  function boardsHtml(cc) {
    let boards = []; try { boards = CURRICULUM.getExamBoardsForCountry(cc); } catch (_) { }
    return '<div class="select-label">Exam</div>' + boards.map(b => `<button type="button" class="note-card cn-bm" onclick="SMCN.addGoal('${jid(b.code)}')"><div class="nc-title">${esc(b.label)}</div><div class="nc-sub">${esc(b.hint || '')}${b.topicsNote ? ' · ' + esc(b.topicsNote) : ''}</div></button>`).join('');
  }

  function openBoard(board) {
    S.view = 'subjects'; S.board = board;
    const b = boardObj(board); const subs = subjectNames(board);
    shell(`
      ${back('SMCN.home()', 'Classroom Notes')}
      <h2 class="cn-title">${esc(label(board))}</h2>
      <p class="cn-muted">${esc(provenance(b).warning)}</p>
      <div class="select-label">Subject</div>
      ${subs.length ? subs.map((s, i) => { const t = topicsFor(board, s); const p = summarizeProgress(t, progFor(board, s)); return `<button type="button" class="note-card cn-bm" onclick="SMCN.openSubject(${i})"><div class="nc-title">${esc(s)}</div><div class="nc-sub">${t.length ? `${t.length} topics · ${p.done} done` : 'Topic outline not available yet'}</div></button>`; }).join('') : '<div class="empty-state"><b>No subjects for this exam yet</b><p>StudyMate does not have subject data for it, so nothing is shown rather than guessing.</p></div>'}
    `);
  }

  function openSubject(subject) {
    S.view = 'topics'; S.subject = subject;
    const topics = topicsFor(S.board, subject); const prog = progFor(S.board, subject); const sm = summarizeProgress(topics, prog);
    shell(`
      ${back(`SMCN.openBoard('${jid(S.board)}')`, label(S.board))}
      <h2 class="cn-title">${esc(subject)}</h2>
      <p class="cn-muted">${esc(provenance(boardObj(S.board)).label)} · general outline, not the official syllabus</p>
      <div class="select-label">Study any topic</div>
      <div style="display:flex; gap:8px; margin-bottom:12px;"><input type="text" class="field" id="cn-custom-input" maxlength="80" autocomplete="off" aria-label="Type any topic to study" placeholder="e.g. Osmosis" style="flex:1; min-width:0;" onkeydown="if(event.key==='Enter')SMCN.openCustom(this.value)"><button type="button" class="action-btn" onclick="SMCN.openCustom(document.getElementById('cn-custom-input').value)">Open</button></div>
      <p class="cn-muted cn-prov">${esc(((window.CURRICULUM_SOURCES) ? CURRICULUM_SOURCES.describe(CURRICULUM_SOURCES.get(S.board, subject)) : { text: '' }).text)}</p>
      ${topics.length ? `<button type="button" class="action-btn cn-wide" ${S.busy.dl ? 'disabled' : ''} onclick="SMCN.downloadSubject()">${S.busy.dl ? 'Downloading…' : '⬇ Save available pages for offline'} <small>(${storedPageCount(S.board, subject)} on this device)</small></button>
      <div class="cn-bar" role="progressbar" aria-valuenow="${sm.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${sm.pct}%"></i></div><p class="cn-muted">${sm.done} of ${sm.total} topics completed</p>
      ${topics.map(t => { const p = prog[t.name] || {}; return `<button type="button" class="note-card cn-bm" onclick="SMCN.openTopicIdx(${t.index})"><div class="nc-top"><div class="nc-title">${p.done ? '✅ ' : ''}${esc(tl(S.board, subject, t.name))}</div>${isBookmarked(S.board, subject, t.name) ? '<span class="pill">🔖</span>' : ''}</div><div class="nc-sub">${esc(t.subtopics.slice(0, 4).join(' · '))}</div></button>`; }).join('')}`
      : `<div class="empty-state"><b>No topic outline for ${esc(subject)} yet</b><p>StudyMate won't make up a topic list. Type the topic you want above, or use Ask AI for this subject.</p></div>`}
    `);
  }

  function renderTopic() {
    S.view = 'topic';
    const { board, subject, topic, format } = S;
    const topics = topicsFor(board, subject); let t = topics.find(x => x.name === topic);
    const custom = !t && S.custom && !!topic;                  // a topic the student typed: private, never in the shared cache
    if (custom) t = { name: topic, subtopics: [] };
    if (!t) { openSubject(subject); return; }
    const key = contentKey(board, subject, topic, format); const saved = contentAll()[key];
    const np = custom ? { prev: null, next: null } : nextPrev(topics, topic); const done = !custom && !!(progFor(board, subject)[topic] || {}).done;
    const myNote = notesAll()[topicKey(board, subject, topic)] || '';
    const fmt = FORMATS.find(f => f.id === format);
    const body = saved
      ? `<div class="cn-meta">${esc(format === 'practice' ? PRACTICE_LABEL : (custom ? CUSTOM_LABEL : SOURCE_LABEL))} · saved ${esc(new Date(saved.at).toLocaleDateString())}</div>
         <input class="field cn-find" type="search" aria-label="Search within this page" placeholder="Search in this page…" value="${esc(S.find)}" oninput="SMCN.find(this.value)">
         <div id="cn-matches" class="cn-muted">${S.find ? countMatches(saved.text, S.find) + ' match(es)' : ''}</div>
         <div class="cn-body" id="cn-body">${renderText(saved.text, S.find)}</div>
         ${format === 'practice' ? `<button type="button" class="action-btn cn-wide" onclick="goScreen('practice', null)">🎯 Interactive Practice questions</button>` : ''}
         <button type="button" class="action-btn cn-wide" ${S.busy[key] ? 'disabled' : ''} onclick="SMCN.generate(true)">🔄 Regenerate (uses 1 Classroom Notes page)</button>`
      : `<div class="empty-state"><b>${esc(fmt.title)} for “${esc(topic)}”</b><p>Not generated yet. Generating uses one of your Classroom Notes pages (Free: 2 per week), and the result is saved so you can reread it for free.${custom ? ' Because you typed this topic, the page is just for you.' : ''}</p>
         <button type="button" class="ask-btn" ${S.busy[key] ? 'disabled' : ''} onclick="SMCN.generate(false)">${S.busy[key] ? 'Writing…' : '✨ Generate ' + esc(fmt.title)}</button></div>`;
    shell(`
      ${back('SMCN.toSubject()', subject)}
      <div class="cn-toprow"><h2 class="cn-title">${esc(tl(board, subject, topic))}</h2>
        <div class="cn-tools">
          <button type="button" class="cn-ib" aria-label="Smaller text" onclick="SMCN.size(-0.1)">A−</button>
          <button type="button" class="cn-ib" aria-label="Larger text" onclick="SMCN.size(0.1)">A+</button>
          ${custom ? '' : `<button type="button" class="cn-ib${isBookmarked(board, subject, topic) ? ' on' : ''}" aria-label="Bookmark topic" aria-pressed="${isBookmarked(board, subject, topic)}" onclick="SMCN.bookmark()">🔖</button>`}
        </div></div>
      ${(typeof navigator !== 'undefined' && navigator.onLine === false) ? '<p class="cn-muted cn-offline">Offline: you can read pages saved on this device.</p>' : ''}
      <div class="cn-tabs" role="tablist">${FORMATS.map(f => `<button type="button" role="tab" aria-selected="${f.id === format}" class="cn-tab${f.id === format ? ' on' : ''}" onclick="SMCN.setFormat('${f.id}')"><span>${f.icon}</span>${esc(f.label)}</button>`).join('')}</div>
      ${body}
      ${custom ? '' : `<div class="select-label">My notes on this topic</div>
      <textarea class="field cn-mynote" id="cn-mynote" aria-label="My notes" placeholder="Write your own reminders…" oninput="SMCN.saveNote(this.value)">${esc(myNote)}</textarea>
      <button type="button" class="action-btn cn-wide${done ? ' saved' : ''}" onclick="SMCN.toggleDone()">${done ? '✅ Completed (tap to undo)' : '☑ Mark topic as completed'}</button>`}
      <div class="cn-nav">${np.prev ? `<button type="button" class="action-btn" onclick="SMCN.gotoTopic('prev')">← ${esc(np.prev)}</button>` : '<span></span>'}${np.next ? `<button type="button" class="action-btn" onclick="SMCN.gotoTopic('next')">${esc(np.next)} →</button>` : ''}</div>
    `);
    if (!custom) setProg(board, subject, topic, { lastFormat: format });
  }

  // ---------- shared page cache (server) ----------
  const classroomUrl = () => { try { const u = getAiEndpoint(); return u ? String(u).replace(/\/ask\/?$/, '/classroom') : null; } catch (_) { return null; } };
  /** Asks the server for an already-generated page. Free for the student: no AI call, no quota. null on a miss or any problem. */
  async function fetchShared(parts) {
    const base = classroomUrl(); if (!base || !window.sbAuthSession) return null;
    try {
      const q = new URLSearchParams({ action: 'get', board: parts.board, subject: parts.subject, topic: parts.topic, format: parts.format, lang: parts.lang });
      const r = await fetch(base + '?' + q.toString(), { headers: { Authorization: 'Bearer ' + window.sbAuthSession.access_token } });
      if (!r.ok) return null; const d = await r.json();
      return d && d.found && typeof d.content === 'string' ? d.content : null;
    } catch (_) { return null; }
  }
  function saveLocal(key, text, source) {
    const all = contentAll(); const entry = { text, at: Date.now(), source }; all[key] = entry;
    const keys = Object.keys(all); let evict = [];
    if (keys.length > MAX_SAVED) { evict = keys.sort((a, c) => all[a].at - all[c].at).slice(0, keys.length - MAX_SAVED); evict.forEach(k => delete all[k]); }
    return persistContent(key, entry, evict);
  }

  /** "Save for offline": downloads pages other students already generated for this subject. No AI call, no quota. */
  async function downloadSubject() {
    const { board, subject } = S; const base = classroomUrl();
    if (!base || !window.sbAuthSession) { toast('Sign in to save pages for offline reading.'); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { toast('You are offline.'); return; }
    if (S.busy.dl) return; S.busy.dl = true; let saved = 0, offset = 0;
    const topics = topicsFor(board, subject); const lang = (typeof state !== 'undefined' && state.language) || 'en';
    try {
      for (let guard = 0; guard < 30 && offset !== null; guard++) {
        const q = new URLSearchParams({ action: 'list', board, subject, lang: /^[a-z]{2}$/.test(lang) ? lang : 'en', offset: String(offset) });
        const r = await fetch(base + '?' + q.toString(), { headers: { Authorization: 'Bearer ' + window.sbAuthSession.access_token } });
        if (!r.ok) break; const d = await r.json();
        (d.pages || []).forEach(pg => {
          const t = topics.find(x => x.name === pg.topic); if (!t || !FORMAT_IDS.includes(pg.format)) return;
          const v = validateGenerated(pg.content, { topic: t.name, subtopics: t.subtopics });
          if (v.ok) { saveLocal(contentKey(board, subject, pg.topic, pg.format), v.text, pg.format === 'practice' ? 'ai-practice' : 'ai-generated'); saved++; }
        });
        offset = d.next === null || d.next === undefined ? null : d.next;
      }
      toast(saved ? saved + ' page(s) saved for offline reading.' : 'No shared pages are available for this subject yet.');
    } catch (_) { toast('Could not download right now.'); }
    finally { delete S.busy.dl; if (S.view === 'topics') openSubject(subject); }
  }

  async function generate(force) {
    const { board, subject, topic, format } = S; const key = contentKey(board, subject, topic, format);
    if (S.busy[key]) return;                                   // request de-duplication: one in flight per item
    if (!force && contentAll()[key]) { renderTopic(); return; } // never pay twice for text already saved
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { toast('You are offline. Pages you already saved can still be read.'); return; }
    const custom = S.custom && !topicsFor(board, subject).some(x => x.name === topic);
    const t = topicsFor(board, subject).find(x => x.name === topic) || (custom ? { name: topic, subtopics: [] } : null);
    const b = boardObj(board);
    const lang = (typeof state !== 'undefined' && state.language) || 'en';
    const ctx = t ? { subject, topic, subtopics: t.subtopics, boardLabel: b && b.label, level: b && b.level, language: lang } : null;
    const prompt = ctx ? buildPrompt(format, ctx) : null;
    if (!prompt) { toast('No topic outline for this subject, so nothing can be generated.'); return; }
    const parts = { board, subject, topic, format, lang: /^[a-z]{2}$/.test(lang) ? lang : 'en' };
    S.busy[key] = true; renderTopic();
    try {
      // 1) shared cache first: free, instant, and works even when this student has used their weekly pages
      if (!force && !custom) {                                   // typed topics never touch the shared cache
        const shared = await fetchShared(parts);
        if (shared) {
          const v = validateGenerated(shared, { topic, subtopics: t.subtopics });
          if (v.ok) { saveLocal(key, v.text, format === 'practice' ? 'ai-practice' : 'ai-generated'); return; }
        }
      }
      // 2) otherwise generate (counts against the weekly allowance); the server re-checks the cache and builds its own prompt
      try { if (checkAndBlockIfLimited('classroomNotes', 'Classroom Notes pages')) return; } catch (_) { }
      const raw = await callAskApi(prompt, 'classroomNotes', custom ? { regenerate: !!force } : { classroom: parts, regenerate: !!force });
      const v = validateGenerated(String(raw || ''), { topic, subtopics: t.subtopics });   // LaTeX kept: math-render.js typesets it
      if (!v.ok) { toast('The AI reply was not usable (' + v.reason + '). Nothing was saved. Try again.'); }
      else if (!saveLocal(key, v.text, format === 'practice' ? 'ai-practice' : 'ai-generated')) toast('Could not save on this device (storage full).');
    } catch (e) {
      // callAskApi already toasts FREE_LIMIT_REACHED / PREMIUM_REQUIRED. Say plainly otherwise; no fake content.
      if (!(e && (e.code === 'FREE_LIMIT_REACHED' || e.code === 'PREMIUM_REQUIRED'))) toast((e && e.message) || 'The AI could not respond. Please try again.');
    } finally { delete S.busy[key]; if (S.view === 'topic') renderTopic(); }
  }

  // ---------- offline page store (IndexedDB, in-memory mirror) ----------
  // Saved pages live in IndexedDB so a whole subject can be kept on the phone (localStorage's ~5 MB is too small), and reading works with
  // no network. The in-memory mirror keeps renderTopic() synchronous. If IndexedDB is unavailable it falls back to localStorage.
  const MEM = {}; let storeReady = Promise.resolve(); let idb = null;
  function idbOpen() {
    return new Promise(res => {
      try {
        const q = indexedDB.open('sm_classroom_notes', 1);
        q.onupgradeneeded = () => { q.result.createObjectStore('content', { keyPath: 'k' }); };
        q.onsuccess = () => res(q.result); q.onerror = () => res(null); q.onblocked = () => res(null);
      } catch (_) { res(null); }
    });
  }
  const idbAll = db => new Promise(res => { try { const r = db.transaction('content').objectStore('content').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); } catch (_) { res([]); } });
  const idbPut = (db, row) => { try { db.transaction('content', 'readwrite').objectStore('content').put(row); } catch (_) { } };
  const idbDel = (db, k) => { try { db.transaction('content', 'readwrite').objectStore('content').delete(k); } catch (_) { } };
  function loadStore() {
    const u = uid();
    storeReady = (async () => {
      MEM[u] = MEM[u] || {};
      if (!idb) idb = await idbOpen();
      const legacy = lsGet(K('content'), null);                       // pages saved by the first release (localStorage)
      if (idb) {
        (await idbAll(idb)).forEach(r => { if (r.k.indexOf(u + '::') === 0) MEM[u][r.k.slice(u.length + 2)] = { text: r.text, at: r.at, source: r.source }; });
        if (legacy && typeof legacy === 'object') { Object.keys(legacy).forEach(k => { if (!MEM[u][k]) { MEM[u][k] = legacy[k]; idbPut(idb, { k: u + '::' + k, text: legacy[k].text, at: legacy[k].at, source: legacy[k].source }); } }); try { localStorage.removeItem(K('content')); } catch (_) { } }
      } else if (legacy) MEM[u] = Object.assign({}, legacy, MEM[u]);
      return true;
    })();
    return storeReady;
  }
  const contentAll = () => { const u = uid(); return MEM[u] || (MEM[u] = (lsGet(K('content'), {}) || {})); };
  function persistContent(key, entry, evictKeys) {
    const u = uid();
    if (idb) { idbPut(idb, { k: u + '::' + key, text: entry.text, at: entry.at, source: entry.source }); (evictKeys || []).forEach(k => idbDel(idb, u + '::' + k)); return true; }
    return lsSet(K('content'), contentAll());                          // fallback
  }
  const storedPageCount = (board, subject) => Object.keys(contentAll()).filter(k => k.indexOf(board + '|' + subject + '|') === 0).length;

  // ---------- cloud sync (optional layer over localStorage) ----------
  // Needs supabase-schema-18-classroom-notes.sql. Until that is applied every call fails softly and the feature keeps working
  // on this device. Only goals, progress, bookmarks and the student's OWN notes sync. AI-generated text is never uploaded.
  // Row-level security (user_id = auth.uid()) is the real protection; the .eq('user_id') filters are belt and braces.
  const CLOUD = { off: false, last: 0 };
  const TABLES = ['cn_exam_goals', 'cn_topic_progress', 'cn_bookmarks', 'cn_notes'];
  const sbc = () => (window.sbClient && typeof window.sbClient.from === 'function') ? window.sbClient : null;
  const cloudUid = () => { try { return state.activeUserId || null; } catch (_) { return null; } };
  const okLen = (subject, topic) => String(subject || '').length <= 120 && String(topic || '').length <= 160;
  function cloudFail(err) {
    if (!err) return false;
    const msg = String(err.message || '') + ' ' + String(err.code || '');
    if (/42P01|PGRST205|does not exist|schema cache|404/i.test(msg)) CLOUD.off = true;   // schema 18 not applied yet: stay local
    return true;
  }
  async function cloudDo(fn) {
    const c = sbc(), u = cloudUid();
    if (!c || !u || CLOUD.off) return null;
    try { const r = await fn(c, u); if (r && cloudFail(r.error)) return null; return r || null; } catch (e) { cloudFail(e); return null; }
  }
  const pushGoal = b => cloudDo((c, u) => c.from('cn_exam_goals').upsert({ user_id: u, board_code: b }));
  const dropGoal = b => cloudDo((c, u) => c.from('cn_exam_goals').delete().eq('user_id', u).eq('board_code', b));
  const pushProgress = (b, sj, t, p) => okLen(sj, t) ? cloudDo((c, u) => c.from('cn_topic_progress').upsert({ user_id: u, board_code: b, subject: sj, topic: t, done: !!p.done, last_format: FORMAT_IDS.includes(p.lastFormat) ? p.lastFormat : null, updated_at: new Date(p.updated || Date.now()).toISOString() })) : null;
  const pushBookmark = (b, sj, t) => okLen(sj, t) ? cloudDo((c, u) => c.from('cn_bookmarks').upsert({ user_id: u, board_code: b, subject: sj, topic: t })) : null;
  const dropBookmark = (b, sj, t) => cloudDo((c, u) => c.from('cn_bookmarks').delete().eq('user_id', u).eq('board_code', b).eq('subject', sj).eq('topic', t));
  const noteTimers = {};
  function pushNote(b, sj, t, body) {
    if (!okLen(sj, t)) return;
    const k = topicKey(b, sj, t); clearTimeout(noteTimers[k]);
    noteTimers[k] = setTimeout(() => cloudDo((c, u) => body.trim()
      ? c.from('cn_notes').upsert({ user_id: u, board_code: b, subject: sj, topic: t, body: body.slice(0, 5000), updated_at: new Date().toISOString() })
      : c.from('cn_notes').delete().eq('user_id', u).eq('board_code', b).eq('subject', sj).eq('topic', t)), 900);
  }

  /** Pull + merge. Union for goals and bookmarks; newest wins for progress and notes. Local-only data is pushed up. */
  async function pull() {
    if (!sbc() || !cloudUid() || CLOUD.off || Date.now() - CLOUD.last < 3000) return false;
    CLOUD.last = Date.now();
    const u = cloudUid(); const get = t => sbc().from(t).select('*').eq('user_id', u).limit(1000);
    let res; try { res = await Promise.all(TABLES.map(get)); } catch (e) { cloudFail(e); return false; }
    if (res.some(r => r && cloudFail(r.error)) || res.some(r => !r || r.error)) return false;
    const [g, p, b, n] = res.map(r => r.data || []);
    // goals
    const goalsL = goals(); let gChanged = false;
    g.forEach(r => { if (boardObj(r.board_code) && !goalsL.some(x => x.board === r.board_code)) { goalsL.push({ board: r.board_code }); gChanged = true; } });
    if (gChanged) saveGoals(goalsL);
    goalsL.forEach(x => { if (!g.some(r => r.board_code === x.board)) pushGoal(x.board); });
    // progress (newest wins)
    const prog = progressAll(); let pChanged = false;
    p.forEach(r => {
      const k = topicKey(r.board_code, r.subject, ''); prog[k] = prog[k] || {};
      const loc = prog[k][r.topic]; const rt = Date.parse(r.updated_at) || 0;
      if (!loc || (loc.updated || 0) < rt) { prog[k][r.topic] = Object.assign({}, loc, { done: !!r.done, lastFormat: r.last_format || (loc && loc.lastFormat), updated: rt }); pChanged = true; }
    });
    if (pChanged) lsSet(K('progress'), prog);
    // bookmarks (union)
    let bl = bookmarks(); let bChanged = false;
    b.forEach(r => { const key = topicKey(r.board_code, r.subject, r.topic); if (!bl.some(x => x.key === key)) { bl.push({ key, board: r.board_code, subject: r.subject, topic: r.topic }); bChanged = true; } });
    if (bChanged) lsSet(K('bookmarks'), bl.slice(0, 100));
    bl.forEach(x => { if (!b.some(r => topicKey(r.board_code, r.subject, r.topic) === x.key)) pushBookmark(x.board, x.subject, x.topic); });
    // notes (newest wins)
    const nl = notesAll(), nts = lsGet(K('mynotes_ts'), {}); let nChanged = false;
    n.forEach(r => { const k = topicKey(r.board_code, r.subject, r.topic), rt = Date.parse(r.updated_at) || 0; if (!nl[k] || (nts[k] || 0) < rt) { nl[k] = String(r.body || '').slice(0, 5000); nts[k] = rt; nChanged = true; } });
    if (nChanged) { lsSet(K('mynotes'), nl); lsSet(K('mynotes_ts'), nts); }
    if (gChanged || pChanged || bChanged || nChanged) { if (S.view === 'home') renderHome(); }
    return true;
  }

  // ---------- curriculum rename migration ----------
  // When a syllabus import replaces a curated list it ships an alias map (old topic name -> new name, or null = archived).
  // Student data saved under an old name is moved to the new name here (local + cloud). Null/unknown names are left alone.
  const canon = (b, sj, t) => { try { return CURRICULUM.canonicalTopic ? CURRICULUM.canonicalTopic(b, sj, t) : t; } catch (_) { return t; } };
  function migrateAliases() {
    let moved = 0; const cloudMoves = [];
    // progress: { 'board|subject|': { topic: {...} } }
    const prog = progressAll();
    Object.keys(prog).forEach(k => {
      const [b, sj] = k.split('|');
      Object.keys(prog[k] || {}).forEach(t => {
        const n = canon(b, sj, t);
        if (n && n !== t) {
          const old = prog[k][t], cur = prog[k][n];
          if (!cur || (cur.updated || 0) < (old.updated || 0)) prog[k][n] = old;
          delete prog[k][t]; moved++; cloudMoves.push({ kind: 'progress', b, sj, from: t, to: n, row: prog[k][n] });
        }
      });
    });
    if (moved) lsSet(K('progress'), prog);
    // bookmarks
    let bl = bookmarks(), bch = false;
    bl = bl.map(x => { const n = canon(x.board, x.subject, x.topic); if (n && n !== x.topic) { bch = true; cloudMoves.push({ kind: 'bookmark', b: x.board, sj: x.subject, from: x.topic, to: n }); return { key: topicKey(x.board, x.subject, n), board: x.board, subject: x.subject, topic: n }; } return x; });
    const seen = new Set(); bl = bl.filter(x => (seen.has(x.key) ? false : (seen.add(x.key), true)));
    if (bch) { lsSet(K('bookmarks'), bl); moved++; }
    // my notes
    const nl = notesAll(), nts = lsGet(K('mynotes_ts'), {}); let nch = false;
    Object.keys(nl).forEach(k => { const [b, sj, t] = k.split('|'); const n = canon(b, sj, t); if (n && n !== t) { const nk = topicKey(b, sj, n); if (!nl[nk]) { nl[nk] = nl[k]; nts[nk] = nts[k] || Date.now(); } delete nl[k]; delete nts[k]; nch = true; cloudMoves.push({ kind: 'note', b, sj, from: t, to: n, body: nl[nk] }); } });
    if (nch) { lsSet(K('mynotes'), nl); lsSet(K('mynotes_ts'), nts); moved++; }
    // resume pointer
    const r = lsGet(K('resume'), null);
    if (r && r.board) { const n = canon(r.board, r.subject, r.topic); if (n === null) lsSet(K('resume'), null); else if (n !== r.topic) lsSet(K('resume'), Object.assign({}, r, { topic: n })); }
    // cloud: write the new row, delete the old row (best effort; never blocks the UI)
    cloudMoves.forEach(m => {
      if (m.kind === 'progress') { pushProgress(m.b, m.sj, m.to, m.row || {}); cloudDo((c, u) => c.from('cn_topic_progress').delete().eq('user_id', u).eq('board_code', m.b).eq('subject', m.sj).eq('topic', m.from)); }
      else if (m.kind === 'bookmark') { pushBookmark(m.b, m.sj, m.to); dropBookmark(m.b, m.sj, m.from); }
      else if (m.kind === 'note') { pushNote(m.b, m.sj, m.to, m.body || ''); cloudDo((c, u) => c.from('cn_notes').delete().eq('user_id', u).eq('board_code', m.b).eq('subject', m.sj).eq('topic', m.from)); }
    });
    return moved;
  }

  const api2 = {
    home: renderHome,
    open() { S.q = ''; migrateAliases(); renderHome(); loadStore(); pull().then(ok => { if (ok) migrateAliases(); }); },
    downloadSubject,
    migrateAliases,
    pull,
    /** For the Home "Continue" card: the last topic opened (null if none, or if its exam board no longer exists). */
    resumeInfo() { const r = lsGet(K('resume'), null); if (!r || typeof r !== 'object' || typeof r.topic !== 'string' || typeof r.subject !== 'string' || !boardObj(r.board)) return null; return { topic: r.topic, subject: r.subject, at: Number(r.at) || 0 }; },
    resume() { const r = lsGet(K('resume'), null); if (!r || !boardObj(r.board)) return; S.custom = false; S.board = r.board; S.subject = r.subject; S.topic = r.topic; S.format = FORMAT_IDS.includes(r.format) ? r.format : 'notes'; S.find = ''; renderTopic(); },
    search(v) { S.q = v; const el = $('cn-search-results'); if (el) el.innerHTML = v ? searchHtml(v) : ''; },
    openHit(i) { const h = _bmCache[i]; if (!h) return; S.custom = false; S.board = h.board; S.subject = h.subject; S.topic = h.topic; S.find = ''; renderTopic(); },
    pickGoal, pickCountry(c) { S.pickCountry = c; pickGoal(); },
    addGoal(b) { if (!boardObj(b)) return; const g = goals(); if (!g.some(x => x.board === b)) { g.push({ board: b }); saveGoals(g); pushGoal(b); } renderHome(); },
    removeGoal(i) { const g = goals(); const gone = g.splice(i, 1)[0]; saveGoals(g); if (gone) dropGoal(gone.board); renderHome(); },
    openBoard,
    openSubject(i) { const n = subjectNames(S.board)[i]; if (n) openSubject(n); },
    toSubject() { openSubject(S.subject); },
    /** Study ANY topic the student types. Matching a curriculum topic opens that topic normally; otherwise it is a private page. */
    openCustom(v) {
      const raw = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>`{}\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!raw) { toast('Type a topic first.'); return; }
      const name = (typeof canonicalTypedTopic === 'function') ? canonicalTypedTopic(S.subject, raw) : raw;
      S.topic = name; S.custom = !topicsFor(S.board, S.subject).some(x => x.name === name); S.find = ''; renderTopic();
    },
    openTopicIdx(i) { const t = topicsFor(S.board, S.subject)[i]; if (!t) return; S.custom = false; S.topic = t.name; S.find = ''; renderTopic(); },
    setFormat(f) { if (!FORMAT_IDS.includes(f)) return; S.format = f; S.find = ''; renderTopic(); },
    gotoTopic(dir) { const np = nextPrev(topicsFor(S.board, S.subject), S.topic); const n = dir === 'prev' ? np.prev : np.next; if (n) { S.topic = n; S.find = ''; renderTopic(); window.scrollTo(0, 0); } },
    generate,
    find(v) { S.find = v; const k = contentKey(S.board, S.subject, S.topic, S.format); const s = contentAll()[k]; const el = $('cn-body'); if (el && s) el.innerHTML = renderText(s.text, v); const m = $('cn-matches'); if (m) m.textContent = v ? countMatches(s ? s.text : '', v) + ' match(es)' : ''; },
    size(d) { lsSet('sm_cn_text', Math.min(1.5, Math.max(0.9, Math.round((textScale() + d) * 10) / 10))); renderTopic(); },
    bookmark() { const key = topicKey(S.board, S.subject, S.topic); let b = bookmarks(); if (b.some(x => x.key === key)) { b = b.filter(x => x.key !== key); dropBookmark(S.board, S.subject, S.topic); } else { b.unshift({ key, board: S.board, subject: S.subject, topic: S.topic }); pushBookmark(S.board, S.subject, S.topic); } lsSet(K('bookmarks'), b.slice(0, 100)); renderTopic(); },
    toggleDone() { const p = progFor(S.board, S.subject)[S.topic] || {}; setProg(S.board, S.subject, S.topic, { done: !p.done }); renderTopic(); },
    saveNote(v) { const all = notesAll(); const k = topicKey(S.board, S.subject, S.topic); const ts = lsGet(K('mynotes_ts'), {}); if (v.trim()) all[k] = v.slice(0, 5000); else delete all[k]; ts[k] = Date.now(); lsSet(K('mynotes'), all); lsSet(K('mynotes_ts'), ts); pushNote(S.board, S.subject, S.topic, v); }
  };
  Object.assign(api, api2);
  return api;
});
