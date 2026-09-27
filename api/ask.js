/**
 * StudyMate AI — secure backend proxy for AI requests
 * ─────────────────────────────────────────────────────────────────────────
 * Frontend (index.html) → THIS FUNCTION (server-side) → Gemini or Claude
 *
 * Request contract (must match index.html's callAskApi(), unchanged for
 * the parts that existed before):
 *   POST
 *     Headers: Authorization: Bearer <supabase access token>   (REQUIRED)
 *     Body: {
 *       content: string | Array<{type:'text',text} | {type:'image',source}>,
 *       feature: 'askAI' | 'mockExam' | 'flashcards' | 'teachMe' |
 *                'practice' | 'studyMaterial' | <anything else>
 *     }
 * Response contract:
 *   200 { content: [ { type: 'text', text: '...' } ], usage?: {...} }
 *   4xx/5xx { error: 'human-readable, non-leaky message', code: '...' }
 *
 * ── WHY EVERY REQUEST NOW REQUIRES A REAL SESSION ──
 * This endpoint used to have no authentication at all and always called
 * Claude, for every user, Free or Premium — meaning anyone could spend
 * this app's paid Anthropic credits with a single unauthenticated fetch.
 * That's the core problem this rewrite fixes: identity and plan are now
 * both established server-side, from a verified Supabase access token,
 * never from anything the client claims about itself.
 *
 * ── PROVIDER ROUTING ──
 *   FREE user, feature has a Free allowance left → Gemini (free tier)
 *   FREE user, feature's Free allowance is used up → blocked, no AI call
 *   FREE user, feature is Premium-only (not in FREE_FEATURE_LIMITS)
 *                                                  → blocked, no AI call
 *   PREMIUM user, any feature                     → Claude
 * Free traffic NEVER falls back to Claude (see item 9 of the spec this
 * was built from): a Gemini hiccup should never quietly spend paid
 * credits meant for Premium. Symmetrically, Gemini is never called for
 * Premium users — see api/_lib/gemini.js's header note.
 *
 * ── WHY MOCK EXAM / CBT / ETC. DON'T GET A HARD SERVER-SIDE COUNTER ──
 * askAI is a single request per use, so "3/day" maps cleanly onto "3
 * requests/day" and is enforced atomically via checkAndIncrementUsage().
 * Mock Exam and CBT Mode instead call this endpoint ONCE PER QUESTION in a
 * loop from the client. If the same per-request counter were applied to
 * those, the very first mock exam would lock a Free user out after
 * question 1 (count would hit the weekly max of 1 on the very first
 * network call). So for every feature other than askAI, this endpoint
 * only decides Gemini-vs-Claude routing; their existing weekly caps stay
 * enforced client-side (index.html's USAGE_LIMITS), same as before this
 * change. Free users still can't spend Claude credits either way — the
 * cost-control goal — this is just where the "3/day" rigor specifically
 * applies vs. where it doesn't, and it's called out here on purpose.
 *
 * SECURITY NOTES
 * - Never log req.body in production — it may contain a student's photo.
 * - APP_SHARED_SECRET is optional, lightweight abuse-deterrence (a header
 *   the client sends), not a substitute for the auth check below.
 * - Rate limiting below is in-memory, so it only holds within a single
 *   warm serverless instance and resets on cold start / across regions.
 *   Fine as a first line of defense, not sufficient alone at real scale —
 *   swap in a shared store (Upstash Redis, Vercel KV, etc.) before you
 *   have meaningful traffic.
 */

const { getAuthedUser, isPremium, checkAndIncrementUsage } = require('./_lib/plan');
const { askGemini } = require('./_lib/gemini');

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 4096; // raised to support batch question generation (CBT Mode requests ~15 MCQs per call); safe to raise since Anthropic bills by tokens actually generated, not this ceiling
const MAX_TEXT_CHARS = 6000;          // combined text across all blocks
const MAX_IMAGE_BASE64_CHARS = 8_000_000; // ~6MB decoded, generous for a phone photo
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12; // per IP per window — a real student won't hit this

// Free-tier limits enforced server-side. MUST mirror USAGE_LIMITS in
// index.html — if you change a number here, change it there too, or the
// UI's "X left" badges will drift from what the server actually allows.
// Only 'askAI' is atomically enforced per-request here; see the header
// note above for why the others are routing-only.
const FREE_FEATURE_LIMITS = {
  askAI: { period: 'daily', max: 3 }
};

// Every Free-plan feature that should route to Gemini at all (whether or
// not it also has a hard server-side counter above). Anything NOT in this
// set is treated as Premium-only — e.g. 'cbtMode' (CBT Mode) and
// 'pastPaper' would go here if that endpoint were merged into this one;
// today Past-Paper Intelligence is its own endpoint (api/analyze-paper.js)
// with its own Premium check.
const FREE_ROUTABLE_FEATURES = new Set([
  'askAI', 'mockExam', 'flashcards', 'teachMe', 'practice', 'studyMaterial'
]);

// In-memory rate limiter (see note above on its limits).
const hits = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (hits.get(key) || []).filter(t => t > windowStart);
  timestamps.push(now);
  hits.set(key, timestamps);
  // Opportunistic cleanup so the map doesn't grow unbounded across a warm instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some(t => t > windowStart)) hits.delete(k);
    }
  }
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function validateContent(content) {
  if (typeof content === 'string') {
    if (!content.trim()) return 'Question text is empty.';
    if (content.length > MAX_TEXT_CHARS) return 'Question is too long.';
    return null;
  }
  if (Array.isArray(content)) {
    if (content.length === 0 || content.length > 4) return 'Malformed request.';
    let textChars = 0;
    for (const block of content) {
      if (!block || typeof block !== 'object') return 'Malformed request.';
      if (block.type === 'text') {
        if (typeof block.text !== 'string') return 'Malformed request.';
        textChars += block.text.length;
      } else if (block.type === 'image') {
        const src = block.source;
        if (!src || src.type !== 'base64') return 'Malformed image data.';
        if (!ALLOWED_IMAGE_TYPES.has(src.media_type)) return 'Unsupported image type.';
        if (typeof src.data !== 'string' || src.data.length === 0) return 'Malformed image data.';
        if (src.data.length > MAX_IMAGE_BASE64_CHARS) return 'Image is too large.';
      } else {
        return 'Malformed request.';
      }
    }
    if (textChars > MAX_TEXT_CHARS) return 'Question is too long.';
    return null;
  }
  return 'Malformed request.';
}

// Mirrors index.html's getPeriodKey() exactly — daily uses a UTC
// YYYY-MM-DD key, weekly uses a Monday-start ISO week key. Both sides
// MUST compute the same key for the same moment, or a student could see
// "0/3 remaining" from the server while the client thinks it's a new day
// (or vice versa).
function periodKeyFor(period) {
  const now = new Date();
  if (period === 'daily') return now.toISOString().slice(0, 10);
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

async function callClaude(content) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, error: 'AI service is not configured on the server yet.' };
  }
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content }]
      })
    });

    if (!upstream.ok) {
      // Don't forward upstream error bodies verbatim — they can contain
      // account/billing details we don't want exposed to the client.
      console.error('Anthropic API error', upstream.status);
      return { ok: false, status: 502, error: 'AI service is temporarily unavailable.' };
    }

    const data = await upstream.json();
    return { ok: true, content: data.content };
  } catch (err) {
    console.error('Claude proxy error', err && err.message);
    return { ok: false, status: 502, error: 'AI service is temporarily unavailable.' };
  }
}

module.exports = async function handler(req, res) {
  // CORS: allows a Capacitor-packaged native app (different origin than the
  // deployed web app) to call this endpoint too.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  // Optional lightweight abuse deterrent — enforced only if the deployer
  // opted in by setting APP_SHARED_SECRET. Not a substitute for the real
  // per-student auth check below.
  const requiredSecret = process.env.APP_SHARED_SECRET;
  if (requiredSecret && req.headers['x-app-secret'] !== requiredSecret) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
    return;
  }

  const body = req.body || {};
  const content = body.content;
  const feature = typeof body.feature === 'string' && body.feature ? body.feature : 'askAI';

  const validationError = validateContent(content);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  // ── AUTHENTICATION ──
  // A client-sent "plan"/"premium"/"user_id" field is never trusted for
  // any of what follows — see api/_lib/plan.js's header for the full
  // trust model.
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    res.status(401).json({ error: 'You must be signed in to use StudyMate AI.', code: 'AUTH_REQUIRED' });
    return;
  }
  const user = await getAuthedUser(accessToken);
  if (!user) {
    res.status(401).json({ error: 'Your session has expired — please sign in again.', code: 'AUTH_REQUIRED' });
    return;
  }

  // ── AUTHORIZATION (Free vs Premium) ──
  const premium = await isPremium(accessToken, user.id);

  if (premium) {
    // ── PREMIUM → CLAUDE ──
    const result = await callClaude(content);
    if (!result.ok) {
      res.status(result.status || 502).json({ error: result.error, code: 'PROVIDER_BUSY' });
      return;
    }
    res.status(200).json({ content: result.content });
    return;
  }

  // ── FREE ──
  if (!FREE_ROUTABLE_FEATURES.has(feature)) {
    // Not one of Free's allowed features at all (e.g. CBT Mode) — this is
    // the server-side backstop for the ⚡ PREMIUM gates index.html already
    // shows before ever reaching here.
    res.status(403).json({ error: 'This feature requires Premium.', code: 'PREMIUM_REQUIRED' });
    return;
  }

  const limitConfig = FREE_FEATURE_LIMITS[feature];
  if (limitConfig) {
    let usage;
    try {
      usage = await checkAndIncrementUsage(accessToken, feature, periodKeyFor(limitConfig.period), limitConfig.max);
    } catch (err) {
      console.error('usage check failed', err && err.message);
      res.status(502).json({ error: 'Could not verify your usage right now — please try again.' });
      return;
    }
    if (!usage.allowed) {
      res.status(429).json({
        error: "🎓 You've used your 3 free AI questions for today. Come back tomorrow, or upgrade to Premium for much more AI access and all Premium features.",
        code: 'FREE_LIMIT_REACHED',
        feature,
        count: usage.count,
        max: limitConfig.max
      });
      return;
    }

    // ── FREE → GEMINI ──
    const result = await askGemini(content);
    if (!result.ok) {
      // Never surface raw provider errors (429/RESOURCE_EXHAUSTED/etc.) to
      // the student. No automatic Claude fallback here — see file header.
      res.status(503).json({
        error: '🤖 StudyMate AI is temporarily busy right now. Please try again shortly, or upgrade to Premium for priority AI access and more AI availability.',
        code: 'PROVIDER_BUSY'
      });
      return;
    }
    res.status(200).json({
      content: result.content,
      usage: { feature, count: usage.count, max: limitConfig.max, period: limitConfig.period }
    });
    return;
  }

  // Free-routable feature with no hard server-side counter (Mock Exam,
  // Flashcards, Teach Me, Practice, Study Material) — their weekly caps
  // stay enforced client-side; this endpoint just keeps them on Gemini.
  const result = await askGemini(content);
  if (!result.ok) {
    res.status(503).json({
      error: '🤖 StudyMate AI is temporarily busy right now. Please try again shortly, or upgrade to Premium for priority AI access and more AI availability.',
      code: 'PROVIDER_BUSY'
    });
    return;
  }
  res.status(200).json({ content: result.content });
};
