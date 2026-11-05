/**
 * StudyMate AI — onboarding "Pick your look" step.
 * Shows Light (the default) plus the five FREE themes (free backgrounds only — premium looks are never offered here).
 * Picking a card previews it live. Nothing is chosen = Light. Theme data is READ from the catalogue (window.SMPRESETS);
 * this file never changes a theme definition. The look is saved through the app's own set_visual_preferences function
 * (server-checked: free ids only), then applied by the existing theme engine (SMPresets.loadForUser).
 */
(function (w) {
  'use strict';
  const T = k => (w.SMI18n ? w.SMI18n.t(k) : k);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jid = v => String(v == null ? '' : v).replace(/[^A-Za-z0-9_\-]/g, '');
  let choice = 'light', busy = false, mounted = null;

  const D = () => w.SMPRESETS;
  const freeThemes = () => (D() ? D().backgrounds.filter(b => b.free) : []);

  let scenesP = null;
  function ensureScenes() {
    if (w.SMPRESETS_SCENES) return Promise.resolve();
    if (scenesP) return scenesP;
    scenesP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'personalization-scenes.js';
      s.onload = () => res(); s.onerror = () => { scenesP = null; rej(new Error('scenes')); };
      document.head.appendChild(s);
    });
    return scenesP;
  }
  function thumbHtml(b) {
    try {
      const spec = b.id === D().defaults.background ? D().defaultScene : (w.SMPRESETS_SCENES || {})[b.id];
      if (spec && w.SMArt) return w.SMArt.scene(spec, { key: 'ot_' + jid(b.id), live: false });
    } catch (_) { }
    return '';   // tone-colour fallback is drawn by CSS
  }

  function render(el) {
    if (!el || !D()) { if (el) el.innerHTML = ''; return; }
    mounted = el; busy = false;
    const themes = freeThemes();
    el.innerHTML = `
      <div class="modal-title">${esc(T('onb.theme.title'))}</div>
      <div class="modal-sub">${esc(T('onb.theme.sub'))}</div>
      <div class="ot-grid" role="group" aria-label="${esc(T('onb.theme.title'))}">
        <button type="button" class="ot-card ot-light" data-ot="light" aria-pressed="${choice === 'light'}" onclick="SMOnbTheme.pick('light')">
          <span class="ot-thumb ot-thumb-light" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="ot-meta"><b>☀️ ${esc(T('onb.theme.light'))}</b><small>${esc(T('onb.theme.light.sub'))}</small></span>
        </button>
        ${themes.map(b => `
        <button type="button" class="ot-card" data-ot="${jid(b.id)}" aria-pressed="${choice === b.id}" onclick="SMOnbTheme.pick('${jid(b.id)}')">
          <span class="ot-thumb" style="--ot-tone:${esc(b.tone)}" data-thumb="${jid(b.id)}" aria-hidden="true"></span>
          <span class="ot-meta"><b>${esc(b.name)}</b><small>${esc(T('onb.theme.free'))}</small></span>
        </button>`).join('')}
      </div>
      <button class="settings-save-btn" type="button" onclick="SMOnbTheme.next()">${esc(T('onb.theme.continue'))}</button>
      <button class="modal-dismiss" type="button" onclick="SMOnbTheme.skip()">${esc(T('onb.theme.skip'))}</button>`;
    ensureScenes().then(() => {
      if (mounted !== el) return;
      el.querySelectorAll('.ot-thumb[data-thumb]').forEach(t => { const b = themes.find(x => x.id === t.dataset.thumb); if (b) t.innerHTML = thumbHtml(b); });
    }).catch(() => { /* tone-colour fallback stays */ });
  }

  function setMode(mode) {
    state.displayMode = mode;
    try { localStorage.setItem('sm_display_mode', mode); } catch (_) { }
    applyDisplayMode();
    if (typeof updateAppearanceBadge === 'function') updateAppearanceBadge();
  }
  async function saveLook(bg) {
    const uid = state.activeUserId; if (!uid || !w.SMPresets) return;
    const eff = w.SMPresets.effective();
    let ok = false;
    try {
      if (w.sbClient) {
        const { data, error } = await w.sbClient.rpc('set_visual_preferences', { p_background: bg, p_accent: eff.accent, p_bagley: eff.bagley });
        ok = !error && !!(data && data.ok);
      }
    } catch (_) { }
    if (!ok) {   // offline / rejected: let the engine's own pending-sync retry later
      try { localStorage.setItem('sm_presets_v1_' + uid, JSON.stringify({ background: bg, accent: eff.accent, bagley: eff.bagley, pending: true, prem: false })); } catch (_) { }
    }
    await w.SMPresets.loadForUser(uid);
  }

  async function pick(which) {
    if (busy) return;
    const light = which === 'light';
    if (!light && !freeThemes().some(b => b.id === which)) return;   // premium or unknown ids can never be chosen here
    busy = true; choice = which;
    if (mounted) mounted.querySelectorAll('.ot-card').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.ot === which)));
    try {
      setMode(light ? 'light' : 'dark');          // the five themes are night scenes; Light is the clean default
      await saveLook(light ? D().defaults.background : which);
    } catch (e) { console.warn('[StudyMate] could not apply look', e && e.message); }
    busy = false;
  }
  const next = () => renderOnboardingStep('plan');
  async function skip() { if (choice !== 'light') await pick('light'); next(); }

  w.SMOnbTheme = { render, pick, next, skip, _freeThemes: freeThemes, _reset() { choice = 'light'; busy = false; } };
})(window);
