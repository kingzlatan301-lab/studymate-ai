/**
 * StudyMate AI — Study Partner Engine
 * ─────────────────────────────────────────────────────────────────────────
 * Turns the attempts the app ALREADY records (WeaknessProfile: subject, topic,
 * ts, level knew/shaky/lost, difficulty, mistakeType) into three things:
 *
 *   1. Evidence per topic  — accuracy, consistency, difficulty reached, how
 *      independent the successes were, and whether they were spread over time.
 *   2. A review schedule   — which topics are due, slipping or forgotten.
 *   3. A recommendation    — the single most useful next action, with a
 *      plain-language reason, a suggested difficulty and a teaching method.
 *
 * DESIGN RULES
 *  • Pure functions over plain data (no storage, no network, no DOM) so it is
 *    unit-testable in Node and identical on every device. No schema change:
 *    attempts already sync across devices via weakness-sync.js.
 *  • Never invents data. No evidence → no claim ("not_started"), and the
 *    recommendation says so honestly.
 *  • No arbitrary mastery score. "Mastered" requires enough attempts, high
 *    accuracy, success at Medium+ difficulty on non-guided attempts, and
 *    success on at least two different days (so one cramming session or a
 *    guided lesson mini-test can never count as mastery).
 *  • Everything is explainable: each result carries the evidence it used and
 *    a `reason` string a student can read.
 *  • Prerequisite gaps are NOT inferred: the curriculum data has no prerequisite
 *    links, so this file does not pretend to know them. See docs/STUDY-PARTNER.md.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const LEVEL_SCORE = { knew: 1, shaky: 0.5, lost: 0 };
  const DIFFS = ['Easy', 'Medium', 'Hard', 'Exam'];
  // Guided = the answer was given or taught moments earlier, so success there is weaker evidence.
  const GUIDED = new Set(['Teach Me']);
  const WINDOW = 12;                                // most recent attempts used per topic
  const REVIEW_STEPS = [1, 3, 7, 14, 30];           // days; index = consecutive successes
  const MIN_ATTEMPTS = 3;                           // below this: no verdict about a topic
  const SLIP_DROP = 0.25;                           // fall from earlier best that counts as slipping

  const isNum = Number.isFinite;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const weightOf = a => (GUIDED.has(a.difficulty) ? 0.6 : 1) * (a.difficulty === 'Hard' || a.difficulty === 'Exam' ? 1.2 : 1);

  function wavg(list) {
    let s = 0, w = 0;
    list.forEach(a => { const x = weightOf(a); s += LEVEL_SCORE[a.level] * x; w += x; });
    return w ? s / w : null;
  }

  /** Evidence for one topic. `attempts` = that topic's attempts, any order. */
  function topicEvidence(attempts, now) {
    now = isNum(now) ? now : Date.now();
    const list = (attempts || []).filter(a => a && isNum(a.ts) && LEVEL_SCORE.hasOwnProperty(a.level))
      .sort((a, b) => a.ts - b.ts).slice(-WINDOW);
    const n = list.length;
    if (!n) return { state: 'not_started', attempts: 0 };

    const acc = wavg(list);
    const last = list[n - 1];
    let streak = 0;                                   // consecutive 'knew' at the end
    for (let i = n - 1; i >= 0 && list[i].level === 'knew'; i--) streak++;

    // Best earlier performance (everything except the last 2) → used to spot slipping.
    const earlier = list.slice(0, Math.max(0, n - 2));
    const earlierAcc = earlier.length >= 3 ? wavg(earlier) : null;
    const lastTwo = wavg(list.slice(-2));
    const slipping = earlierAcc !== null && earlierAcc >= 0.75 && lastTwo !== null && earlierAcc - lastTwo >= SLIP_DROP;

    const independent = list.filter(a => a.level === 'knew' && !GUIDED.has(a.difficulty) && (a.difficulty === 'Medium' || a.difficulty === 'Hard' || a.difficulty === 'Exam'));
    const daysWithSuccess = new Set(independent.map(a => Math.floor(a.ts / DAY))).size;
    const hardestWon = independent.reduce((m, a) => Math.max(m, DIFFS.indexOf(a.difficulty)), -1);

    const counts = {};
    list.forEach(a => { if (a.mistakeType) counts[a.mistakeType] = (counts[a.mistakeType] || 0) + 1; });
    const repeatedMistake = Object.keys(counts).filter(m => counts[m] >= 2).sort((a, b) => counts[b] - counts[a])[0] || null;

    // Review timing: each consecutive success earns a longer gap; a miss resets it.
    const step = last.level === 'knew' ? clamp(streak - 1, 0, REVIEW_STEPS.length - 1) : last.level === 'shaky' ? 0 : 0;
    const intervalDays = last.level === 'lost' ? 0 : REVIEW_STEPS[step];
    const nextReviewTs = last.ts + intervalDays * DAY;
    const overdueDays = Math.max(0, Math.floor((now - nextReviewTs) / DAY));

    // Mastery reflects CURRENT ability: judged on the latest six attempts, so early mistakes made
    // while still learning don't block it forever, but it still needs independent wins on 2+ days.
    const recentAcc = wavg(list.slice(-6));
    const mastered = n >= 5 && recentAcc >= 0.85 && independent.length >= 2 && daysWithSuccess >= 2 && !slipping;
    let stateName;
    if (n < MIN_ATTEMPTS) stateName = 'early';
    else if (slipping) stateName = 'slipping';
    else if (mastered) stateName = 'mastered';
    else if (acc >= 0.7) stateName = 'solid';
    else if (acc >= 0.45) stateName = 'developing';
    else stateName = 'struggling';

    return {
      state: stateName, attempts: n, accuracyPct: Math.round(acc * 100), streak, slipping,
      independentWins: independent.length, daysWithSuccess, hardestWon: hardestWon >= 0 ? DIFFS[hardestWon] : null,
      repeatedMistake, lastLevel: last.level, lastTs: last.ts, daysSinceLast: Math.max(0, Math.floor((now - last.ts) / DAY)),
      nextReviewTs, overdueDays, dueForReview: n >= 2 && now >= nextReviewTs
    };
  }

  /** Difficulty to try next on this topic. Gentle: moves at most one step. */
  function suggestDifficulty(ev) {
    if (!ev || ev.state === 'not_started') return 'Easy';
    if (ev.state === 'early') return ev.accuracyPct >= 70 ? 'Medium' : 'Easy';
    if (ev.state === 'struggling') return 'Easy';
    if (ev.state === 'slipping') return 'Medium';
    if (ev.state === 'developing') return 'Medium';
    const reached = ev.hardestWon ? DIFFS.indexOf(ev.hardestWon) : 1;
    if (ev.state === 'mastered') return DIFFS[clamp(reached + 1, 2, 3)];
    return DIFFS[clamp(reached + (ev.streak >= 3 ? 1 : 0), 1, 3)];   // solid
  }

  // ── Subject-aware teaching methods ───────────────────────────────────────
  // The CLIENT only ever sends a method KEY; the server maps it to fixed text,
  // so no client-supplied string can become a prompt instruction.
  const FAMILIES = [
    ['maths',    /math|algebra|calculus|statistic|geometry|further/i],
    ['science',  /physic|chem/i],
    ['biology',  /biolog|health|agric|human/i],
    ['language', /english|literature|language|french|spanish|writing|reading|comprehension/i],
    ['humanities', /histor|geograph|government|civic|econom|social|religio|politic|commerce|account/i],
    ['computing', /comput|program|coding|ict|informatics/i]
  ];
  const METHOD_BY_FAMILY = {
    maths:      { struggling: 'worked_steps', developing: 'worked_steps', slipping: 'retrieval', solid: 'exam_focus', mastered: 'socratic', early: 'worked_steps' },
    science:    { struggling: 'analogy', developing: 'worked_steps', slipping: 'retrieval', solid: 'exam_focus', mastered: 'socratic', early: 'analogy' },
    biology:    { struggling: 'analogy', developing: 'visual', slipping: 'retrieval', solid: 'exam_focus', mastered: 'socratic', early: 'analogy' },
    language:   { struggling: 'simple', developing: 'worked_steps', slipping: 'retrieval', solid: 'exam_focus', mastered: 'socratic', early: 'simple' },
    humanities: { struggling: 'simple', developing: 'cause_effect', slipping: 'retrieval', solid: 'exam_focus', mastered: 'socratic', early: 'simple' },
    computing:  { struggling: 'worked_steps', developing: 'worked_steps', slipping: 'retrieval', solid: 'exam_focus', mastered: 'socratic', early: 'worked_steps' }
  };
  const METHODS = ['simple', 'worked_steps', 'analogy', 'socratic', 'summary', 'retrieval', 'exam_focus', 'cause_effect', 'visual', 'derivation'];

  function subjectFamily(subject) {
    const s = String(subject || '');
    const hit = FAMILIES.find(f => f[1].test(s));
    return hit ? hit[0] : null;
  }
  function suggestMethod(subject, ev) {
    const fam = subjectFamily(subject);
    const st = ev && ev.state;
    if (!st || st === 'not_started') return fam === 'maths' || fam === 'computing' ? 'worked_steps' : 'simple';
    // A repeated mistake always gets a worked, corrective walk-through first.
    if (ev.repeatedMistake && st !== 'mastered') return 'worked_steps';
    // Strong maths/science students who already win Hard questions benefit from seeing WHY the formula holds.
    if (st === 'solid' && (fam === 'maths' || fam === 'science') && ev.hardestWon === 'Hard') return 'derivation';
    const table = METHOD_BY_FAMILY[fam] || { struggling: 'simple', developing: 'worked_steps', slipping: 'retrieval', solid: 'exam_focus', mastered: 'socratic', early: 'simple' };
    return table[st] || 'simple';
  }

  /**
   * Builds ranked next actions.
   * input = { attempts: [{subject, topic, ts, level, difficulty, mistakeType}],
   *           now, examDays?: { [subject]: daysUntilExam }, curriculumTopics?: { [subject]: [names] },
   *           subject?: restrict to one subject, limit?: number }
   * Returns [{ type, subject, topic, reason, difficulty, method, priority, evidence }]
   * types: 'review' | 'fix' | 'practise' | 'start'
   */
  function recommend(input) {
    input = input || {};
    const now = isNum(input.now) ? input.now : Date.now();
    const all = (input.attempts || []).filter(a => a && a.subject && isNum(a.ts));
    const bySub = {};
    all.forEach(a => {
      if (input.subject && a.subject !== input.subject) return;
      const t = a.topic || 'General';
      ((bySub[a.subject] = bySub[a.subject] || {})[t] = bySub[a.subject][t] || []).push(a);
    });

    const out = [];
    Object.keys(bySub).forEach(subject => {
      const examDays = input.examDays && isNum(input.examDays[subject]) ? input.examDays[subject] : null;
      const examBoost = examDays !== null && examDays >= 0 && examDays <= 21 ? 15 : 0;
      const evMap = {};
      Object.keys(bySub[subject]).forEach(topic => {
        const ev = topicEvidence(bySub[subject][topic], now);
        evMap[topic] = ev;
        if (ev.state === 'not_started') return;
        const base = { subject, topic, evidence: ev, difficulty: suggestDifficulty(ev), method: suggestMethod(subject, ev) };
        const label = topic === 'General' ? subject : topic;

        // Every reason is a TEMPLATE plus variables, so the app can translate the sentence and fill in the names.
        // `reason` stays the filled English sentence (used by tests, logs and as the fallback).
        const R = (tpl, vars) => ({ reasonTpl: tpl, reasonVars: vars, reason: tpl.replace(/\{(\w+)\}/g, (m, k) => String(vars[k])) });
        if (ev.state === 'slipping') {
          out.push({ ...base, type: 'review', priority: 90 + examBoost,
            ...R('{label} was going well, but your last couple of answers were shakier. A quick refresher now stops it fading.', { label }) });
        } else if (ev.state === 'struggling' && ev.attempts >= MIN_ATTEMPTS) {
          out.push({ ...base, type: 'fix', priority: 80 + examBoost + (ev.repeatedMistake ? 5 : 0),
            ...(ev.repeatedMistake
              ? R("The same kind of slip keeps coming up in {label} ({mistake}). Let's work through it step by step, then try again.", { label, mistake: ev.repeatedMistake })
              : R("{label} is still tricky ({pct}% over your last {n} tries). Let's go back over the idea before more questions.", { label, pct: ev.accuracyPct, n: ev.attempts })) });
        } else if (ev.dueForReview && ev.state !== 'early') {
          out.push({ ...base, type: 'review', priority: 50 + Math.min(20, ev.overdueDays) + examBoost,
            ...(ev.overdueDays > 0
              ? (ev.daysSinceLast === 1
                ? R("It's been 1 day since {label}. A short recall round now helps it stick for the exam.", { label })
                : R("It's been {d} days since {label}. A short recall round now helps it stick for the exam.", { label, d: ev.daysSinceLast }))
              : R("It's time to revisit {label}. A short recall round now helps it stick for the exam.", { label })) });
        } else if (ev.state === 'developing' || ev.state === 'early') {
          out.push({ ...base, type: 'practise', priority: 40 + examBoost,
            ...R("You're getting there on {label}. A few more questions will show whether it has really clicked.", { label }) });
        } else if (ev.state === 'solid') {
          out.push({ ...base, type: 'practise', priority: 25 + examBoost,
            ...R('{label} is going well. Try a harder question to check you can do it without help.', { label }) });
        }
        // 'mastered' topics produce no action until they come due for a spaced review (handled above).
      });

      // Foundation gaps: ONLY from verified prerequisite links supplied by the curriculum (input.prerequisites).
      // Without links nothing is inferred. A prerequisite counts as a gap when the student has real evidence it is shaky,
      // or has never practised it while struggling with the topic that builds on it.
      const prereq = input.prerequisites && input.prerequisites[subject];
      if (prereq) Object.keys(evMap).forEach(topic => {
        const ev = evMap[topic];
        if (ev.state !== 'struggling' && ev.state !== 'slipping') return;
        const list = (Array.isArray(prereq[topic]) ? prereq[topic] : []).filter(n => typeof n === 'string' && n && n !== topic);
        let measured = null, unmeasured = null;
        list.forEach(pn => {
          const pev = evMap[pn];
          if (!pev) { if (!unmeasured) unmeasured = pn; return; }
          if ((pev.state === 'struggling' || pev.state === 'developing') && pev.attempts >= MIN_ATTEMPTS && (!measured || pev.accuracyPct < evMap[measured].accuracyPct)) measured = pn;
        });
        const label = topic === 'General' ? subject : topic;
        if (measured) {
          const pev = evMap[measured];
          out.push({ type: 'fix', subject, topic: measured, priority: 85 + examBoost, evidence: pev, difficulty: 'Easy', method: suggestMethod(subject, pev), blocks: topic,
            reasonTpl: '{label} builds on {pre}, and {pre} is still shaky ({pct}%). Firm that up first, then come back.', reasonVars: { label, pre: measured, pct: pev.accuracyPct },
            reason: `${label} builds on ${measured}, and ${measured} is still shaky (${pev.accuracyPct}%). Firm that up first, then come back.` });
        } else if (unmeasured) {
          out.push({ type: 'start', subject, topic: unmeasured, priority: 70 + examBoost, evidence: { state: 'not_started', attempts: 0 }, difficulty: 'Easy', method: suggestMethod(subject, null), blocks: topic,
            reasonTpl: "{label} builds on {pre}, and you haven't practised {pre} yet. A short lesson on it first would help.", reasonVars: { label, pre: unmeasured },
            reason: `${label} builds on ${unmeasured}, and you haven't practised ${unmeasured} yet. A short lesson on it first would help.` });
        }
      });

      // Curriculum topics the student has never touched (only if the curriculum lists them).
      const names = (input.curriculumTopics && input.curriculumTopics[subject]) || [];
      const touched = new Set(Object.keys(bySub[subject]));
      const untouched = names.filter(n => !touched.has(n));
      if (untouched.length && Object.keys(bySub[subject]).length) {
        out.push({ type: 'start', subject, topic: untouched[0], priority: 20, evidence: { state: 'not_started', attempts: 0 },
          difficulty: 'Easy', method: suggestMethod(subject, null),
          reasonTpl: "You haven't tried {topic} in {subject} yet. A short lesson would widen what you've covered.", reasonVars: { topic: untouched[0], subject },
          reason: `You haven't tried ${untouched[0]} in ${subject} yet. A short lesson would widen what you've covered.` });
      }
    });

    // One entry per topic: keep the most urgent (a prerequisite fix can coincide with another reason for the same topic).
    const best = new Map();
    out.forEach(r => { const k = r.subject + '|' + r.topic; if (!best.has(k) || r.priority > best.get(k).priority) best.set(k, r); });
    out.length = 0; best.forEach(r => out.push(r));
    out.sort((a, b) => b.priority - a.priority || a.subject.localeCompare(b.subject) || String(a.topic).localeCompare(String(b.topic)));
    return out.slice(0, input.limit || 5);
  }

  /**
   * Real progress worth celebrating, from evidence only: a topic that was struggling/developing/slipping
   * before the latest 3 attempts and is now solid or mastered. Needs 3+ earlier attempts so there is a
   * genuine "before". Only topics practised within `recentDays`. Each item has a stable `key` so the app
   * can show a given celebration once.
   */
  function milestones(attempts, now, recentDays) {
    now = isNum(now) ? now : Date.now();
    const within = (isNum(recentDays) ? recentDays : 3) * DAY;
    const groups = {};
    (attempts || []).forEach(a => {
      if (!a || !a.subject || !isNum(a.ts) || !LEVEL_SCORE.hasOwnProperty(a.level)) return;
      const t = a.topic || 'General';
      ((groups[a.subject] = groups[a.subject] || {})[t] = groups[a.subject][t] || []).push(a);
    });
    const out = [];
    Object.keys(groups).forEach(subject => Object.keys(groups[subject]).forEach(topic => {
      const list = groups[subject][topic].sort((x, y) => x.ts - y.ts);
      if (list.length < 6) return;
      const nowEv = topicEvidence(list, now);
      if (now - nowEv.lastTs > within) return;
      const before = topicEvidence(list.slice(0, -3), now);
      const weakBefore = before.state === 'struggling' || before.state === 'developing' || before.state === 'slipping';
      if (!weakBefore) return;
      const recent3 = wavg(list.slice(-3));
      let kind = null;
      if (nowEv.state === 'mastered') kind = 'mastered';
      else if (nowEv.state === 'solid') kind = 'improved';
      // A clear recovery in the latest tries after real struggle: smaller claim, honest wording ("progress", not "solid").
      else if (nowEv.state === 'developing' && (before.state === 'struggling' || before.state === 'slipping') && recent3 >= 0.83 && nowEv.accuracyPct - before.accuracyPct >= 30) kind = 'progress';
      if (kind) out.push({ kind, subject, topic, beforePct: before.accuracyPct, nowPct: nowEv.accuracyPct, key: [subject, topic, nowEv.state, nowEv.lastTs].join('|') });
    }));
    const rank = { mastered: 3, improved: 2, progress: 1 };
    return out.sort((a, b) => rank[b.kind] - rank[a.kind] || (b.nowPct - b.beforePct) - (a.nowPct - a.beforePct));
  }

  /** The most recently studied topic, or null. Used to continue where the student left off. */
  function lastStudied(attempts, now) {
    now = isNum(now) ? now : Date.now();
    let best = null;
    (attempts || []).forEach(a => { if (a && a.subject && isNum(a.ts) && (!best || a.ts > best.ts)) best = a; });
    if (!best) return null;
    // Calendar days on the student's own clock: something studied at 9pm last night is "yesterday" at 8am today, not "today".
    const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const daysAgo = Math.max(0, Math.round((startOfDay(now) - startOfDay(best.ts)) / DAY));
    return { subject: best.subject, topic: best.topic && best.topic !== 'General' ? best.topic : null, daysAgo, ts: best.ts };
  }

  /** Counts for the home card / Bagley: only real, evidence-based numbers. */
  function summary(input) {
    input = input || {};
    const now = isNum(input.now) ? input.now : Date.now();
    const recs = recommend({ ...input, now, limit: 1000 });
    return {
      dueCount: recs.filter(r => r.type === 'review').length,
      fixCount: recs.filter(r => r.type === 'fix').length,
      next: recs[0] || null
    };
  }

  root.StudyEngine = { topicEvidence, suggestDifficulty, suggestMethod, subjectFamily, recommend, summary, milestones, lastStudied, METHODS, DIFFS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.StudyEngine;
})(typeof window !== 'undefined' ? window : globalThis);
