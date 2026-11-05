/**
 * StudyMate AI — Gemini free-tier proxy (Free plan's AI provider)
 * ─────────────────────────────────────────────────────────────────────────
 * Called ONLY from api/ask.js, and ONLY for authenticated Free users who
 * are still under their daily/weekly allowance. Never called as a
 * fallback for Premium users — see the "no automatic Claude fallback for
 * Free users" note in api/ask.js for why the reverse (silently spending
 * paid Claude credits on a Free user) is the one thing this app must
 * never do, and this file mirrors that same discipline in the other
 * direction: Free traffic never touches Claude, period.
 *
 * MODEL: defaults to a "-latest" alias so this doesn't silently break the
 * next time Google retires a dated model (e.g. the Gemini 2.5 line is
 * scheduled for shutdown in Oct 2026). Verify the current free-tier model
 * lineup at https://ai.google.dev/gemini-api/docs/models before launch
 * and override via GEMINI_MODEL if you want something specific.
 */

const { systemPromptFor } = require('./safety');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

// Converts StudyMate's existing Anthropic-shaped `content` (a string, or
// an array of {type:'text',text} / {type:'image',source:{type:'base64',
// media_type,data}} blocks — see api/ask.js's validateContent) into
// Gemini's `contents[].parts` shape. This is the ONLY place that needs to
// know both shapes, which is what lets index.html and api/ask.js's
// validation stay provider-agnostic.
function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map(block => {
      if (block.type === 'text') return { text: block.text };
      if (block.type === 'image') {
        return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
      }
      return { text: '' };
    });
  }
  return [{ text: String(content || '') }];
}

/**
 * Returns { ok: true, content: [{type:'text', text}] } on success — the
 * same shape api/ask.js already returns for Claude, so index.html's
 * existing response parsing works unchanged no matter which provider
 * actually answered.
 *
 * On failure returns { ok: false, reason, status?, upstreamCode?, attempts,
 * elapsedMs }. This deliberately never leaks Gemini's own error body (which
 * can include 429/RESOURCE_EXHAUSTED/quota details) up to the caller —
 * api/ask.js turns any `ok:false` into one truthful "StudyMate AI is
 * unavailable" message regardless of the underlying reason, and RELEASES
 * the student's reserved question so a Gemini failure never costs them a
 * question.
 *
 * Reasons: not_configured | model_not_found | auth_error | rate_limited |
 *          upstream_error | timeout | network_error | empty_response | blocked |
 *          deadline_exceeded (no time left to start a request; nothing was sent)
 * (the reason is only ever logged server-side).
 *
 * LOGGING: only status, an allowlisted Google error code (UPSTREAM_CODES),
 * model name, attempt number and elapsed time are ever logged. Upstream
 * error messages/bodies, headers, URLs, prompts and exception messages are
 * never logged (an exception message can echo a response-body snippet).
 *
 * RETRY: at most ONE retry, and only for an HTTP 503 (Google's transient
 * "overloaded/unavailable"). Never for 404/other 4xx/429, network errors or
 * timeouts. It happens inside this function, so api/ask.js still performs
 * exactly one reserve and one commit-or-release per logical request.
 */
const GEMINI_TIMEOUT_MS = 25_000;   // max for a single attempt (api/ask.js's maxDuration is 30s, vercel.json)
const GEMINI_DEFAULT_BUDGET_MS = 27_000; // used only if the caller passes no deadline
const RETRY_BACKOFF_MS = 600;       // + up to RETRY_JITTER_MS of random jitter
const RETRY_JITTER_MS = 400;
const MIN_ATTEMPT_MS = 3_000;       // below this much remaining time no upstream attempt is started at all
const MIN_RETRY_WINDOW_MS = 8_000;  // a retry needs at least this much time left AFTER the backoff
const MAX_ATTEMPTS = 2;

// Canonical Google API error codes. Anything else is reported as 'UNRECOGNIZED'.
const UPSTREAM_CODES = new Set([
  'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'OUT_OF_RANGE', 'UNAUTHENTICATED', 'PERMISSION_DENIED',
  'NOT_FOUND', 'ABORTED', 'ALREADY_EXISTS', 'RESOURCE_EXHAUSTED', 'CANCELLED', 'DATA_LOSS', 'UNKNOWN',
  'INTERNAL', 'UNIMPLEMENTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED'
]);
const SAFE_TOKEN_RE = /^[A-Za-z0-9_]{1,40}$/;

// Reads Google's error body defensively and returns ONLY an allowlisted
// code (+ whether quota details are attached). Never returns or logs text.
async function classifyUpstreamError(upstream) {
  try {
    const raw = await upstream.text();
    const err = JSON.parse(String(raw).slice(0, 20000)).error;
    if (!err || typeof err !== 'object') return {};
    const out = {};
    if (typeof err.status === 'string') out.upstreamCode = UPSTREAM_CODES.has(err.status) ? err.status : 'UNRECOGNIZED';
    if (Array.isArray(err.details) && err.details.some(d => d && typeof d['@type'] === 'string' && d['@type'].includes('QuotaFailure'))) out.quotaDetails = true;
    return out;
  } catch (_) {
    return {};
  }
}

const safeToken = v => (typeof v === 'string' && SAFE_TOKEN_RE.test(v) ? v : undefined);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One HTTP attempt. Never throws. `retryable` is true only for a 503.
async function attemptGemini(apiKey, body, timeoutMs, attempt) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tag = () => 'attempt=' + attempt + ' elapsed_ms=' + (Date.now() - t0);

  try {
    // The key goes in a header, not the URL, so it can't end up in request
    // logs or error messages that print the URL.
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: controller.signal
      }
    );

    if (!upstream.ok) {
      const status = upstream.status;
      let reason = 'upstream_error';
      if (status === 404) reason = 'model_not_found';          // wrong/retired GEMINI_MODEL
      else if (status === 401 || status === 403) reason = 'auth_error'; // bad/blocked key
      else if (status === 429) reason = 'rate_limited';
      const info = await classifyUpstreamError(upstream);
      // Log status + allowlisted code + model only (never the body, never the key).
      console.error('[gemini] API error', status, reason, 'model=' + GEMINI_MODEL, tag(),
        'upstream=' + (info.upstreamCode || 'none') + (info.quotaDetails ? ' quota_details=true' : ''));
      return { ok: false, reason, status, ...info, retryable: status === 503 };
    }

    const data = await upstream.json();
    const cand = data.candidates && data.candidates[0];
    const text = ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('');

    if (!text.trim()) {
      const blockReason = safeToken(data.promptFeedback && data.promptFeedback.blockReason);
      const finishReason = safeToken(cand && cand.finishReason);
      console.error('[gemini] empty response', blockReason ? 'blocked' : 'empty', 'model=' + GEMINI_MODEL, tag(),
        'block_reason=' + (blockReason || 'none'), 'finish_reason=' + (finishReason || 'none'));
      return { ok: false, reason: blockReason ? 'blocked' : 'empty_response', retryable: false };
    }

    return { ok: true, content: [{ type: 'text', text }] };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    // Name/code only: an exception MESSAGE can contain a response-body snippet or URL.
    const kind = aborted ? 'timeout' : (safeToken(err && err.cause && err.cause.code) || safeToken(err && err.name) || 'error');
    console.error('[gemini] proxy error', kind, 'model=' + GEMINI_MODEL, tag());
    return { ok: false, reason: aborted ? 'timeout' : 'network_error', retryable: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param content  Anthropic-shaped content (see toGeminiParts)
 * @param opts     { json?: boolean (ask for application/json output — only for features whose reply is one
 *                   JSON object: practice, mockExam), deadlineAt?: epoch ms by which this call must be finished
 *                   (api/ask.js passes handlerStart + 27s so the whole request
 *                   stays under Vercel's 30s limit), timeoutMs?, backoffMs?,
 *                   jitterMs?, minRetryWindowMs? — the last four exist for tests }
 */
async function askGemini(content, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[gemini] GEMINI_API_KEY is not configured');
    return { ok: false, reason: 'not_configured', attempts: 0, elapsedMs: 0 };
  }

  const started = Date.now();
  const deadlineAt = Number.isFinite(opts.deadlineAt) ? opts.deadlineAt : started + GEMINI_DEFAULT_BUDGET_MS;
  const maxAttemptMs = opts.timeoutMs || GEMINI_TIMEOUT_MS;
  const backoffMs = opts.backoffMs != null ? opts.backoffMs : RETRY_BACKOFF_MS;
  const jitterMs = opts.jitterMs != null ? opts.jitterMs : RETRY_JITTER_MS;
  const minWindow = opts.minRetryWindowMs != null ? opts.minRetryWindowMs : MIN_RETRY_WINDOW_MS;

  let body;
  try {
    body = JSON.stringify({
      // Server-owned safety/scope prompt (api/_lib/safety.js) — never client-supplied.
      systemInstruction: { parts: [{ text: systemPromptFor() }] },
      contents: [{ role: 'user', parts: toGeminiParts(content) }],
      // JSON mode (opts.json) makes Gemini emit syntactically valid JSON. It does NOT fix maths formatting by
      // itself (a single-backslash \frac is still a legal JSON escape — a form feed), which is why the prompt and math-text.js exist.
      ...(opts.json ? { generationConfig: { responseMimeType: 'application/json' } } : {})
    });
  } catch (err) {
    // Same outcome as before this was hoisted out of the request: a clean failure, never a throw.
    console.error('[gemini] could not build request', safeToken(err && err.name) || 'error');
    return { ok: false, reason: 'network_error', attempts: 0, elapsedMs: 0 };
  }

  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Never start an attempt that cannot finish before the caller's deadline. If the deadline has
    // passed (or too little time is left for a useful request) make NO upstream call: fail safely
    // so api/ask.js releases the reservation and answers before Vercel kills the function.
    const remaining = deadlineAt - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      console.error('[gemini] deadline reached, upstream attempt not started', 'attempt=' + attempt);
      if (result) { result.attempts = attempt - 1; break; }   // keep the earlier 503 as the failure
      return { ok: false, reason: 'deadline_exceeded', attempts: 0, elapsedMs: Date.now() - started };
    }
    result = await attemptGemini(apiKey, body, Math.min(maxAttemptMs, remaining), attempt);
    if (result.ok) return { ok: true, content: result.content };
    if (!result.retryable || attempt === MAX_ATTEMPTS) { result.attempts = attempt; break; }

    const pause = backoffMs + Math.floor(Math.random() * (jitterMs + 1));
    if (deadlineAt - Date.now() - pause < minWindow) {
      console.error('[gemini] retry skipped: not enough time left', 'attempt=' + attempt);
      result.attempts = attempt;
      break;
    }
    console.error('[gemini] retrying after 503', 'attempt=' + (attempt + 1), 'backoff_ms=' + pause);
    await sleep(pause);
  }

  const { retryable, ...failure } = result;
  return { ...failure, attempts: failure.attempts, elapsedMs: Date.now() - started };
}

module.exports = { askGemini, GEMINI_MODEL };
