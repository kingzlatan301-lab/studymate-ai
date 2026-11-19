/**
 * StudyMate AI -- typeset maths for Classroom Notes. LaTeX subset -> MathML. No dependency, works offline.
 *
 * SAFETY: output is built ONLY from a fixed whitelist of MathML element names; every piece of user/model text goes through
 * esc(). A tex string that cannot be parsed (too long, too deep, bad braces) is shown as escaped plain text, never as HTML.
 *
 * Supported: fractions (\frac \dfrac \tfrac \binom), roots (\sqrt, \sqrt[n]{}), super/subscripts, Greek letters, relations and
 * operators, \sum \prod \int \lim with limits, \left..\right fences, matrices/cases (\begin{pmatrix|bmatrix|vmatrix|matrix|cases|aligned}),
 * \text \mathrm \mathbf, accents (\overline \underline \vec \hat \bar \dot), functions (\sin \cos \tan \log \ln ...), degrees, spacing.
 * Text pieces: $inline$ and $$display$$. Money like "$5" is NOT treated as maths (pandoc rule).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SMMathRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_LEN = 2000, MAX_DEPTH = 30;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SYM = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', ohm: 'Ω', hbar: 'ℏ', ell: 'ℓ'
  };
  const OP = {
    times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', star: '⋆', circ: '∘', bullet: '•', oplus: '⊕', otimes: '⊗',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫', lt: '<', gt: '>',
    to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑', downarrow: '↓', rightleftharpoons: '⇌',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨', therefore: '∴', because: '∵',
    angle: '∠', triangle: '△', perp: '⊥', parallel: '∥', mid: '∣', degree: '°', infty: '∞', partial: '∂', nabla: '∇', prime: '′',
    ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', '%': '%', '$': '$', '&': '&', '#': '#', '_': '_', '{': '{', '}': '}', '|': '‖', lbrace: '{', rbrace: '}',
    lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩'
  };
  const FUNC = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'mod', 'deg', 'dim', 'arg']);
  const BIG = { sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', bigcup: '⋃', bigcap: '⋂' };
  const SPACE = { ',': '0.17em', ';': '0.28em', ':': '0.22em', '!': '-0.17em', quad: '1em', qquad: '2em', ' ': '0.28em' };
  const ACCENT = { overline: ['‾', 'mover'], bar: ['¯', 'mover'], vec: ['→', 'mover'], hat: ['^', 'mover'], tilde: ['~', 'mover'], dot: ['˙', 'mover'], ddot: ['¨', 'mover'], overrightarrow: ['→', 'mover'], underline: ['_', 'munder'] };
  const FENCE_OPEN = new Set(['(', '[', '|', '.', '\\{', '\\langle', '\\lfloor', '\\lceil', '\\|']);

  function fail() { const e = new Error('bad tex'); e.isTex = true; throw e; }

  /** tokenizer: commands, braces, ^ _ & \\ , single chars (digits grouped) */
  function tokenize(src) {
    const t = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
        if (!m) fail();
        t.push({ k: 'cmd', v: m[1] }); i += m[0].length;
        if (/^[A-Za-z]+$/.test(m[1])) while (src[i] === ' ') i++;   // spaces after a named command are ignored
      } else if (c === '{' || c === '}' || c === '^' || c === '_' || c === '&') { t.push({ k: c }); i++; }
      else if (/\s/.test(c)) i++;
      else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) { const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(src.slice(i)); t.push({ k: 'num', v: m[0] }); i += m[0].length; }
      else if (/[A-Za-z]/.test(c)) { t.push({ k: 'id', v: c }); i++; }
      else { t.push({ k: 'ch', v: c }); i++; }
    }
    return t;
  }

  const mi = (s, extra) => `<mi${extra || ''}>${esc(s)}</mi>`;
  const mo = (s, extra) => `<mo${extra || ''}>${esc(s)}</mo>`;
  const mn = s => `<mn>${esc(s)}</mn>`;
  const mrow = a => `<mrow>${a.join('')}</mrow>`;
  const wrap = a => (a.length === 1 ? a[0] : mrow(a));

  function parse(tokens, display) {
    let p = 0, depth = 0;
    const peek = () => tokens[p], next = () => tokens[p++];

    function group() {                       // { ... } or a single token
      const t = next(); if (!t) fail();
      if (t.k === '{') { const r = seq(t2 => t2.k === '}'); if (!next()) fail(); return wrap(r); }
      p--; const a = atom(); return a === null ? fail() : a;
    }
    function textGroup() {                   // \text{...}: raw characters, spaces kept
      const t = next(); if (!t || t.k !== '{') fail();
      let out = '', lvl = 1;
      while (p < tokens.length) {
        const x = next();
        if (x.k === '{') lvl++;
        else if (x.k === '}') { lvl--; if (!lvl) return `<mtext>${esc(out)}</mtext>`; }
        else if (x.k === 'cmd') out += (x.v === ' ' || x.v === ',' || x.v === ';' || x.v === 'quad') ? ' ' : (OP[x.v] !== undefined ? OP[x.v] : (SYM[x.v] || ''));
        else if (x.v !== undefined) out += (x.k === 'ch' && x.v === '~') ? ' ' : x.v;
      }
      fail();
    }
    function readName() {                    // {pmatrix} -> 'pmatrix' (letters arrive as separate tokens)
      const g = next(); if (!g || g.k !== '{') fail();
      let n = ''; for (;;) { const x = next(); if (!x) fail(); if (x.k === '}') break; if (x.v === undefined || x.k === 'cmd') fail(); n += x.v; }
      return n;
    }
    function optionalArg() { if (peek() && peek().k === 'ch' && peek().v === '[') { next(); const r = []; while (peek() && !(peek().k === 'ch' && peek().v === ']')) { const a = atom(); if (a === null) fail(); r.push(a); } if (!next()) fail(); return wrap(r); } return null; }

    function environment(name) {
      const rows = [[[]]];
      while (p < tokens.length) {
        const t = peek();
        if (t.k === 'cmd' && t.v === 'end') { next(); if (readName() !== name) fail(); break; }
        if (t.k === '&') { next(); rows[rows.length - 1].push([]); continue; }
        if (t.k === 'cmd' && t.v === '\\') { next(); rows.push([[]]); continue; }
        const a = atom(); if (a === null) fail(); const cur = rows[rows.length - 1]; cur[cur.length - 1].push(postfix(a));
      }
      if (rows.length && rows[rows.length - 1].length === 1 && !rows[rows.length - 1][0].length) rows.pop();
      const table = '<mtable' + (name === 'cases' ? ' columnalign="left left"' : name === 'aligned' ? ' columnalign="right left"' : '') + ' rowspacing="0.4em">' + rows.map(r => '<mtr>' + r.map(c => '<mtd>' + (c.length ? wrap(c) : '') + '</mtd>').join('') + '</mtr>').join('') + '</mtable>';
      const L = { pmatrix: '(', bmatrix: '[', vmatrix: '|', Vmatrix: '‖', Bmatrix: '{', cases: '{' }, R = { pmatrix: ')', bmatrix: ']', vmatrix: '|', Vmatrix: '‖', Bmatrix: '}' };
      if (L[name]) return mrow([mo(L[name], ' stretchy="true"'), table].concat(R[name] ? [mo(R[name], ' stretchy="true"')] : []));
      if (name === 'matrix' || name === 'aligned' || name === 'array' || name === 'align' || name === 'gathered') return table;
      return fail();
    }

    function atom() {
      const t = next(); if (!t) return null;
      switch (t.k) {
        case 'num': return mn(t.v);
        case 'id': return mi(t.v);
        case '{': { p--; return group(); }
        case 'ch': {
          const c = t.v;
          if ('+-=<>/*!?:;,.()[]|~'.includes(c)) {
            if (c === '-') return mo('−'); if (c === '*') return mo('∗'); if (c === '~') return mo(' ');
            if ('()[]|'.includes(c)) return mo(c, ' stretchy="false"');
            if (c === ',' || c === ';') return mo(c, ' separator="true"');
            return mo(c);
          }
          if (c === "'") return mo('′');
          return mi(c);
        }
        case '&': case '}': case '^': case '_': p--; return null;
        case 'cmd': {
          const v = t.v;
          if (v === 'frac' || v === 'dfrac' || v === 'tfrac') { const a = group(), b = group(); return `<mfrac>${a}${b}</mfrac>`; }
          if (v === 'binom') { const a = group(), b = group(); return mrow([mo('(', ' stretchy="true"'), `<mfrac linethickness="0">${a}${b}</mfrac>`, mo(')', ' stretchy="true"')]); }
          if (v === 'sqrt') { const idx = optionalArg(); const g = group(); return idx ? `<mroot>${g}${idx}</mroot>` : `<msqrt>${g}</msqrt>`; }
          if (v === 'text' || v === 'mathrm' || v === 'textrm' || v === 'mbox' || v === 'operatorname') return textGroup();
          if (v === 'mathbf' || v === 'boldsymbol' || v === 'textbf') { const g = group(); return `<mstyle mathvariant="bold">${g}</mstyle>`; }
          if (v === 'mathit') { const g = group(); return `<mstyle mathvariant="italic">${g}</mstyle>`; }
          if (v === 'left') {
            const o = next(); if (!o) fail(); const open = o.k === 'cmd' ? '\\' + o.v : o.v;
            const inner = seq(x => x.k === 'cmd' && x.v === 'right');
            const rn = next(); if (!rn) fail(); const cl = next(); if (!cl) fail();
            const ch = x => (x.k === 'cmd' ? (OP[x.v] || '') : x.v);
            const lo = open === '.' ? '' : (o.k === 'cmd' ? (OP[o.v] || '') : o.v), rc = cl.v === '.' ? '' : ch(cl);
            return mrow([lo ? mo(lo, ' stretchy="true"') : '', mrow(inner), rc ? mo(rc, ' stretchy="true"') : '']);
          }
          if (v === 'right') { p--; return null; }
          if (v === 'begin') return environment(readName());
          if (v === 'end') { p--; return null; }
          if (v === '\\') { p--; return null; }
          if (ACCENT[v]) { const g = group(); const [ch, tag] = ACCENT[v]; return tag === 'mover' ? `<mover accent="true">${g}${mo(ch)}</mover>` : `<munder>${g}${mo(ch)}</munder>`; }
          if (BIG[v]) return mo(BIG[v], ' largeop="true"' + (v === 'int' || v === 'iint' || v === 'oint' ? '' : ' movablelimits="true"'));
          if (FUNC.has(v)) return `<mi mathvariant="normal">${esc(v)}</mi>`;
          if (SYM[v]) return mi(SYM[v], SYM[v] === 'ℏ' || SYM[v] === 'ℓ' ? '' : '');
          if (OP[v] !== undefined) { const s = OP[v]; if ('{}%$&#_'.includes(s) && s.length === 1 && v.length === 1 || v === 'lbrace' || v === 'rbrace') return mo(s, ' stretchy="false"'); return mo(s); }
          if (v in SPACE) return `<mspace width="${SPACE[v]}"></mspace>`;
          if (v === 'displaystyle' || v === 'textstyle' || v === 'limits' || v === 'nolimits') return '';
          return `<mtext>${esc('\\' + v)}</mtext>`;       // unknown command: visible, harmless
        }
      }
      return null;
    }

    function postfix(base) {
      let sub = null, sup = null, primes = '';
      for (;;) {
        const t = peek(); if (!t) break;
        if (t.k === '^') { next(); if (sup !== null) fail(); sup = group(); }
        else if (t.k === '_') { next(); if (sub !== null) fail(); sub = group(); }
        else break;
      }
      if (sub === null && sup === null) return base;
      const isBig = /largeop="true"/.test(base) && /movablelimits="true"/.test(base) || /<mo[^>]*>lim<\/mo>/.test(base) || /<mi mathvariant="normal">(lim|max|min|sup|inf)<\/mi>/.test(base);
      if (isBig && display) { return sub !== null && sup !== null ? `<munderover>${base}${sub}${sup}</munderover>` : sub !== null ? `<munder>${base}${sub}</munder>` : `<mover>${base}${sup}</mover>`; }
      if (sub !== null && sup !== null) return `<msubsup>${base}${sub}${sup}</msubsup>`;
      return sub !== null ? `<msub>${base}${sub}</msub>` : `<msup>${base}${sup}</msup>`;
    }

    function seq(stop) {
      if (++depth > MAX_DEPTH) fail();
      const out = [];
      while (p < tokens.length) {
        const t = peek(); if (stop && stop(t)) break;
        if (t.k === '^' || t.k === '_') { out.push(postfix(mi(' '))); continue; }          // leading script: empty base
        const a = atom(); if (a === null) break;
        out.push(a === '' ? '' : postfix(a));
      }
      depth--; return out.filter(x => x !== '');
    }

    const r = seq(null);
    if (p < tokens.length) fail();                         // stray } or \right etc.
    return wrap(r.length ? r : [mrow([])]);
  }

  /** @returns {string} a <math> element, or escaped plain text if the tex cannot be parsed */
  function texToMathML(tex, display) {
    const src = String(tex == null ? '' : tex).trim();
    if (!src) return '';
    if (src.length > MAX_LEN) return `<span class="cn-tex">${esc(src)}</span>`;
    try {
      const body = parse(tokenize(src), !!display);
      return `<math xmlns="http://www.w3.org/1998/Math/MathML" class="cn-math"${display ? ' display="block"' : ''}>${body}</math>`;
    } catch (e) {
      return `<span class="cn-tex">${esc(src)}</span>`;
    }
  }

  /** Splits text into [{t:'text'|'math', v, display}] using $$..$$ and $..$ (money-safe). */
  function split(text) {
    const s = String(text == null ? '' : text), out = []; let i = 0, buf = '';
    const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
    while (i < s.length) {
      if (s[i] === '\\' && s[i + 1] === '$') { buf += '$'; i += 2; continue; }            // \$ = literal dollar
      if (s[i] === '$' && s[i + 1] === '$') {
        const j = s.indexOf('$$', i + 2);
        if (j > i + 2) { flush(); out.push({ t: 'math', v: s.slice(i + 2, j), display: true }); i = j + 2; continue; }
      }
      if (s[i] === '$') {
        // inline: opening $ not followed by space; closing $ not preceded by space nor followed by a digit; no newline inside
        let j = i + 1, found = -1;
        while (j < s.length && s[j] !== '\n') {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '$') { found = j; break; }
          j++;
        }
        if (found > i + 1) {
          const inner = s.slice(i + 1, found);
          const ok = !/^\s/.test(inner) && !/\s$/.test(inner) && !/[0-9]/.test(s[found + 1] || '') && /[A-Za-z\\^_=+\-*/<>(){}]/.test(inner);
          if (ok) { flush(); out.push({ t: 'math', v: inner, display: false }); i = found + 1; continue; }
        }
      }
      buf += s[i]; i++;
    }
    flush(); return out;
  }

  /** True when the browser can lay out MathML (Chromium 109+, Safari, Firefox). */
  function supportsMathML() {
    try {
      if (typeof document === 'undefined') return false;
      const d = document.createElement('div'); d.style.cssText = 'position:absolute;visibility:hidden';
      d.innerHTML = '<math><mspace height="23px" width="77px"></mspace></math>'; document.body.appendChild(d);
      const w = d.firstChild.firstChild.getBoundingClientRect().width; d.remove(); return Math.abs(w - 77) <= 1;
    } catch (_) { return false; }
  }

  return { texToMathML, split, supportsMathML, esc };
});
