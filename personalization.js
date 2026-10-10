/**
 * StudyMate AI — Presets engine + UI
 * ─────────────────────────────────────────────────────────────────────────
 * Three independent layers — Background, Accent, Bagley — chosen per account.
 *
 *   • Catalog:      personalization-data.js (metadata, accents, Bagley specs)
 *                   personalization-scenes.js (background scene specs, lazy)
 *   • Renderer:     personalization-art.js   (procedural SVG, no image files)
 *   • Persistence:  Supabase table user_visual_preferences (RLS: read own row).
 *                   Writes ONLY via the set_visual_preferences() RPC, which
 *                   checks Premium server-side (schema 08). localStorage is a
 *                   cache only, keyed by user id, and is re-filtered by the
 *                   live subscription state before anything is applied.
 *   • Entitlement:  ids 001-005 of each category are free. For everyone else
 *                   the app's authenticated subscription state (host.premium)
 *                   decides; a Free account always RENDERS the defaults for
 *                   any Premium id, whatever is in storage.
 *
 * The host app (index.html) wires itself in through SMPresets.init({...}).
 */
(function (w) {
  'use strict';
  const D = w.SMPRESETS, Art = w.SMArt;
  if (!D || !Art) { console.error('[Presets] catalog or art engine missing'); return; }

  const ID = { background: D.backgrounds, accent: D.accents, bagley: D.bagleys };
  const MAP = { background: {}, accent: {}, bagley: {} };
  Object.keys(ID).forEach(k => ID[k].forEach(it => { MAP[k][it.id] = it; }));
  const isId = (type, id) => !!MAP[type][id];
  const isFreeId = (type, id) => !!(MAP[type][id] && MAP[type][id].free);
  const CLARITY = { soft: 0.6, balanced: 0.42, vivid: 0.26 };

  let host = {
    premium: () => false, premiumKnown: () => true, uid: () => null, client: () => null,
    paywall: () => {}, toast: () => {}, mode: () => 'dark', photo: () => '', pickPhoto: () => {}, photoOn: () => false, setPhotoOn: () => {}
  };
  let sel = { background: D.defaults.background, accent: D.defaults.accent, bagley: D.defaults.bagley };
  let saved = Object.assign({}, sel);
  let curUid = null, loadTok = 0, pending = false, lastPremium = false, slotKey = 0;
  let ui = null; // overlay state

  // ───────────── storage helpers ─────────────
  const ckey = (uid) => 'sm_presets_v1_' + uid;
  function readCache(uid) { try { return JSON.parse(localStorage.getItem(ckey(uid)) || 'null'); } catch (_) { return null; } }
  function writeCache(extra) {
    if (!curUid) return;
    try { localStorage.setItem(ckey(curUid), JSON.stringify(Object.assign({ background: saved.background, accent: saved.accent, bagley: saved.bagley, pending: pending, prem: lastPremium }, extra || {}))); } catch (_) { /* cache only */ }
  }
  function animPref() { try { return localStorage.getItem('sm_presets_anim'); } catch (_) { return null; } }
  function reducedMotionOS() { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function lowEnd() { const m = navigator.deviceMemory, c = navigator.hardwareConcurrency; return (m && m <= 2) || (c && c <= 3); }
  function animOn() {
    if (reducedMotionOS()) return false;
    const p = animPref();
    if (p === '1') return true;
    if (p === '0') return false;
    return !lowEnd();
  }
  function clarity() { try { return localStorage.getItem('sm_presets_clarity') || 'balanced'; } catch (_) { return 'balanced'; } }

  // ───────────── entitlement ─────────────
  function premiumNow() {
    const k = host.premiumKnown();
    if (k) return !!host.premium();
    return lastPremium; // still resolving: use last known value for THIS account to avoid a flash
  }
  function effective() {
    const p = premiumNow();
    const e = {};
    ['background', 'accent', 'bagley'].forEach(t => {
      const id = sel[t];
      e[t] = (isId(t, id) && (p || isFreeId(t, id))) ? id : D.defaults[t];
    });
    e.photo = !!(p && host.photoOn() && host.photo());
    return e;
  }
  function needsPremium(s) { return ['background', 'accent', 'bagley'].some(t => !isFreeId(t, s[t])); }

  // ───────────── scenes (lazy) ─────────────
  let scenesP = null;
  function ensureScenes() {
    if (w.SMPRESETS_SCENES) return Promise.resolve();
    if (scenesP) return scenesP;
    scenesP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'personalization-scenes.js';
      s.onload = () => res();
      s.onerror = () => { scenesP = null; rej(new Error('scenes failed to load')); };
      document.head.appendChild(s);
    });
    return scenesP;
  }
  function sceneSpec(id) {
    if (id === D.defaults.background) return D.defaultScene;
    return (w.SMPRESETS_SCENES || {})[id] || null;
  }

  // ───────────── applying: background ─────────────
  function ensureEnv() {
    let env = document.getElementById('sm-env');
    if (!env) {
      env = document.createElement('div');
      env.id = 'sm-env'; env.setAttribute('aria-hidden', 'true');
      env.innerHTML = '<div class="sm-env-art"></div><div class="sm-env-veil"></div>';
      document.body.insertBefore(env, document.body.firstChild);
      document.body.classList.add('sm-has-env');
    }
    return env;
  }
  let lastEnvKey = '';
  function applyBackground() {
    const env = ensureEnv();
    const e = effective();
    const live = animOn();
    const key = e.photo ? 'photo:' + (host.photo() || '').length : e.background + '|' + live;
    document.documentElement.classList.toggle('sm-anim-on', live);
    const meta = MAP.background[e.background];
    env.style.setProperty('--sm-tone', meta ? meta.tone : '#0F1B2D');
    env.style.setProperty('--sm-veil', String(CLARITY[clarity()] || 0.5));
    if (key === lastEnvKey) return;
    let html;
    if (e.photo) {
      html = '<div class="sm-photo" style="background-image:url(' + JSON.stringify(host.photo()).slice(1, -1).replace(/\)/g, '%29') + ')"></div>';
    } else {
      const spec = sceneSpec(e.background);
      if (!spec) { ensureScenes().then(applyBackground).catch(() => {}); return; }
      html = Art.scene(spec, { key: 'env', live: live });
    }
    lastEnvKey = key;
    const layer = document.createElement('div');
    layer.className = 'sm-env-art'; layer.innerHTML = html;
    const old = env.querySelector('.sm-env-art');
    env.insertBefore(layer, env.querySelector('.sm-env-veil'));
    const instant = reducedMotionOS() || !old;
    if (instant) layer.classList.add('show'); else requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('show')));
    env.querySelectorAll('.sm-env-art').forEach(el => { if (el !== layer) setTimeout(() => el.remove(), instant ? 0 : 800); });
  }

  // ───────────── applying: accent + card tones ─────────────
  function rgba(hex, a) { const c = Art.hex2rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function onAccent(p, m) {
    const white = Math.min(Art.contrast('#ffffff', p), Art.contrast('#ffffff', m));
    const dark = Math.min(Art.contrast('#0b1020', p), Art.contrast('#0b1020', m));
    return white >= dark ? '#ffffff' : '#0b1020';
  }
  function tokensFor(accentId, bgId, mode) {
    const ac = MAP.accent[accentId] || MAP.accent[D.defaults.accent];
    const bg = MAP.background[bgId] || MAP.background[D.defaults.background];
    const dark = mode !== 'light';
    let surface, card, card2, bar, navAlpha, base;
    if (dark) {
      base = Art.mix(Art.mix(bg.tone, '#1A2B42', 0.5), ac.a, 0.1);
      card = rgba(base, 0.82); card2 = rgba(Art.mix(base, '#ffffff', 0.06), 0.88);
      bar = rgba(Art.mix(bg.tone, '#0F1B2D', 0.55), 0.88); navAlpha = rgba(base, 0.95);
      surface = base;
    } else {
      base = '#ffffff';
      card = 'rgba(255,255,255,0.88)'; card2 = 'rgba(238,241,248,0.92)';
      bar = 'rgba(243,245,250,0.9)'; navAlpha = 'rgba(255,255,255,0.94)';
      surface = '#ffffff';
    }
    const primary = (accentId === D.defaults.accent && dark) ? ac.a : Art.fitContrast(ac.a, surface, 4.5);
    const second = Art.fitContrast(ac.b, surface, 3.2);
    const on = onAccent(primary, second);
    // Button fills: nudge each gradient stop just enough that the label colour reaches 4.5:1 on it.
    // (--indigo/--mint stay untouched for text, borders and glows.)
    const fillA = Art.fitContrast(primary, on, 4.5), fillB = Art.fitContrast(second, on, 4.5);
    return { primary, second, card, card2, bar, navAlpha, on, fillA, fillB, dark, tone: bg.tone, navy: dark ? Art.mix(bg.tone, '#0F1B2D', 0.5) : '#F3F5FA' };
  }
  function applyAccent() {
    const e = effective();
    const mode = host.mode();
    const t = tokensFor(e.accent, e.background, mode);
    const r = document.documentElement.style;
    r.setProperty('--indigo', t.primary);
    r.setProperty('--indigo-glow', rgba(t.primary, 0.25));
    r.setProperty('--mint', t.second);
    r.setProperty('--mint-glow', rgba(t.second, 0.15));
    r.setProperty('--sm-on-accent', t.on);
    r.setProperty('--sm-fill-a', t.fillA);
    r.setProperty('--sm-fill-b', t.fillB);
    r.setProperty('--navy-card', t.card);
    r.setProperty('--navy-card2', t.card2);
    r.setProperty('--navy-card-alpha', t.navAlpha);
    r.setProperty('--navy', t.navy);
    r.setProperty('--sm-bar', t.bar);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.dark ? t.navy : '#F3F5FA');
  }

  // ───────────── applying: Bagley ─────────────
  function bagleyHTML(size, variantId, live) {
    const v = MAP.bagley[variantId || effective().bagley];
    return Art.bagley(v.spec, { key: 'bs' + (++slotKey), size: size, live: live == null ? animOn() : live });
  }
  function refreshSlots() {
    const v = effective().bagley;
    document.querySelectorAll('[data-sm-bagley]').forEach(el => {
      const size = parseInt(el.getAttribute('data-size'), 10) || 56;
      el.innerHTML = bagleyHTML(size, v);
      el.setAttribute('data-bagley-id', v);
    });
  }
  function react() {
    document.querySelectorAll('[data-sm-bagley]').forEach(el => {
      el.classList.remove('b-react'); void el.offsetWidth; el.classList.add('b-react');
      setTimeout(() => el.classList.remove('b-react'), 900);
    });
  }

  function applyAll() { applyBackground(); applyAccent(); refreshSlots(); }

  // ───────────── persistence ─────────────
  async function pushToServer(auto) {
    const client = host.client(), uid = curUid;
    if (!client || !uid) return { ok: false, reason: 'no_session' };
    const e = effective();
    // A background re-sync must never overwrite a saved Premium look with the
    // Free fallback because the subscription state hasn't resolved (or a check failed).
    if (auto && (!host.premiumKnown() || e.background !== sel.background || e.accent !== sel.accent || e.bagley !== sel.bagley)) return { ok: false, reason: 'deferred' };
    try {
      const { data, error } = await client.rpc('set_visual_preferences', { p_background: e.background, p_accent: e.accent, p_bagley: e.bagley });
      if (error) throw error;
      if (uid !== curUid) return { ok: false, reason: 'account_changed' };
      if (data && data.ok) {
        saved = { background: e.background, accent: e.accent, bagley: e.bagley };
        sel = Object.assign({}, saved); pending = false; lastPremium = premiumNow(); writeCache();
        return { ok: true };
      }
      return { ok: false, reason: (data && data.reason) || 'rejected' };
    } catch (err) {
      console.error('[Presets] save failed:', err && err.message);
      pending = true; writeCache({ background: e.background, accent: e.accent, bagley: e.bagley });
      return { ok: false, reason: 'network' };
    }
  }

  async function loadForUser(uid) {
    if (!uid) { resetToDefaults(); return; }
    const my = ++loadTok; curUid = uid;
    const c = readCache(uid);
    sel = { background: D.defaults.background, accent: D.defaults.accent, bagley: D.defaults.bagley };
    if (c) {
      ['background', 'accent', 'bagley'].forEach(t => { if (isId(t, c[t])) sel[t] = c[t]; });
      pending = !!c.pending; lastPremium = !!c.prem;
    } else { pending = false; lastPremium = false; }
    saved = Object.assign({}, sel);
    applyAll(); if (ui) renderUI();
    const client = host.client(); if (!client) return;
    try {
      const { data, error } = await client.from('user_visual_preferences')
        .select('background_id, accent_id, bagley_id').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      if (my !== loadTok || curUid !== uid) return;
      if (pending) { const r = await pushToServer(true); if (r.ok || r.reason !== 'deferred') return; }
      if (data) {
        const s = { background: data.background_id, accent: data.accent_id, bagley: data.bagley_id };
        ['background', 'accent', 'bagley'].forEach(t => { if (!isId(t, s[t])) s[t] = D.defaults[t]; });
        sel = Object.assign({}, s); saved = Object.assign({}, s); writeCache();
      } else {
        sel = { background: D.defaults.background, accent: D.defaults.accent, bagley: D.defaults.bagley }; saved = Object.assign({}, sel); writeCache();
      }
      applyAll(); if (ui) renderUI();
    } catch (err) {
      console.error('[Presets] could not load preferences:', err && err.message);
    }
  }

  function resetToDefaults() {
    loadTok++; curUid = null; pending = false; lastPremium = false;
    sel = { background: D.defaults.background, accent: D.defaults.accent, bagley: D.defaults.bagley }; saved = Object.assign({}, sel);
    applyAll(); if (ui) closeUI(true);
  }

  // Called by the host when the subscription state changes or finishes resolving.
  function refresh() {
    if (host.premiumKnown()) { const p = !!host.premium(); if (p !== lastPremium) { lastPremium = p; writeCache(); } }
    applyAll(); if (ui) renderUI();
  }
  function refreshMode() { applyAccent(); applyBackground(); if (ui) renderUI(); }

  // ───────────── overlay UI ─────────────
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = [['my', 'My Preset'], ['background', 'Backgrounds'], ['accent', 'Accents'], ['bagley', 'Bagley'], ['combo', 'Combos']];
  let io = null;

  function openUI(tab) {
    if (!ui) {
      const root = document.createElement('div');
      root.className = 'pr-root'; root.id = 'presets-root';
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Presets');
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') requestClose(); });
      document.body.appendChild(root);
      ui = { root: root, tab: 'my', filter: { background: 'All', accent: 'All', bagley: 'All' }, opener: document.activeElement, scroll: {} };
    }
    ui.tab = tab || ui.tab || 'my';
    ui.root.classList.add('open'); document.body.classList.add('pr-open');
    ensureScenes().then(() => { if (ui) renderUI(); }).catch(() => { host.toast('Some backgrounds could not load — check your connection'); });
    renderUI();
    setTimeout(() => { const b = ui && ui.root.querySelector('.pr-back'); if (b) b.focus(); }, 30);
  }
  function dirty() { const e = effective(); return e.background !== saved.background || e.accent !== saved.accent || e.bagley !== saved.bagley; }
  function revert() { sel = Object.assign({}, saved); applyAll(); if (ui) renderUI(); }
  function requestClose() {
    if (!ui) return;
    if (dirty()) { revert(); host.toast('Preset not applied — reverted to your saved look'); }
    closeUI();
  }
  function closeUI(silent) {
    if (!ui) return;
    if (io) { io.disconnect(); io = null; }
    const op = ui.opener; ui.root.remove(); ui = null; document.body.classList.remove('pr-open');
    if (!silent && op && op.focus) try { op.focus(); } catch (_) { /* ignore */ }
  }

  function isLocked(type, id) { return !premiumNow() && !isFreeId(type, id); }
  function accentPreview(a) {
    const surface = Art.mix(MAP.background[effective().background].tone, '#1A2B42', 0.5);
    const p = Art.fitContrast(a.a, surface, 4.5), m = Art.fitContrast(a.b, surface, 3.2);
    return { p: p, m: m, on: onAccent(p, m) };
  }
  function lockOverlay(name) {
    return '<span class="pr-lock" aria-hidden="true"><span class="pr-prem">✨ Premium</span><span class="pr-lk">🔒</span></span><span class="pr-sr">' + esc(name) + ', Premium, locked</span>';
  }
  function chipsRow(type, list, key) {
    const set = ['All', 'Free'];
    list.forEach(it => { const c = it.category || it.family; if (set.indexOf(c) < 0) set.push(c); });
    return '<div class="pr-chips" role="group" aria-label="Filter">' + set.map(c => '<button class="pr-chip" data-act="filter" data-type="' + type + '" data-val="' + esc(c) + '" aria-pressed="' + (ui.filter[type] === c) + '">' + esc(c) + '</button>').join('') + '</div>';
  }
  function filtered(type, list) {
    const f = ui.filter[type];
    if (f === 'All') return list;
    if (f === 'Free') return list.filter(i => i.free);
    return list.filter(i => (i.category || i.family) === f);
  }
  function upsell() {
    if (premiumNow()) return '';
    return '<div class="pr-upsell"><div><b>Free preview:</b> 5 backgrounds, 5 accents and 5 Bagleys are yours. <b>Premium unlocks all 300</b> and lets you mix them freely.</div><button data-act="paywall">✨ Unlock</button></div>';
  }

  function renderUI() {
    if (!ui) return;
    const root = ui.root, e = effective(), prem = premiumNow();
    const body = root.querySelector('.pr-body');
    const keepScroll = body ? body.scrollTop : 0, sameTab = body && body.getAttribute('data-tab') === ui.tab;
    let content = '';
    if (ui.tab === 'my') content = renderMy(e);
    else if (ui.tab === 'background') content = renderBackgrounds(e);
    else if (ui.tab === 'accent') content = renderAccents(e);
    else if (ui.tab === 'bagley') content = renderBagleys(e);
    else content = renderCombos(e);
    root.innerHTML =
      '<div class="pr-shell">' +
      '<div class="pr-head"><button class="pr-back" data-act="close" aria-label="Close Presets">←</button><div class="pr-title">Presets</div>' +
      '<span class="pr-pill' + (prem ? '' : ' free') + '">' + (prem ? '✨ PREMIUM' : 'FREE · 5 each') + '</span></div>' +
      '<div class="pr-tabs" role="tablist" aria-label="Preset sections">' + TABS.map(t => '<button class="pr-tab" role="tab" data-act="tab" data-tab="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div class="pr-body" data-tab="' + ui.tab + '" role="tabpanel">' + content + '</div>' +
      '<div class="pr-bar' + (dirty() ? ' show' : '') + '" role="status" aria-live="polite"><div class="msg">Previewing — not saved yet.</div><button class="pr-btn ghost" data-act="revert">Revert</button><button class="pr-btn" data-act="apply">Apply</button></div>' +
      '</div>';
    const nb = root.querySelector('.pr-body');
    if (nb && sameTab) nb.scrollTop = keepScroll;
    hydrateLazy();
  }

  function renderMy(e) {
    const bg = MAP.background[e.background], ac = MAP.accent[e.accent], ba = MAP.bagley[e.bagley];
    const ap = accentPreview(ac), spec = sceneSpec(e.background);
    const art = e.photo ? '<div class="scene sm-photo" style="position:absolute;inset:0;background-size:cover;background-position:center;background-image:url(' + JSON.stringify(host.photo()).slice(1, -1).replace(/\)/g, '%29') + ')"></div>'
      : (spec ? Art.scene(spec, { key: 'hero', live: false }).replace('<svg', '<svg class="scene"') : '');
    const cl = clarity();
    return '<div class="pr-stage" style="--ph:' + bg.tone + '">' + art +
      '<div class="hero-bag">' + Art.bagley(ba.spec, { key: 'hb', size: 84, live: animOn() }) + '</div>' +
      '<div class="glass"><div style="flex:1;min-width:0"><div class="t">' + esc(e.photo ? 'Your photo' : bg.name) + ' · ' + esc(ac.name) + '</div><div class="s">' + esc(ba.name) + '</div>' +
      '<div class="mock"><b style="background:linear-gradient(135deg,' + ap.p + ',' + ap.m + ');color:' + ap.on + '">Ask Bagley</b><span><i style="background:linear-gradient(90deg,' + ap.p + ',' + ap.m + ')"></i></span></div></div></div></div>' +
      upsell().replace('<div class="pr-upsell">', '<div class="pr-upsell" style="margin-top:14px">') +
      '<div class="pr-rows">' +
      row('background', 'Background', e.photo ? 'Your photo' : bg.name, 'Browse') +
      row('accent', 'Accent', ac.name, 'Browse') +
      row('bagley', 'Bagley', ba.name, 'Browse') + '</div>' +
      '<div class="pr-setting"><div><div style="font-weight:700;font-size:14px">Animated backgrounds</div><div class="d">' + (reducedMotionOS() ? 'Off — your device asks for reduced motion.' : 'Gentle twinkles, drifting clouds and floating Bagley. Turn off to save battery.') + '</div></div>' +
      '<div class="pr-seg"><button data-act="anim" data-val="1" aria-pressed="' + animOn() + '"' + (reducedMotionOS() ? ' disabled' : '') + '>On</button><button data-act="anim" data-val="0" aria-pressed="' + (!animOn()) + '">Off</button></div></div>' +
      '<div class="pr-setting"><div><div style="font-weight:700;font-size:14px">Art visibility</div><div class="d">How much of the artwork shows through behind your content.</div></div>' +
      '<div class="pr-seg">' + ['soft', 'balanced', 'vivid'].map(k => '<button data-act="clarity" data-val="' + k + '" aria-pressed="' + (cl === k) + '">' + k[0].toUpperCase() + k.slice(1) + '</button>').join('') + '</div></div>' +
      '<div style="display:flex;gap:10px;margin-top:16px"><button class="pr-btn ghost" style="flex:1" data-act="reset">Reset to Signature</button></div>' +
      '<p class="pr-note">Your preset is saved to your account and follows you to other devices. ' + (premiumNow() ? '' : 'Premium items are previewed as locked until you upgrade. ') + 'If a Premium plan lapses, StudyMate shows the Signature look until you renew — your choices are kept.</p>';
    function row(type, k, v, go) {
      return '<button class="pr-row" data-act="tab" data-tab="' + type + '"><div><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div><span class="go">' + go + ' ›</span></button>';
    }
  }

  function renderBackgrounds(e) {
    const list = filtered('background', D.backgrounds);
    const prem = premiumNow();
    let photoRow = '';
    if (ui.filter.background === 'All') {
      const has = !!host.photo();
      photoRow = '<button class="pr-row" data-act="photo" aria-pressed="' + (e.photo) + '" style="margin:0 0 12px"><span aria-hidden="true" style="font-size:22px">📷</span><div><div class="k">Your own photo' + (prem ? '' : ' · Premium') + '</div><div class="v">' + (e.photo ? 'In use · stays on this device' : (has ? 'Tap to use your saved photo' : 'Upload from your phone · stays on this device')) + '</div></div><span class="go">' + (prem ? (e.photo ? '✓ Active' : (has ? 'Use' : 'Upload')) : '🔒') + '</span></button>';
    }
    return upsell() + chipsRow('background', D.backgrounds) + photoRow + '<div class="pr-grid">' + list.map(b => {
      const locked = isLocked('background', b.id), on = (!e.photo && sel.background === b.id);
      return '<button class="pr-card" data-act="pick" data-type="background" data-id="' + b.id + '" aria-pressed="' + on + '" aria-label="' + esc(b.name + (b.free ? ', free' : ', Premium') + (locked ? ', locked' : '')) + '">' +
        '<div class="pr-art" style="--ph:' + b.tone + '" data-lazy="bg" data-id="' + b.id + '">' + (locked ? lockOverlay(b.name) : '') + '<span class="pr-check">✓ Active</span></div>' +
        '<div class="pr-meta"><div class="pr-name">' + esc(b.name) + '</div><div class="pr-sub">' + esc(b.category) + (b.free ? ' · Free' : '') + '</div></div></button>';
    }).join('') + '</div>' + '<p class="pr-note">Backgrounds are original artwork drawn on your device — no big downloads. Content sits on a readability layer so text stays clear.</p>';
  }

  function renderAccents(e) {
    const list = filtered('accent', D.accents);
    return upsell() + chipsRow('accent', D.accents) + '<div class="pr-grid">' + list.map(a => {
      const locked = isLocked('accent', a.id), on = sel.accent === a.id, p = accentPreview(a);
      return '<button class="pr-card" data-act="pick" data-type="accent" data-id="' + a.id + '" aria-pressed="' + on + '" aria-label="' + esc(a.name + (a.free ? ', free' : ', Premium') + (locked ? ', locked' : '')) + '">' +
        '<div class="pr-art" style="aspect-ratio:auto;position:relative"><div class="pr-acc-top" style="background:linear-gradient(120deg,' + a.a + ',' + a.b + ')"></div>' +
        '<div class="pr-acc-mock"><div class="pr-acc-btn" style="background:linear-gradient(135deg,' + p.p + ',' + p.m + ');color:' + p.on + '">Ask Bagley</div><div class="pr-acc-bar"><i style="background:linear-gradient(90deg,' + p.p + ',' + p.m + ')"></i></div>' +
        '<div class="pr-acc-dots"><i style="background:' + p.p + '"></i><i style="background:' + p.m + '"></i><i style="background:' + a.a + ';opacity:.45"></i></div></div>' +
        (locked ? lockOverlay(a.name) : '') + '<span class="pr-check">✓ Active</span></div>' +
        '<div class="pr-meta"><div class="pr-name">' + esc(a.name) + '</div><div class="pr-sub">' + esc(a.family) + (a.free ? ' · Free' : '') + '</div></div></button>';
    }).join('') + '</div>' + '<p class="pr-note">Every accent is a full palette — buttons, progress, tabs, glow and card tint — checked for readable contrast in dark and light mode.</p>';
  }

  function renderBagleys(e) {
    const list = filtered('bagley', D.bagleys);
    return upsell() + chipsRow('bagley', D.bagleys) + '<div class="pr-grid">' + list.map(b => {
      const locked = isLocked('bagley', b.id), on = sel.bagley === b.id;
      return '<button class="pr-card" data-act="pick" data-type="bagley" data-id="' + b.id + '" aria-pressed="' + on + '" aria-label="' + esc(b.name + (b.free ? ', free' : ', Premium') + (locked ? ', locked' : '')) + '">' +
        '<div class="pr-art pr-bag-art" style="--bag-glow:' + b.spec.glow + '44" data-lazy="bagley" data-id="' + b.id + '">' + (locked ? lockOverlay(b.name) : '') + '<span class="pr-check">✓ Active</span></div>' +
        '<div class="pr-meta"><div class="pr-name">' + esc(b.name) + '</div><div class="pr-sub">' + esc(b.family) + (b.free ? ' · Free' : '') + '</div></div></button>';
    }).join('') + '</div>' + '<p class="pr-note">Same Bagley, same brain — only the look changes. Your Bagley appears while he thinks, beside answers, and on your home screen.</p>';
  }

  function renderCombos(e) {
    const prem = premiumNow();
    return upsell() + '<div class="pr-grid">' + D.combos.map((c, i) => {
      const bg = MAP.background[c.background], ac = MAP.accent[c.accent], ba = MAP.bagley[c.bagley];
      const free = !needsPremium({ background: c.background, accent: c.accent, bagley: c.bagley });
      const locked = !prem && !free;
      const on = sel.background === c.background && sel.accent === c.accent && sel.bagley === c.bagley;
      return '<button class="pr-card" data-act="combo" data-i="' + i + '" aria-pressed="' + on + '" aria-label="' + esc(c.name + (free ? ', free' : ', Premium') + (locked ? ', locked' : '')) + '">' +
        '<div class="pr-combo-art" style="--ph:' + bg.tone + '" data-lazy="combo" data-id="' + c.background + '"><span class="dots" aria-hidden="true"><i style="background:' + ac.a + '"></i><i style="background:' + ac.b + '"></i></span>' +
        '<span class="cb" aria-hidden="true">' + Art.bagley(ba.spec, { key: 'cb' + i, size: 70, live: false }) + '</span>' + (locked ? lockOverlay(c.name) : '') + '<span class="pr-check">✓ Active</span></div>' +
        '<div class="pr-meta"><div class="pr-name">' + esc(c.name) + '</div><div class="pr-sub">' + esc(c.desc) + '</div></div></button>';
    }).join('') + '</div><p class="pr-note">Combos simply pick a Background + Accent + Bagley together. You can still change any layer afterwards.</p>';
  }

  // Lazy thumbnails: only render art for cards that scroll into view.
  function hydrateLazy() {
    if (io) { io.disconnect(); io = null; }
    const nodes = ui.root.querySelectorAll('[data-lazy]');
    if (!nodes.length) return;
    const fill = (el) => {
      const kind = el.getAttribute('data-lazy'), id = el.getAttribute('data-id');
      if (el.getAttribute('data-done')) return;
      if (kind === 'bagley') {
        el.insertAdjacentHTML('afterbegin', Art.bagley(MAP.bagley[id].spec, { key: 't' + (++slotKey), size: 92, live: false }));
        el.setAttribute('data-done', '1');
      } else {
        const spec = sceneSpec(id); if (!spec) return;
        el.insertAdjacentHTML('afterbegin', Art.scene(spec, { key: 't' + (++slotKey), live: false }).replace('<svg', kind === 'combo' ? '<svg class="scene"' : '<svg'));
        el.setAttribute('data-done', '1');
      }
    };
    if (!('IntersectionObserver' in w)) { nodes.forEach(fill); return; }
    io = new IntersectionObserver((entries) => { entries.forEach(en => { if (en.isIntersecting) { fill(en.target); io.unobserve(en.target); } }); }, { root: ui.root.querySelector('.pr-body'), rootMargin: '300px 0px' });
    nodes.forEach(n => io.observe(n));
  }

  // ───────────── interactions ─────────────
  function tryPick(type, id) {
    if (!isId(type, id)) return;
    if (isLocked(type, id)) { host.paywall(); return; }
    sel[type] = id; if (type === 'background' && host.photoOn()) host.setPhotoOn(false);
    applyAll(); renderUI();
  }
  async function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t) return;
    const act = t.getAttribute('data-act');
    if (act === 'close') return requestClose();
    if (act === 'tab') { ui.tab = t.getAttribute('data-tab'); return renderUI(); }
    if (act === 'filter') { ui.filter[t.getAttribute('data-type')] = t.getAttribute('data-val'); return renderUI(); }
    if (act === 'paywall') return host.paywall();
    if (act === 'pick') return tryPick(t.getAttribute('data-type'), t.getAttribute('data-id'));
    if (act === 'combo') {
      const c = D.combos[parseInt(t.getAttribute('data-i'), 10)]; if (!c) return;
      if (needsPremium({ background: c.background, accent: c.accent, bagley: c.bagley }) && !premiumNow()) return host.paywall();
      sel = { background: c.background, accent: c.accent, bagley: c.bagley }; if (host.photoOn()) host.setPhotoOn(false);
      applyAll(); renderUI(); return;
    }
    if (act === 'photo') {
      if (!premiumNow()) return host.paywall();
      if (host.photo()) { host.setPhotoOn(true); applyAll(); renderUI(); } else host.pickPhoto();
      return;
    }
    if (act === 'anim') { try { localStorage.setItem('sm_presets_anim', t.getAttribute('data-val')); } catch (_) { /* ignore */ } lastEnvKey = ''; applyAll(); return renderUI(); }
    if (act === 'clarity') { try { localStorage.setItem('sm_presets_clarity', t.getAttribute('data-val')); } catch (_) { /* ignore */ } applyBackground(); return renderUI(); }
    if (act === 'revert') { revert(); return host.toast('Reverted'); }
    if (act === 'reset') { sel = { background: D.defaults.background, accent: D.defaults.accent, bagley: D.defaults.bagley }; if (host.photoOn()) host.setPhotoOn(false); applyAll(); return renderUI(); }
    if (act === 'apply') {
      if (!curUid) { host.toast('Sign in to save your preset'); return; }
      t.disabled = true;
      const r = await pushToServer();
      if (r.ok) { host.toast('Preset applied ✨'); }
      else if (r.reason === 'premium_required') { revert(); host.paywall(); host.toast('That look needs Premium'); }
      else if (r.reason === 'network') { saved = Object.assign({}, effective()); host.toast('Saved on this device — will sync to your account when you are online'); }
      else { host.toast("Couldn't save your preset — try again"); }
      if (ui) renderUI();
    }
  }

  // ───────────── public API ─────────────
  function init(h) { host = Object.assign(host, h || {}); }
  function boot(uidHint) {
    // Instant, flash-free first paint: apply this device's last account's cache
    // (re-filtered by entitlement) until the real session resolves.
    try {
      if (uidHint) { const c = readCache(uidHint); if (c) { curUid = uidHint; ['background', 'accent', 'bagley'].forEach(t => { if (isId(t, c[t])) sel[t] = c[t]; }); lastPremium = !!c.prem; saved = Object.assign({}, sel); } }
    } catch (_) { /* defaults */ }
    applyAll();
  }
  w.SMPresets = {
    init: init, boot: boot, loadForUser: loadForUser, resetToDefaults: resetToDefaults, refresh: refresh, refreshMode: refreshMode,
    open: openUI, close: requestClose, react: react, refreshSlots: refreshSlots, bagleyHTML: bagleyHTML,
    effective: effective, premiumNow: premiumNow, photoChanged: function () { lastEnvKey = ''; applyAll(); if (ui) renderUI(); },
    get active() { return true; }, _tokensFor: tokensFor
  };
})(window);
