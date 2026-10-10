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
 * On failure returns { ok: false, reason, status? }. This deliberately
 * never leaks Gemini's own error body (which can include 429/
 * RESOURCE_EXHAUSTED/quota details) up to the caller — api/ask.js turns
 * any `ok:false` into one truthful "StudyMate AI is unavailable" message
 * regardless of the underlying reason, and RELEASES the student's reserved
 * question so a Gemini failure never costs them a question.
 *
 * Reasons: not_configured | model_not_found | auth_error | rate_limited |
 *          upstream_error | timeout | network_error | empty_response | blocked
 * (the reason is only ever logged server-side).
 */
const GEMINI_TIMEOUT_MS = 25_000; // api/ask.js's maxDuration is 30s (vercel.json)

async function askGemini(content) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[gemini] GEMINI_API_KEY is not configured');
    return { ok: false, reason: 'not_configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    // The key goes in a header, not the URL, so it can't end up in request
    // logs or error messages that print the URL.
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: toGeminiParts(content) }] }),
        signal: controller.signal
      }
    );

    if (!upstream.ok) {
      const status = upstream.status;
      let reason = 'upstream_error';
      if (status === 404) reason = 'model_not_found';          // wrong/retired GEMINI_MODEL
      else if (status === 401 || status === 403) reason = 'auth_error'; // bad/blocked key
      else if (status === 429) reason = 'rate_limited';
      // Log status + model only (never the body, never the key).
      console.error('[gemini] API error', status, reason, 'model=' + GEMINI_MODEL);
      return { ok: false, reason, status };
    }

    const data = await upstream.json();
    const cand = data.candidates && data.candidates[0];
    const text = ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('');

    if (!text.trim()) {
      const blocked = !!(data.promptFeedback && data.promptFeedback.blockReason);
      console.error('[gemini] empty response', blocked ? 'blocked' : 'empty', JSON.stringify(data.promptFeedback || {}));
      return { ok: false, reason: blocked ? 'blocked' : 'empty_response' };
    }

    return { ok: true, content: [{ type: 'text', text }] };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('[gemini] proxy error', aborted ? 'timeout' : (err && err.message));
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { askGemini, GEMINI_MODEL };
