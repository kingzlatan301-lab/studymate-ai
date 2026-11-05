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
 *       bagleyContext?: object   (OPTIONAL, askAI only — the student's compact
 *                             personalization context; see api/_lib/bagley-context.js.
 *                             Sanitized and size-capped server-side; ignored if
 *                             malformed. Plan depth is decided here from the verified
 *                             session, never from this field.)
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
 * ── EVERY FREE LIMIT IS ENFORCED HERE (api/_lib/limits.js) ──
 * Ask AI 3/day, Practice 6/week, Mock Exam 1/week, Flashcards 1/week,
 * Teach Me 1/week, Study Material 1/week. All go through the same
 * reserve → (commit | release) lifecycle (reserve_usage_run in
 * supabase-schema-09): a slot is reserved BEFORE the provider is called,
 * committed only if the provider answers, released if it fails — so a Gemini
 * hiccup never costs a student an allowance, and the row lock inside the
 * database means two simultaneous requests cannot both take the last slot.
 *
 * Mock Exam calls this endpoint once per QUESTION but is ONE use. The client
 * sends a random `runId` with every call of one exam; the first call reserves
 * (and on success commits) one slot, and later calls with the same runId
 * continue that committed run for free — but only up to `maxCalls` calls
 * (limits.js), and a NEW runId always costs a new slot. A client therefore
 * cannot use runId to exceed the limit. localStorage is display-only.
 *
 * SECURITY NOTES
 * - Never log req.body in production — it may contain a student's photo.
 * - APP_SHARED_SECRET is optional, lightweight abuse-deterrence (a header
 *   the client sends), not a substitute for the auth check below.
 * - Rate limiting uses the shared store in api/_lib/ratelimit.js (Upstash
 *   Redis / Vercel KV). Without UPSTASH_/KV_ env vars it falls back to
 *   per-instance memory (best-effort) and logs a warning in production.
 * - Every provider call carries a server-owned safety/scope system prompt
 *   (api/_lib/safety.js). Client prompts cannot remove it.
 */

const { getAuthedUser, isPremium, periodKeyFor, reserveUsage, reserveUsageRun, commitUsage, releaseUsage } = require('./_lib/plan');
const { FREE_FEATURE_LIMITS, RUN_ID_RE, freeLimitMessage } = require('./_lib/limits');
const { isUsableOutput } = require('./_lib/validate-output');
const { askGemini } = require('./_lib/gemini');
const { buildContextBlock, applyToContent } = require('./_lib/bagley-context');
const { systemPromptFor } = require('./_lib/safety');
const { rateLimit, clientIp } = require('./_lib/ratelimit');
const logger = require('./_lib/log');

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MAX_TOKENS = 4096; // raised to support batch question generation (CBT Mode requests ~15 MCQs per call); safe to raise since Anthropic bills by tokens actually generated, not this ceiling
const MAX_TEXT_CHARS = 6000;          // combined text across all blocks
// Vercel serverless functions reject request bodies over ~4.5 MB BEFORE this code runs, so a larger
// limit here could never be reached. The app shrinks photos on-device (index.html shrinkPhoto) to fit.
const MAX_IMAGE_BASE64_CHARS = 4_200_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const RATE_LIMIT_WINDOW_MS = 60_000;
// The whole request (auth, usage reservation, provider call, retry) must finish inside vercel.json's
// 30s maxDuration for this route. Gemini gets a deadline 27s after the handler starts (3s margin).
const GEMINI_DEADLINE_FROM_START_MS = 27_000;
// Shared-store limits (api/_lib/ratelimit.js). The per-IP ceiling is generous on purpose: a whole
// classroom can sit behind one school/mobile-carrier NAT address. The per-account limit is the
// tighter, fairer one; the real spend limits are the Free quotas and provider spend caps.
const RATE_LIMIT_IP_PER_MIN = 60;
const RATE_LIMIT_USER_PER_MIN = 60;

// Every Free-plan feature (all of them have a hard server-side counter in
// limits.js). Anything NOT in this set is treated as Premium-only — e.g. 'cbtMode' (CBT Mode) and
// 'pastPaper' would go here if that endpoint were merged into this one;
// today Past-Paper Intelligence is its own endpoint (api/analyze-paper.js)
// with its own Premium check.
// Derived from limits.js so a feature can never be Free-routable without a limit.
const FREE_ROUTABLE_FEATURES = new Set(Object.keys(FREE_FEATURE_LIMITS));

// For the Ask AI feature the client requires a specific JSON answer shape
// (see buildPrompt() in index.html). If the provider returns something that
// can't be parsed into it, the student must NOT lose a question and must NOT
// be shown a made-up answer — so it's treated exactly like a provider
// failure: the reserved slot is released and the unavailable message is sent.
function isValidAskAnswer(blocks) {
  return isUsableOutput('askAI', blocks); // one definition (validate-output.js), shared with the Free path
}

// Features whose reply is ONE JSON value (the app JSON.parses it). Free/Gemini is asked for JSON mode on these;
// studyMaterial is free text and is not. Premium replies for the structured ones get the same usability check
// the Free path has, so a malformed Claude reply is a clean retryable error rather than a broken screen.
const JSON_REPLY_FEATURES = new Set(['askAI', 'practice', 'mockExam', 'teachMe', 'flashcards']);
const PREMIUM_CHECKED_FEATURES = new Set(['practice', 'mockExam', 'teachMe', 'flashcards']);

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

async function callClaude(content) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, error: 'AI service is not configured on the server yet.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 27_000); // vercel.json maxDuration for this route is 30s
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
        // Server-owned safety/scope prompt (api/_lib/safety.js); a client-sent `system` is ignored.
        system: systemPromptFor(),
        messages: [{ role: 'user', content }]
      }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      // Don't forward upstream error bodies verbatim — they can contain
      // account/billing details we don't want exposed to the client.
      console.error('Anthropic API error', upstream.status);
      return { ok: false, status: 502, error: 'AI service is temporarily unavailable.' };
    }

    const data = await upstream.json();
    const hasText = Array.isArray(data.content) && data.content.some(c => c && c.type === 'text' && c.text && c.text.trim());
    if (!hasText) {
      console.error('Anthropic API returned no text content');
      return { ok: false, status: 502, error: 'AI service is temporarily unavailable.' };
    }
    return { ok: true, content: data.content };
  } catch (err) {
    console.error('Claude proxy error', err && err.name === 'AbortError' ? 'timeout' : (err && err.message));
    return { ok: false, status: 502, error: 'AI service is temporarily unavailable.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  const handlerStartedAt = Date.now();
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

  const ipLimit = await rateLimit({ scope: 'ask-ip', id: clientIp(req), limit: RATE_LIMIT_IP_PER_MIN });
  if (ipLimit.limited) {
    logger.warn('rate_limited', { endpoint: 'ask', by: 'ip', backend: ipLimit.backend });
    res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
    return;
  }

  const body = req.body || {};
  const content = body.content;
  const feature = typeof body.feature === 'string' && body.feature ? body.feature : 'askAI';

  // Optional Bagley personalization (Ask AI only). Never required, never
  // allowed to fail the request: bad/oversized input simply yields no block.
  const rawBagleyContext = feature === 'askAI' ? body.bagleyContext : undefined;

  // Optional client-generated id grouping the calls of ONE multi-call use
  // (Mock Exam). It is only an idempotency hint — see the header note.
  const runId = typeof body.runId === 'string' ? body.runId : null;
  if (runId !== null && !RUN_ID_RE.test(runId)) {
    res.status(400).json({ error: 'Malformed request.' });
    return;
  }

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

  const userLimit = await rateLimit({ scope: 'ask-user', id: user.id, limit: RATE_LIMIT_USER_PER_MIN });
  if (userLimit.limited) {
    logger.warn('rate_limited', { endpoint: 'ask', by: 'user', backend: userLimit.backend });
    res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
    return;
  }

  // ── AUTHORIZATION (Free vs Premium) ──
  const premium = await isPremium(accessToken, user.id);

  // Same personalized block for both providers (Gemini for Free, Claude for
  // Premium); `premium` only changes how much history it carries.
  const personalizedContent = applyToContent(content, buildContextBlock(rawBagleyContext, premium));

  // Shared by every failure path below. One truthful message — we never
  // fabricate an answer, and we never reveal provider internals.
  const UNAVAILABLE_MSG = '🤖 StudyMate AI is temporarily unavailable. Please try again shortly.';
  const sendUnavailable = () => res.status(503).json({ error: UNAVAILABLE_MSG, code: 'PROVIDER_BUSY' });

  if (premium) {
    // ── PREMIUM → CLAUDE ──
    // Premium has no daily cap, but askAI uses are still recorded (with an
    // effectively unlimited ceiling) so the "Questions asked" statistic is
    // persistent and identical for Free and Premium. Accounting problems
    // must never block a paying student, so failures here only log.
    let reservation = null;
    if (feature === 'askAI') {
      try {
        const r = await reserveUsage(user.id, feature, periodKeyFor('daily'), 2147483647);
        reservation = r.reservationId;
      } catch (err) {
        console.error('premium usage reserve failed (continuing)', err && err.message);
      }
    }

    let result = await callClaude(personalizedContent);
    if (result.ok && feature === 'askAI' && !isValidAskAnswer(result.content)) {
      console.error('Claude returned an unparseable askAI answer');
      result = { ok: false, status: 502 };
    } else if (result.ok && PREMIUM_CHECKED_FEATURES.has(feature) && !isUsableOutput(feature, result.content)) {
      console.error('Claude returned an unusable ' + feature + ' reply'); // no usage is recorded for these on Premium
      result = { ok: false, status: 502 };
    }
    if (!result.ok) {
      logger.error('provider_failed', { provider: 'claude', feature, status: result.status });
      if (reservation) await releaseUsage(user.id, reservation);
      res.status(result.status || 502).json({ error: UNAVAILABLE_MSG, code: 'PROVIDER_BUSY' });
      return;
    }

    logger.info('ai_call', { provider: 'claude', feature, tier: 'premium' });
    let usage;
    if (reservation) {
      try {
        const c = await commitUsage(user.id, reservation);
        usage = { feature, count: c.committed, max: null, period: 'daily', total: c.total };
      } catch (err) {
        logger.error('usage_commit_failed', { tier: 'premium', feature, msg: err && err.message });
      }
    }
    res.status(200).json({ content: result.content, ...(usage ? { usage } : {}) });
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
  if (limitConfig.maxCalls > 1 && !runId) {
    res.status(400).json({ error: 'Malformed request.' });
    return;
  }

  // 1. Atomically RESERVE (database row lock — concurrent requests cannot
  //    both take the last slot). A request that continues an already
  //    committed run (Mock Exam question 2..N) reuses that run's slot.
  let reservation;
  try {
    reservation = await reserveUsageRun(user.id, feature, periodKeyFor(limitConfig.period), limitConfig.max, runId, limitConfig.maxCalls);
  } catch (err) {
    console.error('usage reserve failed', err && err.message);
    res.status(502).json({ error: 'Could not verify your usage right now — please try again.', code: 'USAGE_CHECK_FAILED' });
    return;
  }
  if (!reservation.allowed) {
    if (reservation.reason === 'run_in_flight') {
      res.status(409).json({ error: 'The previous request is still running — please wait a moment.', code: 'RUN_IN_FLIGHT' });
      return;
    }
    res.status(429).json({
      error: freeLimitMessage(feature),
      code: 'FREE_LIMIT_REACHED',
      feature,
      count: reservation.used,
      max: limitConfig.max,
      period: limitConfig.period
    });
    return;
  }

  // 2. FREE → GEMINI (never Claude, never a fake answer).
  const freeContent = feature === 'askAI' ? personalizedContent : content;
  let result = await askGemini(freeContent, {
    deadlineAt: handlerStartedAt + GEMINI_DEADLINE_FROM_START_MS,
    json: JSON_REPLY_FEATURES.has(feature) // the reply is one JSON value → ask Gemini for valid JSON
  });
  if (result.ok && !isUsableOutput(feature, result.content)) {
    console.error('[gemini] returned an unusable answer for', feature);
    result = { ok: false, reason: 'invalid_output' };
  }
  if (!result.ok) {
    logger.error('provider_failed', {
      provider: 'gemini', feature, reason: result.reason,
      status: result.status, upstream_code: result.upstreamCode, attempts: result.attempts, elapsed_ms: result.elapsedMs
    });
    // 3a. Provider failed → RELEASE the slot so the student keeps the
    //     allowance. A request that merely continued a committed run
    //     (reservation.reused) must NOT release: that slot belongs to the
    //     earlier, successful part of the run.
    if (!reservation.reused) await releaseUsage(user.id, reservation.reservationId);
    sendUnavailable();
    return;
  }

  // 3b. Provider answered → COMMIT (idempotent). One retry on a transient DB
  //     error; if it still fails the reservation expires (2 min) rather than
  //     the student losing an answer they already received.
  logger.info('ai_call', { provider: 'gemini', feature, tier: 'free' });
  let committed = null;
  if (!reservation.reused) {
    for (let attempt = 0; attempt < 2 && !committed; attempt++) {
      try {
        committed = await commitUsage(user.id, reservation.reservationId);
      } catch (err) {
        logger.error('usage_commit_failed', { tier: 'free', feature, attempt: attempt + 1, msg: err && err.message });
      }
    }
  }
  res.status(200).json({
    content: result.content,
    usage: {
      feature,
      count: committed ? committed.committed : (reservation.reused ? reservation.committed : reservation.used),
      max: limitConfig.max,
      period: limitConfig.period,
      total: committed ? committed.total : undefined
    }
  });
};
