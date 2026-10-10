/**
 * StudyMate AI — "did the provider return something usable?" per feature.
 * ─────────────────────────────────────────────────────────────────────────
 * A Free student's allowance is only COMMITTED when the answer is usable.
 * If the provider replies with junk (not the JSON shape the app needs), the
 * reservation is released exactly as for a provider outage — the student
 * keeps the allowance and is shown the truthful "temporarily unavailable"
 * message, never a made-up answer. These checks deliberately mirror the
 * client parsers in index.html (parsePracticeQuestion, parseLesson,
 * parseFlashcards) — keep them in step.
 */
function textOf(blocks) {
  return (blocks || []).map(b => (b && b.text) || '').join('');
}
function parseJson(text) {
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); } catch (_) { return null; }
}
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;

const CHECKS = {
  askAI(text) {
    const p = parseJson(text);
    return !!p && typeof p === 'object' && nonEmpty(p.answer);
  },
  practice(text) {
    const p = parseJson(text);
    return !!p && nonEmpty(p.question) && Array.isArray(p.options) && p.options.length >= 2 && typeof p.correctIndex === 'number';
  },
  flashcards(text) {
    const p = parseJson(text);
    return Array.isArray(p) && p.some(c => c && nonEmpty(c.front) && nonEmpty(c.back));
  },
  teachMe(text) {
    const p = parseJson(text);
    return !!p && nonEmpty(p.concept) && nonEmpty(p.explanation) && Array.isArray(p.examples) &&
      nonEmpty(p.guidedQuestion) && nonEmpty(p.independentQuestion) && Array.isArray(p.miniTest) && p.miniTest.length > 0;
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
