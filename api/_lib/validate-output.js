/**
 * StudyMate AI — "did the provider return something usable?" per feature.
 * ─────────────────────────────────────────────────────────────────────────
 * A Free student's allowance is only COMMITTED when the answer is usable.
 * If the provider replies with junk (not the JSON shape the app needs), the
 * reservation is released exactly as for a provider outage — the student
 * keeps the allowance and is shown the truthful "temporarily unavailable"
 * message, never a made-up answer. These checks deliberately mirror the
 * client parsers in index.html (parsePracticeQuestion, parseLesson,
 * parseFlashcards) — keep them in step. (Practice/Mock Exam literally share
 * one parser: math-text.js.)
 */
const MathText = require('../../math-text.js');

function textOf(blocks) {
  return (blocks || []).map(b => (b && b.text) || '').join('');
}
// Same reader the browser uses: tolerates code fences/chatter and repairs LaTeX backslashes that would
// otherwise make valid content fail JSON.parse (and cost the student nothing but a pointless failure).
const parseJson = text => MathText.parseJson(text);
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;

const CHECKS = {
  askAI(text) {
    const p = parseJson(text);
    return !!p && typeof p === 'object' && nonEmpty(p.answer);
  },
  // Practice and Mock Exam share the client's parser (math-text.js): valid JSON AND a well-formed question
  // (options present and distinct, correctIndex in range) AND no corrupted/unconvertible maths. A reply that
  // fails is treated like a provider failure: the slot is released and the student is not charged.
  practice(text) {
    return MathText.parseQuestion(text).ok;
  },
  flashcards(text) {
    const p = parseJson(text);
    return Array.isArray(p) && p.some(c => c && nonEmpty(c.front) && nonEmpty(c.back));
  },
  // Mirrors the client's parseLesson(). guidedQuestion / independentQuestion are OBJECTS in the format the app
  // asks for (see buildTeachMePrompt); this check used to require strings, which rejected every correctly formed
  // lesson and released the slot — Free Teach Me could never succeed.
  teachMe(text) {
    const p = parseJson(text);
    const isQ = q => !!q && typeof q === 'object' && nonEmpty(q.question) && Array.isArray(q.options) && q.options.length >= 2;
    return !!p && nonEmpty(p.concept) && nonEmpty(p.explanation) && Array.isArray(p.examples) &&
      isQ(p.guidedQuestion) && isQ(p.independentQuestion) && Array.isArray(p.miniTest) && p.miniTest.length > 0;
  },
  studyMaterial(text) { return nonEmpty(text); }
};
CHECKS.mockExam = CHECKS.practice;

function isUsableOutput(feature, blocks) {
  const check = CHECKS[feature];
  const text = textOf(blocks);
  return check ? check(text) : nonEmpty(text);
}

module.exports = { isUsableOutput };
