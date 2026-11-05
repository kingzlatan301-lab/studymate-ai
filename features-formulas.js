/** StudyMate AI — Formula Book + Scientific Calculator UI (see features.js header). */
(function () {
  'use strict';
  const SMF = window.SMF = window.SMF || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => { try { return state.activeUserId || 'anon'; } catch (_) { return 'anon'; } };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } };
  // Stored values can be corrupted or edited: always validate the shape before use.
  const lsArr = (k) => { const v = lsGet(k, []); return Array.isArray(v) ? v : []; };
  const lsNum = (k) => { const v = lsGet(k, 0); return typeof v === 'number' && Number.isFinite(v) ? v : 0; };
  const toast = m => { try { showToast(m); } catch (_) { } };
  const copy = async t => { try { if (typeof copyTextToClipboard === 'function') return await copyTextToClipboard(t); } catch (_) { } try { await navigator.clipboard.writeText(t); return true; } catch (_) { return false; } };
  const Calc = () => window.SMCalc;
  const jid = v => String(v == null ? '' : v).replace(/[^A-Za-z0-9_:.\-]/g, '');

  // ═══════════════════════════ FORMULA BOOK ═══════════════════════════
  const FB = { subject: 'All', tab: 'browse', q: '', open: null, limit: 30, loading: false, failed: false };
  const SUBJ_ICON = { Mathematics: '➗', 'Further Mathematics': '∑', Physics: '⚛️', Chemistry: '🧪' };
  const favKey = () => 'sm_fav_formulas:' + uid(), recKey = () => 'sm_recent_formulas:' + uid();
  const favs = () => lsArr(favKey()).filter(x => typeof x === 'string'), recents = () => lsArr(recKey()).filter(x => typeof x === 'string');

  function loadData(cb) {
    if (window.SM_FORMULAS) return cb(true);
    if (FB.loading) return;
    FB.loading = true;
    const s = document.createElement('script'); s.src = 'formula-data.js';
    s.onload = () => { FB.loading = false; cb(!!window.SM_FORMULAS); };
    s.onerror = () => { FB.loading = false; cb(false); };
    document.head.appendChild(s);
  }

  // Normalised search over name, topic, subtopic, tags, symbols and the expression text.
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  function searchFormulas(q, subject) {
    let L = window.SM_FORMULAS || [];
    if (subject && subject !== 'All') L = L.filter(f => f.s === subject);
    const raw = String(q || '').trim();
    if (!raw) return L;
    const nq = norm(raw), toks = nq.split(/\s+/).filter(Boolean);
    const out = [];
    L.forEach(f => {
      const name = norm(f.n), topic = norm(f.t + ' ' + f.st + ' ' + f.s), tags = norm((f.tags || []).join(' '));
      const syms = f.y.map(r => r[0]).join(' ') + ' ' + f.y.map(r => r[1]).join(' ');
      const ns = norm(syms), x = norm(f.x), w = norm(f.w);
      let score = 0, all = true;
      toks.forEach(t => {
        let s = 0;
        if (name === t) s = 12; else if (name.startsWith(t)) s = 9; else if (name.includes(t)) s = 7;
        else if (topic.includes(t)) s = 5; else if (tags.includes(t)) s = 4;
        else if (f.y.some(r => norm(r[0]).split(/[,\s]+/).includes(t) || norm(r[0]) === t)) s = 6;   // exact symbol, e.g. "ρ" or "ΔT"
        else if (ns.includes(t)) s = 3; else if (x.includes(t)) s = 2; else if (w.includes(t)) s = 1;
        if (!s) all = false; score += s;
      });
      if (all && score) out.push({ f, score });
    });
    out.sort((a, b) => b.score - a.score || a.f.n.localeCompare(b.f.n));
    return out.map(o => o.f);
  }
  SMF.searchFormulas = searchFormulas;

  SMF.openFormulas = function (formulaId) {
    const el = $('formulas-content'); if (!el) return;
    el.innerHTML = '<div class="sm-empty">Loading formulas…</div>';
    loadData(ok => {
      if (!ok) { el.innerHTML = '<div class="sm-err">Couldn’t load the Formula Book. Check your connection and <button class="sm-link" onclick="SMF.openFormulas()">try again</button>.</div>'; return; }
      if (formulaId) FB.open = formulaId;
      renderFB();
    });
  };

  function markRecent(id) { const r = recents().filter(x => x !== id); r.unshift(id); lsSet(recKey(), r.slice(0, 15)); }
  SMF.fbOpen = function (id) { FB.open = id; markRecent(id); renderFB(); const s = $('screen-formulas'); if (s) s.scrollTop = 0; window.scrollTo && window.scrollTo(0, 0); };
  SMF.fbBack = function () { FB.open = null; renderFB(); };
  SMF.fbSubject = function (s) { FB.subject = s; FB.limit = 30; renderFB(); };
  SMF.fbTab = function (t) { FB.tab = t; FB.limit = 30; renderFB(); };
  SMF.fbMore = function () { FB.limit += 30; renderFB(true); };
  let fbTimer = null;
  SMF.fbQuery = function (v) { FB.q = v; FB.limit = 30; clearTimeout(fbTimer); fbTimer = setTimeout(() => renderFB(true, true), 120); };
  SMF.fbFav = function (id) {
    const f = favs(), i = f.indexOf(id);
    if (i >= 0) { f.splice(i, 1); toast('Removed from favourites'); } else { f.unshift(id); toast('Added to favourites'); }
    lsSet(favKey(), f); renderFB(true);
  };
  SMF.fbCopy = async function (id) {
    const f = (window.SM_FORMULAS || []).find(x => x.id === id); if (!f) return;
    toast((await copy(f.n + ': ' + f.x)) ? 'Formula copied' : 'Couldn’t copy — select the formula and copy it manually');
  };

  function rowHtml(f) {
    const fav = favs().includes(f.id);
    return `<button type="button" class="fb-row" onclick="SMF.fbOpen('${jid(f.id)}')"><span class="fb-row-main"><b>${esc(f.n)}</b><span class="fb-x">${esc(f.x)}</span></span><span class="fb-row-meta">${fav ? '<i class="fb-star" aria-label="Favourite">★</i>' : ''}${f.k ? '<i class="fb-calc" title="Calculator available">🧮</i>' : ''}</span></button>`;
  }

  function renderFB(keepFocus, fromSearch) {
    const el = $('formulas-content'); if (!el || !window.SM_FORMULAS) return;
    if (FB.open) { el.innerHTML = detailHtml(FB.open); return; }
    const all = window.SM_FORMULAS;
    const subjects = ['All'].concat(Array.from(new Set(all.map(f => f.s))));
    let list, heading = '';
    if (FB.tab === 'fav') { const ids = favs(); list = ids.map(id => all.find(f => f.id === id)).filter(Boolean).filter(f => FB.subject === 'All' || f.s === FB.subject); }
    else if (FB.tab === 'recent') { list = recents().map(id => all.find(f => f.id === id)).filter(Boolean).filter(f => FB.subject === 'All' || f.s === FB.subject); }
    else list = searchFormulas(FB.q, FB.subject);
    if ((FB.tab === 'fav' || FB.tab === 'recent') && FB.q) list = list.filter(f => searchFormulas(FB.q, FB.subject).includes(f));
    const shown = list.slice(0, FB.limit);
    let body = '';
    if (!shown.length) {
      body = FB.tab === 'fav' ? '<div class="sm-empty"><div class="e-ic">☆</div>No favourites yet.<br>Open a formula and tap ☆ to keep it here.</div>'
        : FB.tab === 'recent' ? '<div class="sm-empty"><div class="e-ic">🕘</div>Formulas you open will appear here.</div>'
        : `<div class="sm-empty"><div class="e-ic">🔍</div>No formulas match “${esc(FB.q)}”.<br><small>Try a topic (e.g. “circular motion”), a name, or a symbol like ρ or ΔT.</small></div>`;
    } else if (FB.tab === 'browse' && !FB.q.trim()) {
      let cur = '';
      shown.forEach(f => { const g = f.s + ' › ' + f.t; if (g !== cur) { cur = g; body += `<div class="fb-group">${FB.subject === 'All' ? esc(f.s) + ' · ' : ''}${esc(f.t)}</div>`; } body += rowHtml(f); });
    } else body = shown.map(rowHtml).join('');
    const more = list.length > shown.length ? `<button class="sm-btn ghost" onclick="SMF.fbMore()">Show more (${list.length - shown.length} left)</button>` : '';
    const html = `
      <div class="scr-head"><span class="ic" style="--ci:var(--sm-c2)">∑</span><div><h1>Formula Book</h1><p>${all.length} formulas · search by name, topic or symbol</p></div></div>
      <div class="sm-search"><input id="fb-q" type="search" inputmode="search" autocomplete="off" placeholder="Search e.g. “quadratic”, “ρ”, “pressure”…" aria-label="Search formulas" value="${esc(FB.q)}" oninput="SMF.fbQuery(this.value)"></div>
      <div class="sm-chips" role="tablist" aria-label="Subject">${subjects.map(s => `<button class="sm-chip${FB.subject === s ? ' on' : ''}" role="tab" aria-selected="${FB.subject === s}" data-s="${esc(s)}" onclick="SMF.fbSubject(this.dataset.s)">${SUBJ_ICON[s] || ''} ${esc(s)}</button>`).join('')}</div>
      <div class="sm-tabs"><button class="${FB.tab === 'browse' ? 'on' : ''}" onclick="SMF.fbTab('browse')">Browse</button><button class="${FB.tab === 'fav' ? 'on' : ''}" onclick="SMF.fbTab('fav')">★ Favourites</button><button class="${FB.tab === 'recent' ? 'on' : ''}" onclick="SMF.fbTab('recent')">Recent</button></div>
      <div id="fb-list" aria-live="polite">${body}${more}</div>
      <p class="sm-note">Formulas are standard textbook relationships written for StudyMate. Entries marked ⚠ use conventions that differ between courses — check with your teacher or textbook.</p>`;
    if (fromSearch) { const l = $('fb-list'); if (l) { l.innerHTML = body + more; return; } }
    el.innerHTML = html;
    if (keepFocus && FB.q) { const i = $('fb-q'); if (i) { i.focus(); const n = i.value.length; try { i.setSelectionRange(n, n); } catch (_) { } } }
  }

  function detailHtml(id) {
    const f = (window.SM_FORMULAS || []).find(x => x.id === id);
    if (!f) return '<div class="sm-err">Formula not found.</div>';
    const fav = favs().includes(f.id);
    const syms = f.y.map(r => `<tr><td class="sy">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="un">${esc(r[2] || '—')}</td></tr>`).join('');
    const ex = f.ex ? `<div class="fb-sec"><h3>Worked example</h3><p><b>${esc(f.ex.p)}</b></p>${(f.ex.t || []).map((t, i) => `<div class="fb-step"><span>${i + 1}</span>${esc(t)}</div>`).join('')}</div>` : '';
    return `
      <button class="sm-back" onclick="SMF.fbBack()">‹ Formula Book</button>
      <div class="fb-detail">
        <div class="fb-path">${esc(f.s)} › ${esc(f.t)} › ${esc(f.st)}</div>
        <h2>${esc(f.n)}</h2>
        <div class="fb-expr" role="math" aria-label="${esc(f.x)}">${esc(f.x)}</div>
        <div class="fb-actions">
          <button class="sm-btn" onclick="SMF.fbFav('${jid(f.id)}')" aria-pressed="${fav}">${fav ? '★ Favourited' : '☆ Favourite'}</button>
          <button class="sm-btn" onclick="SMF.fbCopy('${jid(f.id)}')">⧉ Copy</button>
          ${f.k ? `<button class="sm-btn primary" onclick="SMF.useInCalculator('${jid(f.id)}')">🧮 Use in Calculator</button>` : ''}
        </div>
        ${f.rv ? `<div class="fb-warn">⚠ Review note: ${esc(f.rv)}</div>` : ''}
        <div class="fb-sec"><h3>What it calculates</h3><p>${esc(f.w)}</p></div>
        <div class="fb-sec"><h3>Symbols</h3><div class="fb-tw"><table class="fb-tbl"><thead><tr><th>Symbol</th><th>Meaning</th><th>Unit</th></tr></thead><tbody>${syms}</tbody></table></div></div>
        ${f.c ? `<div class="fb-sec"><h3>Conditions</h3><p>${esc(f.c)}</p></div>` : ''}
        ${f.u ? `<div class="fb-sec"><h3>Units</h3><p>${esc(f.u)}</p></div>` : ''}
        ${f.r && f.r.length ? `<div class="fb-sec"><h3>Rearranged</h3>${f.r.map(r => `<div class="fb-re">${esc(r)}</div>`).join('')}</div>` : ''}
        ${ex}
        ${f.tags && f.tags.length ? `<div class="fb-tags">${f.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  // ═══════════════════════════ SCIENTIFIC CALCULATOR ═══════════════════════════
  const CS = { angle: 'DEG', ans: 0, hasAns: false, memory: 0, formula: null, histOpen: false, fracOn: false, justEq: false };
  const histKey = () => 'sm_calc_hist:' + uid();
  const memKey = () => 'sm_calc_mem:' + uid();
  const history = () => lsArr(histKey()).filter(x => x && typeof x.e === 'string' && typeof x.r === 'string' && Number.isFinite(x.v));

  const KEYS = [
    ['fn', 'sin', 'sin('], ['fn', 'cos', 'cos('], ['fn', 'tan', 'tan('], ['fn', 'ln', 'ln('], ['fn', 'log', 'log('],
    ['fn', 'sin⁻¹', 'asin('], ['fn', 'cos⁻¹', 'acos('], ['fn', 'tan⁻¹', 'atan('], ['fn', '√', '√('], ['fn', '∛', 'cbrt('],
    ['fn', 'x²', '²'], ['fn', 'xʸ', '^'], ['fn', 'n!', '!'], ['fn', '%', '%'], ['fn', 'a/b', 'FRAC'],
    ['fn', 'π', 'π'], ['fn', 'e', 'e'], ['fn', '(', '('], ['fn', ')', ')'], ['fn', 'Ans', 'Ans'],
    ['num', '7', '7'], ['num', '8', '8'], ['num', '9', '9'], ['op', '÷', '÷'], ['clr', '⌫', 'BS'],
    ['num', '4', '4'], ['num', '5', '5'], ['num', '6', '6'], ['op', '×', '×'], ['clr', 'AC', 'AC'],
    ['num', '1', '1'], ['num', '2', '2'], ['num', '3', '3'], ['op', '−', '−'], ['fn', '×10ˣ', '×10^'],
    ['num', '0', '0'], ['num', '.', '.'], ['fn', '±', 'NEG'], ['op', '+', '+'], ['eq', '=', 'EQ']
  ];

  SMF.openCalculator = function () {
    const el = $('calculator-content'); if (!el) return;
    if (!window.SMCalc) { el.innerHTML = '<div class="sm-err">Calculator failed to load. Reload the app and try again.</div>'; return; }
    if (el.dataset.ready !== '1') { buildCalc(el); el.dataset.ready = '1'; }
    CS.memory = lsNum(memKey()); updateMemInd();   // per account, re-read on every open (account may have changed)
    renderFormulaPanel(); renderHistory(); refreshPreview();
  };

  SMF.useInCalculator = function (id) {
    const go = () => {
      const f = (window.SM_FORMULAS || []).find(x => x.id === id);
      if (!f || !f.k) { toast('No calculator version of this formula yet'); return; }
      CS.formula = f; if (f.k.ang) CS.angle = f.k.ang;
      markRecentCalc(id);
      goScreen('calculator', null);
      const el = $('calculator-content'); if (el) { updateAngleBtn(); renderFormulaPanel(); const p = $('calc-formula'); if (p) p.scrollIntoView({ block: 'nearest' }); const first = p && p.querySelector('input'); if (first) first.focus(); }
    };
    if (window.SM_FORMULAS) go(); else loadData(ok => ok ? go() : toast('Couldn’t load that formula'));
  };
  function markRecentCalc(id) { const r = recents().filter(x => x !== id); r.unshift(id); lsSet(recKey(), r.slice(0, 15)); }

  function buildCalc(el) {
    el.innerHTML = `
      <div class="scr-head"><span class="ic" style="--ci:var(--sm-c3)">🧮</span><div><h1>Scientific Calculator</h1><p>Works offline · keyboard friendly</p></div></div>
      <div id="calc-formula"></div>
      <div class="calc" role="group" aria-label="Scientific calculator">
        <div class="calc-disp">
          <div class="calc-top"><button class="calc-mode" id="calc-angle" onclick="SMF.calcAngle()" aria-label="Angle mode">DEG</button><span class="calc-mem" id="calc-memind" aria-live="polite"></span>
            <span class="calc-tools"><button onclick="SMF.calcMem('MC')">MC</button><button onclick="SMF.calcMem('MR')">MR</button><button onclick="SMF.calcMem('M+')">M+</button><button onclick="SMF.calcMem('M-')">M−</button><button onclick="SMF.calcHist()" aria-label="History">🕘</button></span></div>
          <input id="calc-in" class="calc-in" type="text" inputmode="none" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Expression" placeholder="0">
          <div class="calc-res" id="calc-res" aria-live="polite"></div>
          <div class="calc-frac" id="calc-frac"></div>
        </div>
        <div class="calc-pad">${KEYS.map(k => `<button class="ck ${k[0]}" data-k="${esc(k[2])}" onclick="SMF.calcKey(this.dataset.k)">${esc(k[1])}</button>`).join('')}</div>
      </div>
      <div id="calc-hist"></div>`;
    const inp = $('calc-in');
    inp.addEventListener('input', () => { CS.justEq = false; refreshPreview(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); SMF.calcKey('EQ'); }
      else if (e.key === 'Escape') { e.preventDefault(); SMF.calcKey('AC'); }
    });
    // Physical-keyboard support when the calculator screen is open and no other field has focus.
    document.addEventListener('keydown', e => {
      const scr = $('screen-calculator'); if (!scr || !scr.classList.contains('active')) return;
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9.+\-*/^()!%]$/.test(e.key)) { e.preventDefault(); insert(e.key); }
      else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); SMF.calcKey('EQ'); }
      else if (e.key === 'Backspace') { e.preventDefault(); SMF.calcKey('BS'); }
      else if (e.key === 'Escape') { SMF.calcKey('AC'); }
    });
    updateAngleBtn(); updateMemInd();
  }

  function insert(txt) {
    const inp = $('calc-in'); if (!inp) return;
    if (CS.justEq && /^[0-9.π(]|^[a-z√]/.test(txt)) { inp.value = ''; }
    else if (CS.justEq && /^[+\-×÷^²!%*/]|^×10/.test(txt) && CS.hasAns) inp.value = 'Ans';   // continue from the last result
    CS.justEq = false;
    const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart, e2 = inp.selectionEnd == null ? s : inp.selectionEnd;
    inp.value = inp.value.slice(0, s) + txt + inp.value.slice(e2);
    const pos = s + txt.length; try { inp.setSelectionRange(pos, pos); } catch (_) { }
    refreshPreview();
  }
  const opts = () => ({ angle: CS.angle, vars: CS.hasAns ? { Ans: CS.ans } : {} });

  function refreshPreview() {
    const inp = $('calc-in'), res = $('calc-res'), fr = $('calc-frac'); if (!inp || !res) return;
    const v = inp.value.trim();
    if (!v) { res.textContent = ''; res.className = 'calc-res'; fr.textContent = ''; return; }
    const r = Calc().safeEvaluate(v, opts());
    if (r.ok) { res.textContent = Calc().format(r.value); res.className = 'calc-res'; showFrac(r.value); }
    else { res.textContent = ''; fr.textContent = ''; res.className = 'calc-res'; }
  }
  function showFrac(val) {
    const fr = $('calc-frac'); if (!fr) return;
    if (!CS.fracOn || Number.isInteger(val)) { fr.textContent = ''; return; }
    const f = Calc().toFraction(val); fr.textContent = f ? '= ' + Calc().formatFraction(f) : 'No simple fraction';
  }
  function updateAngleBtn() { const b = $('calc-angle'); if (b) b.textContent = CS.angle; }
  function updateMemInd() { const m = $('calc-memind'); if (m) m.textContent = CS.memory ? 'M' : ''; }

  SMF.calcAngle = function () { CS.angle = CS.angle === 'DEG' ? 'RAD' : 'DEG'; updateAngleBtn(); refreshPreview(); };
  SMF.calcKey = function (k) {
    const inp = $('calc-in'); if (!inp) return;
    if (k === 'AC') { inp.value = ''; CS.justEq = false; const r = $('calc-res'); r.textContent = ''; r.className = 'calc-res'; $('calc-frac').textContent = ''; return; }
    if (k === 'BS') { const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart; if (s > 0) { inp.value = inp.value.slice(0, s - 1) + inp.value.slice(inp.selectionEnd == null ? s : inp.selectionEnd); try { inp.setSelectionRange(s - 1, s - 1); } catch (_) { } } refreshPreview(); return; }
    if (k === 'FRAC') { CS.fracOn = !CS.fracOn; refreshPreview(); toast(CS.fracOn ? 'Fraction display on' : 'Fraction display off'); return; }
    if (k === 'NEG') { insert('−'); return; }
    if (k === 'EQ') return equals();
    insert(k);
  };
  function equals() {
    const inp = $('calc-in'), res = $('calc-res'); const v = inp.value.trim(); if (!v) return;
    const r = Calc().safeEvaluate(v, opts());
    if (!r.ok) { res.textContent = r.error; res.className = 'calc-res err'; $('calc-frac').textContent = ''; return; }
    CS.ans = r.value; CS.hasAns = true;
    const shown = Calc().format(r.value);
    res.textContent = shown; res.className = 'calc-res ok'; showFrac(r.value);
    const h = history(); h.unshift({ e: v, r: shown, v: r.value, a: CS.angle, t: Date.now() }); lsSet(histKey(), h.slice(0, 40));
    CS.justEq = true; renderHistory();
  }
  SMF.calcMem = function (op) {
    const r = Calc().safeEvaluate(($('calc-in').value || '').trim() || '0', opts());
    const cur = r.ok ? r.value : (CS.hasAns ? CS.ans : 0);
    if (op === 'MC') CS.memory = 0;
    else if (op === 'MR') { insert(String(CS.memory)); }
    else if (op === 'M+') { if (!r.ok && ($('calc-in').value || '').trim()) { toast('Fix the expression first'); return; } CS.memory = Calc().cleanNoise(CS.memory + cur); }
    else if (op === 'M-') { if (!r.ok && ($('calc-in').value || '').trim()) { toast('Fix the expression first'); return; } CS.memory = Calc().cleanNoise(CS.memory - cur); }
    lsSet(memKey(), CS.memory); updateMemInd();
    if (op !== 'MR') toast(op === 'MC' ? 'Memory cleared' : 'Memory: ' + Calc().format(CS.memory));
  };
  SMF.calcHist = function () { CS.histOpen = !CS.histOpen; renderHistory(); };
  function renderHistory() {
    const el = $('calc-hist'); if (!el) return;
    if (!CS.histOpen) { el.innerHTML = ''; return; }
    const h = history();
    el.innerHTML = `<div class="calc-histbox"><div class="calc-histhead"><b>History</b>${h.length ? '<button class="sm-link" onclick="SMF.calcHistClear()">Clear</button>' : ''}</div>` +
      (h.length ? h.map((x, i) => `<div class="calc-hrow"><button class="calc-hexp" onclick="SMF.calcHistUse(${i})"><span>${esc(x.e)}</span><b>= ${esc(x.r)}</b></button><button class="calc-hcopy" onclick="SMF.calcHistCopy(${i})" aria-label="Copy result">⧉</button></div>`).join('') : '<div class="sm-empty small">No calculations yet.</div>') + '</div>';
  }
  SMF.calcHistUse = function (i) { const x = history()[i]; if (!x) return; $('calc-in').value = x.e; CS.justEq = false; refreshPreview(); };
  SMF.calcHistCopy = async function (i) { const x = history()[i]; if (!x) return; toast((await copy(String(x.v))) ? 'Result copied' : 'Couldn’t copy'); };
  SMF.calcHistClear = function () { lsSet(histKey(), []); renderHistory(); };
  SMF.calcCopy = async function () { const r = $('calc-res'); if (!r || !r.textContent || r.classList.contains('err')) { toast('Nothing to copy yet'); return; } toast((await copy(String(CS.hasAns && r.classList.contains('ok') ? CS.ans : r.textContent))) ? 'Result copied' : 'Couldn’t copy'); };

  // ── Formula mode: fill in the known values, get every output with its unit ──
  function renderFormulaPanel() {
    const el = $('calc-formula'); if (!el) return;
    const f = CS.formula; if (!f) { el.innerHTML = ''; return; }
    const inputs = f.k.i.map(([key, label, unit]) => `<label class="cf-f"><span>${esc(label)}${unit ? ' <em>(' + esc(unit) + ')</em>' : ''}</span><input data-key="${esc(key)}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="value" onkeydown="if(event.key==='Enter'){event.preventDefault();SMF.cfRun()}"></label>`).join('');
    el.innerHTML = `<div class="calc-formula"><div class="cf-head"><div><small>Formula</small><b>${esc(f.n)}</b></div><button class="sm-link" onclick="SMF.cfClose()" aria-label="Close formula">✕</button></div>
      <div class="fb-expr small">${esc(f.x)}</div>
      <div class="cf-grid">${inputs}</div>
      <div class="cf-note">Enter numbers or expressions (e.g. 6.674e-11, 9.81, 2*pi). Angles use <b>${f.k.ang || CS.angle}</b>.</div>
      <div class="cf-btns"><button class="sm-btn primary" onclick="SMF.cfRun()">Calculate</button>${f.ex ? '<button class="sm-btn" onclick="SMF.cfExample()">Try example</button>' : ''}<button class="sm-btn" onclick="SMF.fbOpenFromCalc()">Formula info</button></div>
      <div id="cf-out" aria-live="polite"></div></div>`;
  }
  SMF.cfClose = function () { CS.formula = null; renderFormulaPanel(); };
  SMF.fbOpenFromCalc = function () { if (CS.formula) { goScreen('formulas', null); SMF.fbOpen(CS.formula.id); } };
  SMF.cfExample = function () {
    const f = CS.formula; if (!f || !f.ex) return;
    document.querySelectorAll('#calc-formula input[data-key]').forEach(i => { const v = f.ex.v[i.dataset.key]; i.value = v === undefined ? '' : String(v); });
    SMF.cfRun();
  };
  SMF.cfRun = function () {
    const f = CS.formula, out = $('cf-out'); if (!f || !out) return;
    const vars = {}; const missing = [];
    document.querySelectorAll('#calc-formula input[data-key]').forEach(inp => {
      const key = inp.dataset.key, raw = inp.value.trim(); inp.classList.remove('bad');
      if (!raw) { missing.push(key); inp.classList.add('bad'); return; }
      const r = Calc().safeEvaluate(raw, { angle: CS.angle });
      if (!r.ok) { missing.push(key); inp.classList.add('bad'); out.dataset.err = '1'; return; }
      vars[key] = r.value;
    });
    if (missing.length) { out.innerHTML = '<div class="cf-err">Enter a valid number for ' + missing.map(k => { const i = f.k.i.find(x => x[0] === k); return '<b>' + esc(i ? i[1] : k) + '</b>'; }).join(', ') + '.</div>'; return; }
    for (const [expr, msg] of (f.k.chk || [])) { const r = Calc().safeEvaluate(expr, { vars, angle: f.k.ang || CS.angle }); if (r.ok && r.value >= 0) { out.innerHTML = '<div class="cf-err">' + esc(msg) + '</div>'; return; } }
    const rows = f.k.o.map(([label, expr, unit]) => {
      const r = Calc().safeEvaluate(expr, { vars, angle: f.k.ang || CS.angle });
      return r.ok ? `<div class="cf-row"><span>${esc(label)}</span><b>${esc(Calc().format(r.value))}${unit ? ' <em>' + esc(unit) + '</em>' : ''}</b></div>`
        : `<div class="cf-row"><span>${esc(label)}</span><b class="err">${esc(r.error)}</b></div>`;
    });
    out.innerHTML = rows.join('');
    const first = Calc().safeEvaluate(f.k.o[0][1], { vars, angle: f.k.ang || CS.angle });
    if (first.ok) { CS.ans = first.value; CS.hasAns = true; }
  };
  SMF._calcState = CS; SMF._fb = FB;
})();
