/**
 * StudyMate AI — the ONE place Free-plan limits are defined (server side).
 * ─────────────────────────────────────────────────────────────────────────
 * api/ask.js enforces these; api/usage.js reports them to the app, so the
 * UI's numbers come from here instead of a second hard-coded copy.
 *
 *   period     'daily' | 'weekly'  (UTC windows — see plan.js periodKeyFor)
 *   max        Free uses per period
 *   maxCalls   how many /api/ask calls ONE use may make. Mock Exam makes one
 *              call per question, so it needs a "run" (client-generated id,
 *              required when maxCalls > 1); every other feature is 1 call = 1 use.
 *   label      human wording for the limit message
 *
 * Premium-only features (cbtMode, anything unknown) are simply absent here:
 * a Free user asking for them gets PREMIUM_REQUIRED and no AI call is made.
 * Past-Paper Intelligence is a separate Premium-only endpoint
 * (api/analyze-paper.js) and has no Free allowance.
 */
const FREE_FEATURE_LIMITS = {
  askAI:         { period: 'daily',  max: 3, maxCalls: 1,  label: 'free AI questions' },
  practice:      { period: 'weekly', max: 6, maxCalls: 1,  label: 'free practice questions' },
  mockExam:      { period: 'weekly', max: 1, maxCalls: 40, label: 'free mock exam' },
  flashcards:    { period: 'weekly', max: 1, maxCalls: 1,  label: 'free flashcard set' },
  teachMe:       { period: 'weekly', max: 1, maxCalls: 1,  label: 'free Teach Me lesson' },
  studyMaterial: { period: 'weekly', max: 1, maxCalls: 1,  label: 'free study-material summary' }
};

// Cost-control caps that apply EVEN TO PREMIUM (enforced server-side too).
const PREMIUM_CAPS = {
  pastPaper: { period: 'weekly', max: 5 }
};

const RUN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function freeLimitMessage(feature) {
  const l = FREE_FEATURE_LIMITS[feature];
  if (!l) return 'This feature requires Premium.';
  const per = l.period === 'daily' ? 'today' : 'this week';
  if (feature === 'askAI') {
    return "🎓 You've used your 3 free AI questions for today. Come back tomorrow, or upgrade to Premium for much more AI access and all Premium features.";
  }
  return `🎓 You've used your ${l.max} ${l.label}${l.max > 1 ? 's' : ''} ${per}. Come back next ${l.period === 'daily' ? 'day' : 'week'}, or upgrade to Premium for unlimited access.`;
}

module.exports = { FREE_FEATURE_LIMITS, PREMIUM_CAPS, RUN_ID_RE, freeLimitMessage };
