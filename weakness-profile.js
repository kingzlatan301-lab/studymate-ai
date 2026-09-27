/**
 * StudyMate AI — Weakness Profile
 * ─────────────────────────────────────────────────────────────────────────
 * Tracks how a student is actually doing, per subject and (where the
 * curriculum model has topic data) per topic, and turns that into a
 * mastery estimate and a trend — the "AI Weakness Profile" core feature.
 *
 * DATA SOURCE TODAY: after each AI Tutor answer, the student self-reports
 * how it went (knew it / shaky / lost me), optionally tagging which topic
 * and what went wrong. That's a real, working signal — not a placeholder —
 * but it's self-reported, not graded. Once Practice Mode / Quiz Mode exist
 * with actual right/wrong answers, route those results through
 * recordAttempt() too (same shape, level: 'knew'|'shaky'|'lost' maps
 * naturally from correct/partial/incorrect) and this file needs no changes.
 *
 * STORAGE: localStorage today (per-device). The shape below is exactly
 * what a `weakness_attempts` table would look like, so moving to a real
 * backend later is a lift-and-shift, not a redesign.
 *
 * NEVER FABRICATE STATS: every getter here returns { attempts: 0, mastery:
 * 'Not Started' } rather than a made-up number when there's no data. The UI
 * must render that as "Not enough data yet", not hide it or guess.
 */

window.WeaknessProfile = (function () {
  const STORAGE_KEY = 'sm_weakness_profile';
  const RECENT_WINDOW = 10;     // attempts considered for the current mastery score
  const MIN_FOR_MASTERED = 5;   // don't call something "Mastered" off 1-2 lucky attempts
  const MIN_FOR_TREND = 4;

  const LEVEL_SCORE = { knew: 1, shaky: 0.5, lost: 0 };

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { subjects: {} };
    } catch {
      return { subjects: {} };
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function getTopicBucket(data, subject, topic) {
    if (!data.subjects[subject]) data.subjects[subject] = { topics: {} };
    if (!data.subjects[subject].topics[topic]) data.subjects[subject].topics[topic] = { attempts: [] };
    return data.subjects[subject].topics[topic];
  }

  function recordAttempt({ subject, topic, level, difficulty, mistakeType }) {
    if (!subject || !LEVEL_SCORE.hasOwnProperty(level)) return null;
    const t = topic || 'General';
    const data = load();
    const bucket = getTopicBucket(data, subject, t);
    // Guard against timestamp collisions when several attempts are recorded
    // synchronously in the same millisecond (e.g. grading a whole mock exam
    // in one tight loop) — ts must stay unique within a bucket since
    // tagMistake() identifies an attempt by exact ts.
    let ts = Date.now();
    const lastTs = bucket.attempts.length ? bucket.attempts[bucket.attempts.length - 1].ts : 0;
    if (ts <= lastTs) ts = lastTs + 1;
    const attempt = { ts, level, difficulty: difficulty || null, mistakeType: mistakeType || null };
    bucket.attempts.push(attempt);
    // Cap history so localStorage doesn't grow unbounded; recent attempts
    // are what mastery/trend actually use.
    if (bucket.attempts.length > 50) bucket.attempts = bucket.attempts.slice(-50);
    save(data);
    return attempt.ts; // lets a caller tag this exact attempt later — see tagMistake()
  }

  // Attaches a mistake type to an attempt already recorded (e.g. Practice
  // Mode grades instantly but asks "what went wrong?" as a follow-up, and
  // Mock Exam only reveals grading at the review screen, well after
  // recordAttempt() ran). Identified by exact timestamp so multiple wrong
  // answers on the same topic in one session each get tagged correctly,
  // not just whichever happens to be most recent.
  function tagMistake({ subject, topic, ts, mistakeType }) {
    if (!subject || !ts || !mistakeType) return false;
    const t = topic || 'General';
    const data = load();
    const bucket = data.subjects[subject] && data.subjects[subject].topics[t];
    if (!bucket) return false;
    const attempt = bucket.attempts.find(a => a.ts === ts);
    if (!attempt) return false;
    attempt.mistakeType = mistakeType;
    save(data);
    return true;
  }

  function scoreToMastery(score, attemptCount) {
    if (attemptCount === 0) return 'Not Started';
    if (attemptCount < 3) return 'Beginner';
    if (score >= 0.9 && attemptCount >= MIN_FOR_MASTERED) return 'Mastered';
    if (score >= 0.75) return 'Strong';
    if (score >= 0.55) return 'Competent';
    if (score >= 0.35) return 'Developing';
    return 'Beginner';
  }

  function computeTopicStats(bucket) {
    const attempts = bucket ? bucket.attempts : [];
    const recent = attempts.slice(-RECENT_WINDOW);
    const attemptCount = recent.length;

    if (attemptCount === 0) {
      return { attempts: 0, accuracyPct: null, mastery: 'Not Started', trend: 'not enough data', recentMistakes: [], oldAccuracyPct: null, newAccuracyPct: null };
    }

    const avgScore = recent.reduce((sum, a) => sum + LEVEL_SCORE[a.level], 0) / attemptCount;
    const mastery = scoreToMastery(avgScore, attemptCount);

    let trend = 'not enough data';
    let oldAccuracyPct = null, newAccuracyPct = null;
    if (attemptCount >= MIN_FOR_TREND) {
      const mid = Math.floor(attemptCount / 2);
      const older = recent.slice(0, mid);
      const newer = recent.slice(mid);
      const olderAvg = older.reduce((s, a) => s + LEVEL_SCORE[a.level], 0) / older.length;
      const newerAvg = newer.reduce((s, a) => s + LEVEL_SCORE[a.level], 0) / newer.length;
      oldAccuracyPct = Math.round(olderAvg * 100);
      newAccuracyPct = Math.round(newerAvg * 100);
      const delta = newerAvg - olderAvg;
      if (delta > 0.15) trend = 'improving';
      else if (delta < -0.15) trend = 'declining';
      else trend = 'stable';
    }

    const recentMistakes = recent.filter(a => a.mistakeType).map(a => a.mistakeType);

    return {
      attempts: attemptCount,
      accuracyPct: Math.round(avgScore * 100),
      mastery,
      trend,
      recentMistakes,
      oldAccuracyPct,
      newAccuracyPct
    };
  }

  function getTopics(subject) {
    const data = load();
    const subjectData = data.subjects[subject];
    if (!subjectData) return [];
    return Object.keys(subjectData.topics).map(topic => ({
      topic,
      ...computeTopicStats(subjectData.topics[topic])
    }));
  }

  function getSubjectSummary(subject) {
    const topics = getTopics(subject);
    const withData = topics.filter(t => t.attempts > 0);
    if (withData.length === 0) {
      return { attempts: 0, accuracyPct: null, mastery: 'Not Started', trend: 'not enough data' };
    }
    const totalAttempts = withData.reduce((s, t) => s + t.attempts, 0);
    const weightedAccuracy = withData.reduce((s, t) => s + (t.accuracyPct * t.attempts), 0) / totalAttempts;
    return {
      attempts: totalAttempts,
      accuracyPct: Math.round(weightedAccuracy),
      mastery: scoreToMastery(weightedAccuracy / 100, totalAttempts),
      trend: null // trend is only meaningful per-topic; a subject blends too much
    };
  }

  function getAllSubjects() {
    const data = load();
    return Object.keys(data.subjects);
  }

  function getWeakestTopics(limit) {
    const data = load();
    const all = [];
    Object.keys(data.subjects).forEach(subject => {
      Object.keys(data.subjects[subject].topics).forEach(topic => {
        const stats = computeTopicStats(data.subjects[subject].topics[topic]);
        if (stats.attempts > 0) all.push({ subject, topic, ...stats });
      });
    });
    all.sort((a, b) => a.accuracyPct - b.accuracyPct);
    return all.slice(0, limit || 5);
  }

  function hasAnyData() {
    return getAllSubjects().length > 0;
  }

  // Flat list of every stored attempt, tagged with its subject/topic —
  // the raw material for getInsights() below.
  function getAllAttempts() {
    const data = load();
    const all = [];
    Object.keys(data.subjects).forEach(subject => {
      Object.keys(data.subjects[subject].topics).forEach(topic => {
        data.subjects[subject].topics[topic].attempts.forEach(a => {
          all.push({ subject, topic, ...a });
        });
      });
    });
    return all;
  }

  // ── PERFORMANCE INSIGHTS (spec item 41) ──
  // Every insight here is computed directly from stored attempts — no AI
  // call, no invented numbers (spec item 42: never fabricate stats). If a
  // sample is too small to say something meaningful, that insight is simply
  // omitted rather than forced. Returns [] when there's nothing to say yet;
  // the caller must render that as "not enough data", not hide the section.
  const MIN_DIFFICULTY_SAMPLE = 4;
  const MIN_DIFFICULTY_GAP = 15; // percentage points
  const LOW_DIFFICULTIES = ['Easy', 'Medium'];
  const HIGH_DIFFICULTIES = ['Hard', 'Exam'];

  function pctFrom(attempts) {
    if (!attempts.length) return null;
    const avg = attempts.reduce((s, a) => s + LEVEL_SCORE[a.level], 0) / attempts.length;
    return Math.round(avg * 100);
  }

  function getInsights() {
    const insights = [];
    const allAttempts = getAllAttempts();

    // 1. Difficulty sensitivity — a direct read on the spec's own example
    // ("performs well on straightforward questions, drops on harder ones").
    const lowAttempts = allAttempts.filter(a => LOW_DIFFICULTIES.includes(a.difficulty));
    const highAttempts = allAttempts.filter(a => HIGH_DIFFICULTIES.includes(a.difficulty));
    if (lowAttempts.length >= MIN_DIFFICULTY_SAMPLE && highAttempts.length >= MIN_DIFFICULTY_SAMPLE) {
      const lowPct = pctFrom(lowAttempts), highPct = pctFrom(highAttempts);
      const gap = lowPct - highPct;
      if (gap >= MIN_DIFFICULTY_GAP) {
        insights.push({ kind: 'watch', text: `You're accurate on Easy/Medium questions (${lowPct}%), but that drops to ${highPct}% on Hard/Exam-level ones — worth deliberately practicing at higher difficulty rather than avoiding it.` });
      } else if (-gap >= MIN_DIFFICULTY_GAP) {
        insights.push({ kind: 'positive', text: `You're actually doing better on Hard/Exam-level questions (${highPct}%) than on Easy/Medium ones (${lowPct}%) — possibly rushing through the easier ones.` });
      }
    }

    // 2. Most-improved topic with a real before/after number.
    const allTopics = [];
    getAllSubjects().forEach(subject => {
      getTopics(subject).forEach(t => { if (t.attempts > 0) allTopics.push({ subject, ...t }); });
    });
    const improving = allTopics.filter(t => t.trend === 'improving' && t.oldAccuracyPct !== null)
      .sort((a, b) => (b.newAccuracyPct - b.oldAccuracyPct) - (a.newAccuracyPct - a.oldAccuracyPct))[0];
    if (improving) {
      insights.push({ kind: 'positive', text: `Your accuracy in ${improving.topic} (${improving.subject}) has climbed from ${improving.oldAccuracyPct}% to ${improving.newAccuracyPct}% over your last ${improving.attempts} attempts.` });
    }

    // 3. Most-declined topic — flagged gently, not alarmingly.
    const declining = allTopics.filter(t => t.trend === 'declining' && t.oldAccuracyPct !== null)
      .sort((a, b) => (a.newAccuracyPct - a.oldAccuracyPct) - (b.newAccuracyPct - b.oldAccuracyPct))[0];
    if (declining) {
      insights.push({ kind: 'watch', text: `${declining.topic} (${declining.subject}) has slipped from ${declining.oldAccuracyPct}% to ${declining.newAccuracyPct}% recently — might be worth a revisit.` });
    }

    // 4. Most common recorded mistake pattern (only from attempts that had one tagged).
    const mistakeCounts = {};
    allAttempts.forEach(a => { if (a.mistakeType) mistakeCounts[a.mistakeType] = (mistakeCounts[a.mistakeType] || 0) + 1; });
    const topMistake = Object.keys(mistakeCounts).sort((a, b) => mistakeCounts[b] - mistakeCounts[a])[0];
    if (topMistake && mistakeCounts[topMistake] >= 2) {
      insights.push({ kind: 'watch', text: `Your most frequently recorded mistake type is "${topMistake}" — it's shown up ${mistakeCounts[topMistake]} times.` });
    }

    // 5. Strongest vs weakest subject (only meaningful with 2+ subjects with real data).
    const subjectSummaries = getAllSubjects().map(s => ({ subject: s, ...getSubjectSummary(s) })).filter(s => s.attempts > 0);
    if (subjectSummaries.length >= 2) {
      const sorted = [...subjectSummaries].sort((a, b) => b.accuracyPct - a.accuracyPct);
      const best = sorted[0], worst = sorted[sorted.length - 1];
      if (best.accuracyPct - worst.accuracyPct >= 10) {
        insights.push({ kind: 'neutral', text: `You're strongest in ${best.subject} (${best.accuracyPct}%) with the most room to grow in ${worst.subject} (${worst.accuracyPct}%).` });
      }
    }

    return insights;
  }

  // ── ACADEMIC READINESS SCORE ──────────────────────────────────────────
  // Deliberately transparent, not scientifically validated — per the spec
  // this was built against: "the score should NOT pretend to be
  // scientifically perfect... make it a transparent estimate." Every
  // factor and weight below is a stated judgment call, and getReadiness()
  // returns null (not a fabricated number) when there's not enough data,
  // which callers must render as "not enough data yet," never a guess.
  //
  // Three factors, weighted:
  //   50% recent accuracy across topics actually practiced
  //   30% curriculum coverage (breadth — have you touched most of the
  //       subject, or gone deep on one topic and ignored the rest?)
  //   20% consistency (are practiced topics holding steady/improving, or
  //       is more than half of them declining?)
  // curriculumTopicCount is optional — pass the subject's total known
  // topic count from the curriculum model if available; if omitted,
  // coverage is treated as 100% (not penalized) rather than guessed.
  const READINESS_WEIGHTS = { accuracy: 0.5, coverage: 0.3, consistency: 0.2 };

  function getReadiness(subject, curriculumTopicCount) {
    const topics = getTopics(subject).filter(t => t.attempts > 0);
    if (!topics.length) return null;

    const avgAccuracy = topics.reduce((s, t) => s + t.accuracyPct, 0) / topics.length;

    const coveragePct = curriculumTopicCount
      ? Math.min(100, Math.round((topics.length / curriculumTopicCount) * 100))
      : 100;

    const nonDecliningCount = topics.filter(t => t.trend !== 'declining').length;
    const consistencyPct = Math.round((nonDecliningCount / topics.length) * 100);

    const readinessPct = Math.round(
      avgAccuracy * READINESS_WEIGHTS.accuracy +
      coveragePct * READINESS_WEIGHTS.coverage +
      consistencyPct * READINESS_WEIGHTS.consistency
    );

    return {
      readinessPct,
      factors: { avgAccuracy: Math.round(avgAccuracy), coveragePct, consistencyPct },
      topicsWithData: topics.length,
      curriculumTopicCount: curriculumTopicCount || null
    };
  }

  // A plain-language "why this number" explanation built entirely from the
  // factors above — no AI call, and no claim stronger than the data
  // supports (never "you will score X", always "based on Y so far").
  function explainReadiness(subject, curriculumTopicCount) {
    const r = getReadiness(subject, curriculumTopicCount);
    if (!r) return `Not enough practice data in ${subject} yet for a reliable estimate.`;
    const { avgAccuracy, coveragePct, consistencyPct } = r.factors;
    const coverageNote = r.curriculumTopicCount
      ? `covering ${coveragePct}% of ${subject}'s topics`
      : `across ${r.topicsWithData} topic${r.topicsWithData === 1 ? '' : 's'}`;
    return `Your ${subject} readiness is an estimated ${r.readinessPct}% — based on ${avgAccuracy}% average accuracy ${coverageNote}, with ${consistencyPct}% of those topics stable or improving rather than declining.`;
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    recordAttempt,
    tagMistake,
    getTopics,
    getSubjectSummary,
    getAllSubjects,
    getWeakestTopics,
    getAllAttempts,
    getInsights,
    getReadiness,
    explainReadiness,
    hasAnyData,
    reset
  };
})();
