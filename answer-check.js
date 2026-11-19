/**
 * StudyMate AI — Arithmetic check for AI answers
 * ─────────────────────────────────────────────────────────────────────────
 * Finds plain numeric statements such as "12 × 3 = 36" or "(4 + 5) / 3 = 3" in an answer and
 * re-computes them with the calculator engine (no eval). Returns only statements that are
 * demonstrably wrong. It deliberately ignores anything it cannot judge with certainty
 * (algebra, units, percentages, chains with letters), so it never raises a false alarm on
 * valid working. It checks arithmetic only; it cannot prove an answer is correct.
 */
(function (root) {
  'use strict';
  const NUM = '\\(*-?\\d+(?:\\.\\d+)?\\)*';
  const OP = '\\s*[+\\-*/×÷^]\\s*';
  const RE = new RegExp('(' + NUM + '(?:' + OP + NUM + ')+)\\s*=\\s*(-?\\d+(?:\\.\\d+)?)', 'g');
  const OK_BEFORE = new Set(['', '=', ':', ';', ',', '.', '$', '\n', '>', '*']);   // what may precede the left-hand side
  const MAX_CHECKS = 20;

  function decimals(s) { const m = /\.(\d+)$/.exec(s); return m ? m[1].length : 0; }

  function check(texts, calc) {
    calc = calc || root.SMCalc || (typeof require === 'function' ? require('./calc-engine.js') : null);
    if (!calc || !calc.evaluate) return [];
    const bad = [];
    let n = 0;
    (Array.isArray(texts) ? texts : [texts]).forEach(t => {
      if (typeof t !== 'string' || !t) return;
      const src = t.replace(/\u2212/g, '-').replace(/\u00d7/g, '×');
      RE.lastIndex = 0;
      let m;
      while ((m = RE.exec(src)) && n < MAX_CHECKS) {
        const lhs = m[1], claimedStr = m[2];
        const raw = m.index > 0 ? src[m.index - 1] : '';
        if (/[\d,.A-Za-z]/.test(raw)) continue;                                          // 1,000 / 3.14 / 5x: not the start of a statement
        const before = src.slice(0, m.index).replace(/[ \t]+$/, '');
        const prev = before.slice(-1);
        const prose = /(?:^|[\s(])(?!sin$|cos$|tan$|log$|ln$|sqrt$|exp$)[A-Za-z]{2,}$/i.test(before);   // "so 7 * 8 = 54"
        if (!OK_BEFORE.has(prev) && !prose) continue;                                    // part of a larger/algebraic expression
        const after = src.slice(m.index + m[0].length);
        if (/^\s*(?:[a-zA-Z%°]|[+\-*/×÷^(]|\d|\.\d)/.test(after)) continue;               // RHS continues: not a finished statement
        let actual;
        try { actual = calc.evaluate(lhs); } catch (_) { continue; }
        if (typeof actual !== 'number' || !Number.isFinite(actual)) continue;
        n++;
        const claimed = Number(claimedStr);
        const tol = 0.5 * Math.pow(10, -decimals(claimedStr)) + 1e-9;                    // allows honest rounding
        if (Math.abs(actual - claimed) > tol) {
          bad.push({ expr: lhs.replace(/\s+/g, ' ').trim(), claimed: claimedStr, actual: Number(actual.toPrecision(10)) });
        }
      }
    });
    return bad;
  }

  /** One short, kind sentence for the first problem found, or ''. */
  function note(texts, calc) {
    const b = check(texts, calc);
    if (!b.length) return '';
    const x = b[0];
    return `Arithmetic check: ${x.expr} comes to ${x.actual}, but the working shows ${x.claimed}. Double-check this step before you rely on it.`;
  }

  root.SMAnswerCheck = { check, note };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SMAnswerCheck;
})(typeof window !== 'undefined' ? window : globalThis);
