/**
 * StudyMate AI -- remotely published curriculum + interface translations (Supabase, schema 20).
 *
 * The app ALWAYS works without this file's network calls: the bundled curriculum (curriculum-data.js + curriculum-imports.js)
 * is the fallback, and the last good download is cached on the device for offline use.
 *
 * Rules (tests/remote-content.test.js):
 *   o a published syllabus REPLACES the topic list of a subject that already exists; it never creates boards or subjects
 *   o `aliases` (old topic name -> new name | null) ride along so saved student progress follows the rename
 *   o malformed rows are skipped, never half-applied
 *   o translations are applied as plain text only (textContent via SMI18nUI), never as markup
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SMRemote = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CACHE_KEY = 'sm_curriculum_remote_v1';
  const okName = s => typeof s === 'string' && s.trim() && s.length <= 160;
  const okTopic = t => t && okName(t.name) && (t.subtopics === undefined || (Array.isArray(t.subtopics) && t.subtopics.every(x => typeof x === 'string' && x.length <= 160)));
  const okList = (v, max, len) => v === undefined || (Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && x.length <= len));
  const okTopicPlus = t => okTopic(t) && okList(t.objectives, 20, 300) && okList(t.prerequisites, 12, 160);

  /** Applies published syllabi onto a CURRICULUM object (in place, so features holding subject references see the update). Returns the number applied. */
  function applySyllabi(C, syllabi, SOURCES) {
    let n = 0;
    (Array.isArray(syllabi) ? syllabi : []).forEach(s => {
      try {
        if (!s || typeof s.board !== 'string' || typeof s.subject !== 'string' || !Array.isArray(s.topics) || !s.topics.length) return;
        if (!s.topics.every(okTopicPlus)) return;
        const names = s.topics.map(t => t.name.trim().toLowerCase()); if (new Set(names).size !== names.length) return;
        const subj = C.getSubject(s.board, s.subject); if (!subj) return;            // never invent subjects
        const aliases = {};
        if (s.aliases && typeof s.aliases === 'object') Object.keys(s.aliases).forEach(o => { const v = s.aliases[o]; if (v === null || (typeof v === 'string' && names.includes(v.trim().toLowerCase()))) aliases[o] = v; });
        subj.topics = s.topics.map(t => ({ name: t.name.trim(), subtopics: (t.subtopics || []).slice(), objectives: (t.objectives || []).slice(), prerequisites: (t.prerequisites || []).slice() }));
        subj.topicsSource = 'remote'; subj.topicAliases = aliases; subj.topicsVersion = String(s.version || '');
        const i18n = {};
        if (s.translations && typeof s.translations === 'object') Object.keys(s.translations).forEach(lang => {
          if (!/^[a-z]{2}$/.test(lang) || !Array.isArray(s.translations[lang])) return;
          const map = {}; s.translations[lang].forEach(x => { if (x && okName(x.name) && Number.isInteger(x.position) && s.topics[x.position]) map[s.topics[x.position].name.trim()] = x.name.trim(); });
          if (Object.keys(map).length) i18n[lang] = map;
        });
        subj.topicI18n = i18n;
        if (SOURCES && SOURCES.RECORDS && s.source && typeof s.source === 'object') SOURCES.RECORDS[s.board + '|' + s.subject] = Object.assign({}, s.source, { match: 'exact', version: String(s.version || s.source.version || ''), syllabusYear: s.syllabusYear || s.source.syllabusYear || '' });
        n++;
      } catch (_) { /* skip this syllabus */ }
    });
    return n;
  }

  /** Display name of a topic in a language, falling back to the canonical (English) name. */
  function translateTopic(C, board, subject, name, lang) {
    try { const s = C.getSubject(board, subject); const m = s && s.topicI18n && s.topicI18n[lang]; return (m && m[name]) || name; } catch (_) { return name; }
  }

  const api = { applySyllabi, translateTopic, CACHE_KEY };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;

  // ------------------------- browser -------------------------
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
  const endpoint = name => { try { const u = getAiEndpoint(); return u ? String(u).replace(/\/ask\/?$/, '/' + name) : null; } catch (_) { return null; } };
  const headers = () => { const h = {}; try { if (window.APP_SHARED_SECRET) h['X-App-Secret'] = window.APP_SHARED_SECRET; } catch (_) { } return h; };

  function applyCached() {
    const c = lsGet(CACHE_KEY, null);
    if (c && c.syllabi && window.CURRICULUM) applySyllabi(window.CURRICULUM, Object.values(c.syllabi), window.CURRICULUM_SOURCES);
  }
  let refreshing = false;
  async function refresh() {
    const url = endpoint('curriculum'); if (!url || refreshing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
    refreshing = true;
    try {
      const cache = lsGet(CACHE_KEY, { updatedAt: null, syllabi: {} });
      const r = await fetch(url + (cache.updatedAt ? '?since=' + encodeURIComponent(cache.updatedAt) : ''), { headers: headers() });
      if (!r.ok) return false; const d = await r.json();
      if (!d || !Array.isArray(d.syllabi)) return false;
      let changed = false;
      d.syllabi.forEach(s => { if (s && typeof s.board === 'string' && typeof s.subject === 'string') { cache.syllabi[s.board + '|' + s.subject] = s; changed = true; } });
      if (d.updatedAt) cache.updatedAt = d.updatedAt;
      if (changed) { lsSet(CACHE_KEY, cache); applySyllabi(window.CURRICULUM, d.syllabi, window.CURRICULUM_SOURCES); try { window.dispatchEvent(new CustomEvent('sm-curriculum-updated')); } catch (_) { } }
      return changed;
    } catch (_) { return false; } finally { refreshing = false; }
  }

  // interface strings: bundled first-pass Classroom Notes translations, then anything published in Supabase on top
  async function loadStrings(lang) {
    if (!lang || lang === 'en' || !window.SMI18nUI || !window.SMI18nUI.extend) return;
    const cacheKey = 'sm_i18n_remote:' + lang; const cached = lsGet(cacheKey, null);
    if (cached) window.SMI18nUI.extend(lang, cached);
    const url = endpoint('i18n'); if (!url || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    try {
      const r = await fetch(url + '?lang=' + encodeURIComponent(lang), { headers: headers() }); if (!r.ok) return;
      const d = await r.json(); if (d && d.strings && typeof d.strings === 'object') { lsSet(cacheKey, d.strings); window.SMI18nUI.extend(lang, d.strings); }
    } catch (_) { }
  }
  const curLang = () => { try { return (window.SMI18n && window.SMI18n.locale) ? window.SMI18n.locale() : 'en'; } catch (_) { return 'en'; } };

  applyCached();
  window.addEventListener('load', () => { setTimeout(() => { refresh(); loadStrings(curLang()); }, 1500); });
  window.addEventListener('online', () => { refresh(); loadStrings(curLang()); });
  Object.assign(api, { applyCached, refresh, loadStrings });
  return api;
});
