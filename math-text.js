/**
 * StudyMate AI — maths text hygiene for AI-generated multiple-choice questions
 * ─────────────────────────────────────────────────────────────────────────
 * ONE file, loaded by the browser (index.html: window.MathText) AND required by the server
 * (api/_lib/validate-output.js), so both sides judge "is this question usable?" identically.
 *
 * WHY THIS EXISTS (root cause, confirmed by reproducing it with JSON.parse):
 *   The app asks the model for ONE JSON object per question but never says how to write maths, and the
 *   UI renders plain text (no maths renderer is loaded). Models answer with LaTeX, which breaks in three ways:
 *     1. Single-backslash LaTeX inside a JSON string is read as a JSON escape: \frac → form-feed + "rac{…}",
 *        \times → tab + "imes", \theta → tab + "heta", \beta → backspace + "eta", \right → CR + "ight".
 *        JSON.parse succeeds, so corrupted text is shown.
 *     2. Other LaTeX (\( \) \left \sqrt \pi …) is an INVALID JSON escape, JSON.parse throws, the question is
 *        rejected, and the whole mock exam used to stop at "Invalid question".
 *     3. Correctly escaped LaTeX (\\frac) parses fine but is displayed as raw "\frac{1}{2}" and "$…$".
 *   The prompts now ask for plain text / Unicode maths. This module is the safety net for when the model
 *   ignores that: it repairs the JSON text before parsing, converts common LaTeX to readable Unicode,
 *   and validates the question so a bad one is rejected (and can be retried) instead of being shown.
 *
 * LIMITS: this converts the LaTeX a school-level question realistically uses. Anything it cannot convert
 * is REJECTED (reason 'corrupt_math'), never displayed half-converted. Corruption that leaves no trace
 * (no backslash, no control character) cannot be detected here.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MathText = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Commands whose first letter after the backslash is also a valid JSON escape (b f n r t). Written with a
  // single backslash they silently turn into a control character, so the JSON text is repaired first.
  // (\nu and \ne are deliberately NOT here: "\nu…" is far more likely a newline than the Greek letter.)
  const AMBIGUOUS_COMMANDS = [
    'frac', 'dfrac', 'tfrac', 'forall', 'flat',
    'times', 'theta', 'tau', 'tan', 'to', 'top', 'text', 'textbf', 'textit', 'tilde', 'therefore', 'triangle',
    'beta', 'bar', 'binom', 'bigl', 'bigr', 'bf', 'boldsymbol', 'boxed', 'begin',
    'right', 'rho', 'rm', 'rfloor', 'rangle', 'rightarrow',
    'neq', 'neg', 'nabla', 'notin', 'not'
  ];

  const SYMBOLS = {
    times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', cong: '≅', propto: '∝',
    infty: '∞', degree: '°', circ: '∘', prime: '′', partial: '∂', nabla: '∇',
    sum: '∑', prod: '∏', int: '∫', sqrt: '√',
    to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', implies: '⇒', iff: '⇔',
    in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', therefore: '∴', angle: '∠', triangle: '△', perp: '⊥', parallel: '∥', neg: '¬',
    ldots: '…', dots: '…', cdots: '…', vdots: '⋮',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
    vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    // function names are plain words
    sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
    arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan', log: 'log', ln: 'ln', lg: 'lg', exp: 'exp', lim: 'lim',
    max: 'max', min: 'min', det: 'det', gcd: 'gcd', lcm: 'lcm', mod: 'mod'
  };
  const DROP_COMMANDS = new Set(['left', 'right', 'bigl', 'bigr', 'big', 'Big', 'Bigl', 'Bigr', 'displaystyle', 'limits', 'nolimits']);
  const SPACE_COMMANDS = new Set(['quad', 'qquad']);
  // (decorations such as \vec \hat \bar \overline and \mathbb keep just their letters — their special glyphs are font-fragile)
  const TEXT_COMMANDS = new Set(['text', 'textbf', 'textit', 'mathrm', 'mathbf', 'mathit', 'operatorname', 'mbox', 'boxed', 'underline', 'rm', 'bf', 'vec', 'hat', 'bar', 'overline', 'mathbb']);
    const NON_LETTER_ESCAPES = {
    '%': '%', '$': '$', '&': '&', '_': '_', '{': '{', '}': '}', '#': '#', ' ': ' ', ',': ' ', ';': ' ', ':': ' ',
    '!': '', '(': '', ')': '', '[': '', ']': '', '|': '‖', '\\': ' ', '/': '/'
  };
  // Names that, if still present after conversion, prove the text is half-converted LaTeX (→ reject).
  const LATEX_HINT = new Set(Object.keys(SYMBOLS).concat([
    'frac', 'dfrac', 'tfrac', 'left', 'right', 'begin', 'end', 'mathbb', 'mathcal', 'mathfrak', 'vec', 'hat', 'bar', 'overline',
    'underline', 'text', 'textbf', 'textit', 'mathrm', 'mathbf', 'boxed', 'binom', 'over', 'choose', 'pmatrix', 'matrix', 'cases',
    'array', 'align', 'equation', 'overset', 'underset', 'stackrel', 'xrightarrow', 'tikz', 'bigl', 'bigr', 'displaystyle', 'quad',
    'rm', 'bf', 'not'
  ]));

  // GLYPH SAFETY: output sticks to characters present in virtually every system font (Latin-1 ² ³ ½ ¼ ¾ × ÷ ° ±,
  // the Superscripts block digits, Greek, and the common Mathematical Operators). Rarer glyphs (ⁿ ⁱ ⅓ ⅔ ∛ ∜,
  // blackboard letters, combining arrows/hats) are avoided because some Android/WebView fonts draw them as boxes.
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾' };
  const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎' };
  const VULGAR = { '1/2': '½', '1/4': '¼', '3/4': '¾' };

  const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  const CONTROL_RE_G = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

  // ── JSON-text repair ──────────────────────────────────────────────────────────────────────────
  // Operates on the RAW model text before JSON.parse. Only touches a backslash that is not already part of
  // an escaped pair (odd run length), so correctly escaped "\\frac" is left exactly as it is.
  const AMBIGUOUS_RE = new RegExp('(\\\\+)(' + AMBIGUOUS_COMMANDS.join('|') + ')(?![A-Za-z])', 'g');

  function repairJsonText(raw) {
    let s = String(raw);
    s = s.replace(AMBIGUOUS_RE, (m, bs, name) => (bs.length % 2 === 1 ? bs + '\\' : bs) + name);
    s = s.replace(/(\\+)([^"\\\/bfnrtu])/g, (m, bs, ch) => (bs.length % 2 === 1 ? bs + '\\' + ch : m));
    s = s.replace(/(\\+)u(?![0-9a-fA-F]{4})/g, (m, bs) => (bs.length % 2 === 1 ? bs + '\\u' : m));
    return s;
  }

  // Safety net for text that was ALREADY parsed with a corrupting escape: "\x0c" + "rac{" → "\frac{".
  const CTRL_FOR = { b: '\b', f: '\f', r: '\r', t: '\t' };
  const CONTROL_FIXES = AMBIGUOUS_COMMANDS
    .filter(name => CTRL_FOR[name[0]])
    .map(name => ({ re: new RegExp(CTRL_FOR[name[0]] + name.slice(1) + '(?![A-Za-z])', 'g'), to: '\\' + name }));
  function repairControlChars(s) {
    if (!CONTROL_RE.test(s) && s.indexOf('\t') === -1 && s.indexOf('\r') === -1) return s;
    for (const f of CONTROL_FIXES) s = s.replace(f.re, f.to);
    return s;
  }

  // ── LaTeX → readable Unicode ──────────────────────────────────────────────────────────────────
  const LATEX_SIGNAL_RE = /\\[A-Za-z]{2,}|\\[()\[\]{}%$&_#,;:! ]|\$[^$\n]*[\\^_{}][^$\n]*\$|\^\{|_\{/;
  function hasLatexSignal(s) { return LATEX_SIGNAL_RE.test(s); }

  function readGroup(s, i) { // s[i] === '{' → { content, end } (end = index after the matching '}'), or null
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return { content: s.slice(i + 1, j), end: j + 1 }; }
    }
    return null;
  }
  function argAt(s, i) {
    while (i < s.length && s[i] === ' ') i++;
    return s[i] === '{' ? readGroup(s, i) : null;
  }

  const ATOM_RE = /^(?:\d+(?:\.\d+)?|[A-Za-zπθαβγδλμσφωΔΩ]|[A-Za-z][²³⁰¹⁴-⁹]+|√(?:\d+|[A-Za-z]))$/;
  const isAtom = t => ATOM_RE.test(t);
  function fracText(a, b) {
    a = a.trim(); b = b.trim();
    const key = a + '/' + b;
    if (VULGAR[key]) return VULGAR[key];
    return (isAtom(a) ? a : '(' + a + ')') + '/' + (isAtom(b) ? b : '(' + b + ')');
  }
  function mapAll(t, table) {
    if (!t) return null;
    let out = '';
    for (const ch of t) { if (!table[ch]) return null; out += table[ch]; }
    return out;
  }
  function superText(content) {
    const t = content.trim();
    const m = mapAll(t, SUP);
    if (m) return m;
    return /^[A-Za-z0-9]$/.test(t) ? '^' + t : '^(' + t + ')';
  }
  function subText(content) {
    const t = content.trim();
    const m = mapAll(t, SUB);
    if (m) return m;
    return /^[A-Za-z0-9]+$/.test(t) ? '_' + t : '_(' + t + ')';
  }

  // Reads the argument of ^ or _ starting at s[k]: { content, end } or null.
  function scriptArg(s, k, isSup) {
    if (s[k] === '{') {
      const g = readGroup(s, k);
      if (!g) return null;
      const raw = g.content.trim();
      return { content: isSup && raw === '\\circ' ? '°' : convert(g.content), end: g.end, raw };
    }
    if (s[k] === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(k, k + 24));
      if (!m) return null;
      const tok = isSup && m[1] === 'circ' ? '°' : convert('\\' + m[1]);
      return { content: tok, end: k + m[0].length, raw: m[0] };
    }
    const m = /^[-+−]?\d+|^[A-Za-z]/.exec(s.slice(k, k + 12));
    if (!m) return null;
    return { content: m[0], end: k + m[0].length, raw: m[0] };
  }

  function convert(s) {
    let out = '';
    let i = 0;
    const n = s.length;
    while (i < n) {
      const c = s[i];

      if (c === '\\') {
        const nm = /^[A-Za-z]+/.exec(s.slice(i + 1, i + 24));
        if (!nm) { // backslash + symbol
          const ch = s[i + 1];
          if (ch !== undefined && Object.prototype.hasOwnProperty.call(NON_LETTER_ESCAPES, ch)) { out += NON_LETTER_ESCAPES[ch]; i += 2; continue; }
          out += c; i += 1; continue;
        }
        const name = nm[0];
        const j = i + 1 + name.length;

        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          const a = argAt(s, j);
          const b = a && argAt(s, a.end);
          if (a && b) { out += fracText(convert(a.content), convert(b.content)); i = b.end; continue; }
          out += '\\' + name + (s[j] === '{' ? ' ' : ''); i = j; continue; // unsupported form → stays visible as residue → rejected
        }
        if (name === 'sqrt') {
          let k = j, idx = null;
          while (s[k] === ' ') k++;
          if (s[k] === '[') { const close = s.indexOf(']', k); if (close !== -1) { idx = s.slice(k + 1, close).trim(); k = close + 1; } }
          const g = argAt(s, k);
          if (g) {
            const inner = convert(g.content).trim();
            const body = isAtom(inner) ? inner : '(' + inner + ')';
            if (idx === null || idx === '2') out += '√' + body;
            else if (idx === '3') out += '³√' + body;
            else if (idx === '4') out += '⁴√' + body;
            else out += '(' + inner + ')^(1/' + convert(idx) + ')';
            i = g.end; continue;
          }
          out += '\\' + name; i = j; continue;
        }
        if (TEXT_COMMANDS.has(name)) {
          const g = argAt(s, j);
          if (g) { out += convert(g.content); i = g.end; continue; }
          out += '\\' + name; i = j; continue;
        }
        if (DROP_COMMANDS.has(name)) {
          i = j;
          if ((name === 'left' || name === 'right') && s[i] === '.') i++; // null delimiter
          continue;
        }
        if (SPACE_COMMANDS.has(name)) { out += ' '; i = j; continue; }
        if (Object.prototype.hasOwnProperty.call(SYMBOLS, name)) { out += SYMBOLS[name]; i = j; continue; }
        out += '\\' + name + (s[j] === '{' ? ' ' : ''); i = j; continue; // unknown command → residue (space keeps it from fusing with a following {group})
      }

      if (c === '^') {
        const a = scriptArg(s, i + 1, true);
        if (a) {
          out += a.content === '°' ? '°' : superText(a.content);
          i = a.end; continue;
        }
        out += c; i++; continue;
      }
      if (c === '_') {
        const a = scriptArg(s, i + 1, false);
        if (a) { out += subText(a.content); i = a.end; continue; }
        out += c; i++; continue;
      }
      if (c === '{') {
        const g = readGroup(s, i);
        if (g) { out += convert(g.content); i = g.end; continue; }
        i++; continue; // unbalanced → drop the brace
      }
      if (c === '}') { i++; continue; }

      out += c; i++;
    }
    return out;
  }

  function stripMathDelimiters(s) {
    s = s.replace(/\$\$/g, '');
    // "$…$" is only a maths delimiter when what is inside looks like LaTeX; "costs $5 and $10" is left alone.
    return s.replace(/\$([^$\n]*[\\^_{}][^$\n]*)\$/g, '$1');
  }

  // "$2gh$" / "$(2 \times 3)$": a pair of dollar signs hugging the formula (no space just inside either one) is a maths
  // delimiter and is removed. "costs $5 and $10", "$5-$10" and a lone "$" are money/text and are left alone.
  function stripDollarPairs(s) {
    if (s.indexOf('$') === -1) return s;
    s = s.replace(/\$\$/g, '');
    return s.replace(/\$([^\s$](?:[^$\n]{0,58}[^\s$])?)\$/g, (m, inner) => (/^\d[\d.,]*[-–]$/.test(inner) ? m : inner));
  }

  function latexToPlain(input) {
    const s = String(input == null ? '' : input);
    if (!hasLatexSignal(s)) return s;
    return convert(stripMathDelimiters(s));
  }

  // Cleans ONE display string. { text, ok } — ok:false means it is still corrupt (do not show it).
  function cleanText(input) {
    let s = String(input == null ? '' : input);
    s = repairControlChars(s);
    s = stripDollarPairs(s);
    s = latexToPlain(s);
    let ok = true;
    if (CONTROL_RE.test(s)) { ok = false; s = s.replace(CONTROL_RE_G, ''); }
    s = s.replace(/\s+/g, ' ').trim();
    const residue = s.match(/\\([A-Za-z]{2,})/g);
    if (residue && residue.some(r => LATEX_HINT.has(r.slice(1)))) ok = false;
    return { text: s, ok };
  }

  // ── Generic JSON reading (every AI feature that replies with JSON) ───────────────────────────
  // Finds the first JSON object/array in the reply (tolerates code fences and chatter), repairs LaTeX
  // backslashes, and parses. Returns the value or null — never throws.
  function parseJson(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim() || rawText.length > 200000) return null;
    const t = rawText.replace(/```(?:json)?/gi, '').trim();
    const o = t.indexOf('{'), r = t.indexOf('[');
    let start, end;
    if (o === -1 && r === -1) return null;
    if (r === -1 || (o !== -1 && o < r)) { start = o; end = t.lastIndexOf('}'); }
    else { start = r; end = t.lastIndexOf(']'); }
    if (end <= start) return null;
    try { return JSON.parse(repairJsonText(t.slice(start, end + 1))); } catch (_) { return null; }
  }

  // Display-cleaning for FREE-FORM text (Ask AI explanations, lessons, flashcards). Unlike cleanText() it never
  // rejects and never collapses whitespace: newlines survive (lists, tables and code depend on them), and code
  // (``` fences and `inline`) is left untouched. Plain "$" pairs are NOT stripped here — that rule is only safe
  // for short question/option strings, not prose that may discuss money or shell variables.
  function cleanProse(input) {
    const s = String(input == null ? '' : input);
    if (!s || (!hasLatexSignal(s) && !CONTROL_RE.test(s) && s.indexOf('\t') === -1 && s.indexOf('\r') === -1)) return s;
    return s.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => {
      if (i % 2 === 1) return part; // code
      let p = repairControlChars(part);
      if (hasLatexSignal(p)) p = latexToPlain(p);
      return p.replace(CONTROL_RE_G, '');
    }).join('');
  }

  // Applies cleanProse to every string inside parsed JSON (objects/arrays, depth-limited).
  function cleanDeep(v, depth) {
    depth = depth || 0;
    if (typeof v === 'string') return cleanProse(v);
    if (depth > 8 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => cleanDeep(x, depth + 1));
    const out = {};
    for (const k of Object.keys(v)) out[k] = cleanDeep(v[k], depth + 1);
    return out;
  }

  // ── Question validation ───────────────────────────────────────────────────────────────────────
  const fail = reason => ({ ok: false, reason });
  const asText = v => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : null));

  // Validates + normalises ONE parsed question object (shared by single-question and batch parsing).
  function validateQuestionObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('bad_shape');

    const qRaw = asText(obj.question);
    if (qRaw === null || !qRaw.trim()) return fail('no_question');
    if (!Array.isArray(obj.options) || obj.options.length < 2 || obj.options.length > 8) return fail('bad_options');

    const q = cleanText(qRaw);
    if (!q.text) return fail('no_question');
    const options = [];
    let corrupt = !q.ok;
    for (const o of obj.options) {
      const raw = asText(o);
      if (raw === null) return fail('bad_options');
      const c = cleanText(raw);
      if (!c.text) return fail('bad_options');
      if (!c.ok) corrupt = true;
      options.push(c.text);
    }
    if (corrupt) return fail('corrupt_math');

    let ci = obj.correctIndex;
    if (typeof ci === 'string' && /^\d+$/.test(ci.trim())) ci = Number(ci);
    if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) return fail('bad_correct_index');
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) return fail('duplicate_options');

    const explanation = asText(obj.explanation) === null ? '' : cleanProse(asText(obj.explanation)).trim();
    const topic = asText(obj.topic) === null ? '' : cleanText(asText(obj.topic)).text;
    return {
      ok: true,
      question: {
        question: q.text,
        options,
        correctIndex: ci,
        explanation,
        topic,
        distractorRationale: Array.isArray(obj.distractorRationale) ? obj.distractorRationale : []
      }
    };
  }

  /**
   * Parses the model's reply for ONE multiple-choice question (Practice and Mock Exam share this).
   * Returns { ok:true, question:{question, options[], correctIndex, explanation, topic, distractorRationale[]} }
   * or { ok:false, reason } where reason is one of: empty | invalid_json | bad_shape | no_question | bad_options |
   * bad_correct_index | duplicate_options | corrupt_math.
   * Question text and options are repaired/converted; a question that is still corrupt is rejected, never returned.
   */
  function parseQuestion(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim() || rawText.length > 20000) return fail('empty');
    const t = rawText.replace(/```(?:json)?/gi, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a === -1 || b <= a) return fail('invalid_json');
    let obj;
    try { obj = JSON.parse(repairJsonText(t.slice(a, b + 1))); } catch (_) { return fail('invalid_json'); }
    return validateQuestionObject(obj);
  }

  /** CBT batch: a JSON array of questions. Returns only the valid, normalised ones (possibly an empty array). */
  function parseQuestionList(rawText) {
    const arr = parseJson(rawText);
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const item of arr) { const r = validateQuestionObject(item); if (r.ok) out.push(r.question); }
    return out;
  }

  return { parseQuestion, parseQuestionList, parseJson, cleanDeep, cleanProse, cleanText, latexToPlain, repairJsonText, hasLatexSignal };
});
