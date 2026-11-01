/**
 * StudyMate AI — Scientific Calculator engine
 * ─────────────────────────────────────────────────────────────────────────
 * A small recursive-descent parser. It NEVER uses eval / Function / new Function:
 * input is tokenised against a fixed whitelist, so arbitrary JavaScript cannot run.
 * Pure logic, no DOM — loaded in the browser (window.SMCalc) and in Node tests.
 *
 * Grammar (lowest → highest precedence):
 *   expr    := term (('+'|'-') term)*
 *   term    := unary (('*'|'/'|'×'|'÷'|implicit) unary)*
 *   unary   := ('-'|'+') unary | power
 *   power   := postfix ('^' unary)?            (right-assoc; -2^2 = -4)
 *   postfix := primary ('!' | '%' | '²' | '³')*
 *   primary := number | const | var | func '(' expr ')' | '(' expr ')'
 *
 * Percent: "50%" = 0.5. "200+10%" = 220 (percent of the left operand, as on a
 * handheld calculator); "200*10%" = 20.
 */
(function (root) {
  'use strict';

  class CalcError extends Error {
    constructor(message, code) { super(message); this.name = 'CalcError'; this.code = code || 'syntax'; }
  }

  const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };
  // Angle-aware functions are handled separately so DEG/RAD can be applied.
  const FUNCS = {
    sin: 'trig', cos: 'trig', tan: 'trig',
    asin: 'itrig', acos: 'itrig', atan: 'itrig',
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    log: Math.log10, ln: Math.log, log10: Math.log10, log2: Math.log2,
    sqrt: Math.sqrt, '√': Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
    exp: Math.exp, fact: 'fact', floor: Math.floor, ceil: Math.ceil, round: Math.round
  };

  function tokenize(src) {
    const s = String(src == null ? '' : src)
      .replace(/\s+/g, '')
      .replace(/×|·|⋅/g, '*').replace(/÷/g, '/').replace(/−|–/g, '-')
      .replace(/,/g, '.');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/[0-9.]/.test(c)) {
        const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw new CalcError('Invalid number', 'syntax');
        // "2e" followed by a letter would be 2*e — the regex only takes the exponent when digits follow.
        out.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
      } else if (/[a-zA-Zπ√]/.test(c)) {
        const m = /^(?:π|√|[a-zA-Z_][a-zA-Z_0-9]*)/.exec(s.slice(i));
        let word = m[0];
        // Split run-together words like "2pi" handled by lexer (num then word); "xy" stays a variable name.
        out.push({ t: 'id', v: word });
        i += word.length;
      } else if ('+-*/^()!%²³'.includes(c)) {
        out.push({ t: 'op', v: c }); i++;
      } else {
        throw new CalcError('Unexpected character "' + c + '"', 'syntax');
      }
    }
    return out;
  }

  function factorial(n) {
    if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) throw new CalcError('Factorial needs a whole number ≥ 0', 'domain');
    if (n > 170) throw new CalcError('Result too large', 'overflow');
    let r = 1; for (let k = 2; k <= n; k++) r *= k; return r;
  }

  function evaluate(src, opts) {
    opts = opts || {};
    const angle = opts.angle === 'RAD' ? 'RAD' : 'DEG';
    const vars = opts.vars || {};
    const toRad = x => angle === 'DEG' ? x * Math.PI / 180 : x;
    const fromRad = x => angle === 'DEG' ? x * 180 / Math.PI : x;
    const toks = tokenize(src);
    if (!toks.length) throw new CalcError('Empty expression', 'empty');
    let p = 0;
    const peek = () => toks[p];
    const isOp = v => peek() && peek().t === 'op' && peek().v === v;

    function parseExpr() {
      let left = parseTerm();
      while (isOp('+') || isOp('-')) {
        const op = toks[p++].v;
        const startP = p;
        const right = parseTerm();
        // Handheld-calculator percent: "a + b%" means a + (a*b/100). Only when the right-hand
        // term is a bare percentage (e.g. 10% or (5+5)%), not 10%*3.
        const seg = toks.slice(startP, p);
        const barePct = seg.length >= 2 && seg[seg.length - 1].v === '%' &&
          !seg.some(t => t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '^'));
        if (barePct) left = op === '+' ? left * (1 + right) : left * (1 - right);
        else left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function startsOperand() {
      const t = peek();
      if (!t) return false;
      if (t.t === 'num' || t.t === 'id') return true;
      return t.t === 'op' && t.v === '(';
    }

    function parseTerm() {
      let left = parseUnary();
      for (;;) {
        if (isOp('*') || isOp('/')) {
          const op = toks[p++].v;
          const right = parseUnary();
          if (op === '/') {
            if (right === 0) throw new CalcError('Cannot divide by zero', 'div0');
            left = left / right;
          } else left = left * right;
        } else if (startsOperand()) {
          left = left * parseUnary(); // implicit multiplication: 2π, 3(4+1), 2sin(30)
        } else break;
      }
      return left;
    }

    function parseUnary() {
      if (isOp('-')) { p++; return -parseUnary(); }
      if (isOp('+')) { p++; return parseUnary(); }
      return parsePower();
    }

    function parsePower() {
      const base = parsePostfix();
      if (isOp('^')) {
        p++;
        const exp = parseUnary();
        if (base === 0 && exp < 0) throw new CalcError('Cannot divide by zero', 'div0');
        const r = Math.pow(base, exp);
        if (Number.isNaN(r)) throw new CalcError('Result is not a real number', 'domain');
        return r;
      }
      return base;
    }

    function parsePostfix() {
      let v = parsePrimary();
      for (;;) {
        if (isOp('!')) { p++; v = factorial(v); }
        else if (isOp('%')) { p++; v = v / 100; }
        else if (isOp('²')) { p++; v = v * v; }
        else if (isOp('³')) { p++; v = v * v * v; }
        else break;
      }
      return v;
    }

    function parsePrimary() {
      const t = toks[p];
      if (!t) throw new CalcError('Expression ended unexpectedly', 'syntax');
      if (t.t === 'num') { p++; return t.v; }
      if (t.t === 'op' && t.v === '(') {
        p++;
        const v = parseExpr();
        if (!isOp(')')) throw new CalcError('Missing closing bracket', 'syntax');
        p++;
        return v;
      }
      if (t.t === 'id') {
        p++;
        const name = t.v;
        const lower = name.toLowerCase();
        if (isOp('(') && (Object.prototype.hasOwnProperty.call(FUNCS, lower))) {
          p++;
          const arg = parseExpr();
          if (!isOp(')')) throw new CalcError('Missing closing bracket', 'syntax');
          p++;
          return applyFunc(lower, arg);
        }
        if (Object.prototype.hasOwnProperty.call(FUNCS, lower) && lower !== 'e') {
          // function written without brackets, e.g. "sqrt 9" or "sin30"
          const arg = parseUnary();
          return applyFunc(lower, arg);
        }
        if (Object.prototype.hasOwnProperty.call(vars, name)) {
          const val = vars[name];
          if (typeof val !== 'number' || !Number.isFinite(val)) throw new CalcError('Variable "' + name + '" has no value', 'var');
          return val;
        }
        if (Object.prototype.hasOwnProperty.call(CONSTS, name) || Object.prototype.hasOwnProperty.call(CONSTS, lower)) {
          return CONSTS[name] != null ? CONSTS[name] : CONSTS[lower];
        }
        throw new CalcError('Unknown symbol "' + name + '"', 'unknown');
      }
      throw new CalcError('Unexpected "' + t.v + '"', 'syntax');
    }

    function applyFunc(name, x) {
      const f = FUNCS[name];
      if (f === 'trig') {
        if (name === 'tan' && angle === 'DEG' && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-12) throw new CalcError('tan is undefined here', 'domain');
        const r = Math[name](toRad(x));
        return trigClean(r);
      }
      if (f === 'itrig') {
        if ((name === 'asin' || name === 'acos') && (x < -1 || x > 1)) throw new CalcError('Input must be between −1 and 1', 'domain');
        return trigClean(fromRad(Math[name](x)));
      }
      if (f === 'fact') return factorial(x);
      if (name === 'ln' || name === 'log' || name === 'log10' || name === 'log2') {
        if (x <= 0) throw new CalcError('Logarithm needs a positive number', 'domain');
      }
      if (name === 'sqrt' || name === '√') { if (x < 0) throw new CalcError('Square root of a negative number is not real', 'domain'); }
      const r = f(x);
      if (Number.isNaN(r)) throw new CalcError('Result is not a real number', 'domain');
      return r;
    }

    const result = parseExpr();
    if (p < toks.length) {
      const t = toks[p];
      throw new CalcError(t.v === ')' ? 'Unmatched closing bracket' : 'Unexpected "' + t.v + '"', 'syntax');
    }
    if (!Number.isFinite(result)) throw new CalcError(Number.isNaN(result) ? 'Result is not a number' : 'Result too large', 'overflow');
    return cleanNoise(result);
  }

  // Rounds away binary floating-point noise: 0.1+0.2 → 0.3. Relative, so 3.3e-19 survives.
  function cleanNoise(x) {
    if (!Number.isFinite(x)) return x;
    return parseFloat(x.toPrecision(14));
  }
  // Trig outputs only: sin(180°) = 1.2e-16 is really 0. (Absolute threshold is safe for values in [-1,1];
  // inverse-trig outputs are angles, so the same tiny-value rule is also safe there.)
  function trigClean(x) {
    if (!Number.isFinite(x)) return x;
    return Math.abs(x) < 1e-14 ? 0 : cleanNoise(x);
  }

  // Display formatting: up to 10 significant digits, scientific notation for very large/small.
  function format(x, opts) {
    opts = opts || {};
    if (x === 0) return '0';
    const sig = opts.sig || 10;
    const abs = Math.abs(x);
    if (abs >= 1e10 || abs < 1e-6 || opts.sci) {
      const s = x.toExponential(Math.max(0, sig - 1)).replace(/\.?0+e/, 'e');
      const [m, ex] = s.split('e');
      return m + '×10^' + parseInt(ex, 10);
    }
    return String(parseFloat(x.toPrecision(sig)));
  }

  // Continued-fraction conversion; returns null when no small exact-looking fraction exists.
  function toFraction(x, maxDen) {
    maxDen = maxDen || 10000;
    if (!Number.isFinite(x)) return null;
    if (Number.isInteger(x)) return { n: x, d: 1 };
    const sign = x < 0 ? -1 : 1; let v = Math.abs(x);
    let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = v;
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(b);
      const h2 = a * h1 + h0, k2 = a * k1 + k0;
      if (k2 > maxDen) return null;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(v - h1 / k1) < 1e-10 * Math.max(1, v)) return { n: sign * h1, d: k1 };
      const frac = b - a;
      if (frac < 1e-12) break;
      b = 1 / frac;
    }
    return null;
  }

  function formatFraction(f) {
    if (!f) return '';
    if (f.d === 1) return String(f.n);
    const w = Math.trunc(f.n / f.d), r = Math.abs(f.n) % f.d;
    return (Math.abs(f.n) > f.d && r ? w + ' ' + r + '/' + f.d + '  (' + f.n + '/' + f.d + ')' : f.n + '/' + f.d);
  }

  // Returns {ok:true,value} | {ok:false,error,code} — never throws for user input.
  function safeEvaluate(src, opts) {
    try { return { ok: true, value: evaluate(src, opts) }; }
    catch (e) {
      if (e instanceof CalcError) return { ok: false, error: e.message, code: e.code };
      return { ok: false, error: 'Invalid expression', code: 'syntax' };
    }
  }

  const api = { evaluate, safeEvaluate, format, toFraction, formatFraction, tokenize, CalcError, factorial, cleanNoise, trigClean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SMCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
