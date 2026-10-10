/**
 * StudyMate AI — Bagley Personal Context (client side)
 * ─────────────────────────────────────────────────────────────────────────
 * Builds ONE compact, structured "who is this student right now" object that
 * is sent to /api/ask alongside an Ask AI question. The server (see
 * api/_lib/bagley-context.js) re-validates it, trims it to the student's plan
 * depth, and turns it into the prompt block both Gemini (Free) and Claude
 * (Premium) receive.
 *
 * This is deliberately NOT an agent: no tools, no memory writes, no
 * background work. It is a pure function over data the app already holds for
 * the signed-in account (profile row, Weakness Profile, saved questions).
 *
 * RULES THIS FILE ENFORCES
 *  • Only fields that exist are included. Missing data is omitted, never
 *    guessed, so the AI can't be handed a "fact" that isn't real.
 *  • Only data relevant to THIS request is included: weakness/strength lists
 *    and recent activity are scoped to the current subject, not the whole
 *    database.
 *  • No internal ids, emails, tokens or payment data are ever included.
 *  • Visual Presets (background/accent/Bagley variant) are intentionally NOT
 *    sent — they don't help answer a question.
 *
 * `build()` is pure (all inputs passed in) so it can be unit-tested in Node:
 * see tests/bagley-context.test.js.
 */
(function (root) {
  'use strict';

  const MAX = {
    weak: 5, strong: 3, revision: 3, mistakes: 4,
    recentTopics: 4, recentSubjects: 3, recentQuestions: 5, text: 90
  };
  const MIN_ATTEMPTS_FOR_BAND = 3;   // below this we make NO claim about level
  const LEVEL_SCORE = { knew: 1, shaky: 0.5, lost: 0 };
  const LOW = new Set(['Beginner', 'Developing']);
  const HIGH = new Set(['Strong', 'Mastered']);
  const STOP = new Set(['the', 'and', 'of', 'in', 'to', 'a', 'an', 'for', 'with', 'on', 'by', 'from', 'basic', 'basics', 'introduction']);

  const ROUTINES = {
    daily: 'studies daily',
    often: 'studies a few times a week',
    crammer: 'mostly studies before tests',
    starting: 'just starting out'
  };

  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > (n || MAX.text) ? s.slice(0, (n || MAX.text) - 1).trimEnd() + '…' : s;
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function words(s) { return norm(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w)); }

  // Finds which known topic (curriculum or weakness-profile) the question is
  // about, if any. Conservative on purpose: no match is better than a wrong one.
  function matchTopic(question, names) {
    const q = ' ' + norm(question) + ' ';
    if (q.trim().length < 3) return null;
    let best = null;
    (names || []).forEach(name => {
      const n = norm(name);
      if (!n || n === 'general') return;
      let score = 0;
      if (q.includes(' ' + n + ' ')) score = 100 + n.length;
      else {
        const w = words(name);
        if (w.length >= 2 && w.every(x => q.includes(x))) score = 50 + w.length;
      }
      if (score && (!best || score > best.score)) best = { name, score };
    });
    return best ? best.name : null;
  }

  function bandOf(mastery, attempts) {
    if (!attempts || attempts < MIN_ATTEMPTS_FOR_BAND) return null;
    if (LOW.has(mastery)) return 'low';
    if (HIGH.has(mastery)) return 'high';
    if (mastery === 'Competent') return 'medium';
    return null;
  }

  function pctOf(attempts) {
    if (!attempts.length) return null;
    return Math.round(attempts.reduce((s, a) => s + (LEVEL_SCORE[a.level] || 0), 0) / attempts.length * 100);
  }

  /**
   * input = {
   *   profile:  { name, countryName, examLabel, studyClass, studyRoutine, languageLabel },
   *   subject, question,
   *   curriculumTopics: [topic names for this subject],
   *   weakness: WeaknessProfile-like { getTopics(subject), getAllAttempts(), getReadiness?() },
   *   savedQuestions: [{ question, subject, time }]   // newest first
   * }
   * Returns a plain object, or null when there is truly nothing to add.
   */
  function build(input) {
    input = input || {};
    const p = input.profile || {};
    const subject = clip(input.subject, 60);
    const ctx = {};

    // ── Student identity / academic profile (only what's actually set) ──
    const student = {};
    if (p.name) student.name = clip(p.name, 30);
    if (p.countryName) student.country = clip(p.countryName, 40);
    if (p.examLabel) student.exam = clip(p.examLabel, 60);
    if (p.studyClass) student.class = clip(p.studyClass, 40);
    if (p.languageLabel && p.languageLabel !== 'English') student.language = clip(p.languageLabel, 30);
    if (Object.keys(student).length) ctx.student = student;

    if (p.studyRoutine && ROUTINES[p.studyRoutine]) ctx.learning = { routine: ROUTINES[p.studyRoutine] };

    // ── Performance (scoped to the current subject) ──
    const w = input.weakness;
    let topics = [], attempts = [];
    try {
      if (w && subject) {
        topics = (w.getTopics(subject) || []).filter(t => t.attempts > 0);
        attempts = (w.getAllAttempts() || []).filter(a => a.subject === subject).sort((a, b) => b.ts - a.ts);
      }
    } catch (_) { topics = []; attempts = []; }

    const known = (topics.map(t => t.topic)).concat(input.curriculumTopics || []);
    const matched = matchTopic(input.question, known);
    const matchedStats = matched ? topics.find(t => t.topic === matched) : null;

    const perf = {};
    const weak = topics.filter(t => LOW.has(t.mastery) && t.attempts >= 2)
      .sort((a, b) => a.accuracyPct - b.accuracyPct).slice(0, MAX.weak)
      .map(t => ({ topic: clip(t.topic, 60), mastery: t.mastery, accuracyPct: t.accuracyPct, trend: t.trend }));
    const strong = topics.filter(t => HIGH.has(t.mastery)).slice(0, MAX.strong)
      .map(t => ({ topic: clip(t.topic, 60), mastery: t.mastery }));
    const revision = topics.filter(t => t.trend === 'declining').slice(0, MAX.revision).map(t => clip(t.topic, 60));
    if (weak.length) perf.weakTopics = weak;
    if (strong.length) perf.strongTopics = strong;
    if (revision.length) perf.needsRevision = revision;

    // Level for THIS question: the matched topic if we have enough data on
    // it, otherwise the subject as a whole. No data → no band → no claim.
    let band = null, basis = null;
    if (matchedStats) {
      band = bandOf(matchedStats.mastery, matchedStats.attempts);
      if (band) basis = 'topic';
    }
    if (!band && topics.length) {
      const total = topics.reduce((s, t) => s + t.attempts, 0);
      const acc = topics.reduce((s, t) => s + t.accuracyPct * t.attempts, 0) / total;
      band = total >= MIN_ATTEMPTS_FOR_BAND ? (acc >= 75 ? 'high' : acc >= 55 ? 'medium' : 'low') : null;
      if (band) basis = 'subject';
    }
    if (band) { perf.level = band; perf.levelBasis = basis; }
    if (matchedStats) {
      perf.thisTopic = {
        topic: clip(matchedStats.topic, 60), mastery: matchedStats.mastery,
        accuracyPct: matchedStats.accuracyPct, trend: matchedStats.trend, attempts: matchedStats.attempts
      };
    }

    const recent = attempts.slice(0, 5);
    if (recent.length >= 3) perf.recentAccuracyPct = pctOf(recent);

    // Mistakes: for the matched topic if there is one, else the subject's.
    const mistakePool = (matchedStats ? matchedStats.recentMistakes : topics.flatMap(t => t.recentMistakes || [])) || [];
    const mistakes = [...new Set(mistakePool)].slice(0, MAX.mistakes).map(m => clip(m, 50));
    if (mistakes.length) perf.recentMistakes = mistakes;
    if (matchedStats) {
      const counts = {};
      (matchedStats.recentMistakes || []).forEach(m => { counts[m] = (counts[m] || 0) + 1; });
      const repeated = Object.keys(counts).filter(m => counts[m] >= 2);
      if (repeated.length) perf.repeatedMistake = clip(repeated[0], 50);
    }

    try {
      if (w && w.getReadiness) {
        const r = w.getReadiness(subject, (input.curriculumTopics || []).length || null);
        if (r && typeof r.readinessPct === 'number') perf.readinessPct = r.readinessPct;
      }
    } catch (_) { /* readiness is optional */ }
    if (Object.keys(perf).length) ctx.performance = perf;

    // ── Recent activity (subject-scoped, truncated) ──
    const act = {};
    const recentTopics = [...new Set(attempts.map(a => a.topic).filter(t => t && t !== 'General'))].slice(0, MAX.recentTopics).map(t => clip(t, 60));
    if (recentTopics.length) act.recentTopics = recentTopics;
    if (attempts.length) act.attemptsInSubject = attempts.length;
    try {
      const all = (w && w.getAllAttempts ? w.getAllAttempts() : []).sort((a, b) => b.ts - a.ts).slice(0, 12);
      const others = [...new Set(all.map(a => a.subject).filter(s => s && s !== subject))].slice(0, MAX.recentSubjects).map(s => clip(s, 40));
      if (others.length) act.otherRecentSubjects = others;
    } catch (_) { /* optional */ }
    const saved = (input.savedQuestions || []).filter(h => h && h.subject === subject && h.question)
      .slice(0, MAX.recentQuestions).map(h => clip(h.question));
    if (saved.length) act.recentSavedQuestions = saved;
    if (Object.keys(act).length) ctx.recentActivity = act;

    // ── Current request ──
    const cur = {};
    if (subject) cur.subject = subject;
    if (matched) cur.topic = clip(matched, 60);
    if (Object.keys(cur).length) ctx.current = cur;

    return Object.keys(ctx).length ? Object.assign({ v: 1 }, ctx) : null;
  }

  // Short text brief for the NON-Ask-AI features (Practice, Teach Me, Study
  // Material, Flashcards) that still build their own prompt string client-side.
  // Reuses build() so there is exactly one place that decides what "weak" means.
  function toBrief(ctx) {
    const perf = ctx && ctx.performance;
    if (!perf) return '';
    const lines = [];
    if (perf.weakTopics && perf.weakTopics.length) {
      lines.push(`Struggling with: ${perf.weakTopics.slice(0, 3).map(t => `${t.topic} (${t.accuracyPct}% recent accuracy)`).join(', ')}.`);
    }
    if (perf.strongTopics && perf.strongTopics.length) {
      lines.push(`Already confident in: ${perf.strongTopics.slice(0, 2).map(t => t.topic).join(', ')} — no need to over-explain these from scratch.`);
    }
    if (perf.recentMistakes && perf.recentMistakes.length) {
      lines.push(`Recent mistake patterns noticed: ${perf.recentMistakes.slice(0, 3).join(', ')}.`);
    }
    if (!(perf.weakTopics && perf.weakTopics.length) && !(perf.strongTopics && perf.strongTopics.length)) return '';
    return `\n\nStudent context for this subject (use only to calibrate depth and target likely confusion naturally — never quote these stats verbatim to the student, and never claim certainty about something not listed here):\n${lines.join('\n')}`;
  }

  root.BagleyContext = { build, toBrief, matchTopic };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BagleyContext;
})(typeof window !== 'undefined' ? window : globalThis);
