/**
 * StudyMate AI — secure backend proxy for AI requests
 * ─────────────────────────────────────────────────────────────────────────
 * Frontend (index.html)  →  THIS FUNCTION (server-side, has the key)  →  Anthropic API
 *
 * The browser never sees ANTHROPIC_API_KEY. This is a Vercel serverless
 * function — deploy this repo to Vercel, set ANTHROPIC_API_KEY (and
 * optionally ANTHROPIC_MODEL / APP_SHARED_SECRET) in the project's
 * Environment Variables, and index.html's existing getAiEndpoint() will
 * find it automatically at "<your-domain>/api/ask".
 *
 * Request contract (must match index.html's askQuestion(), unchanged):
 *   POST { content: string | Array<{type:'text',text} | {type:'image',source}> }
 * Response contract:
 *   200 { content: [ { type: 'text', text: '...' } ] }   (mirrors Anthropic's shape)
 *   4xx/5xx { error: 'human-readable, non-leaky message' }
 *
 * SECURITY NOTES
 * - Never log req.body in production — it may contain a student's photo.
 * - APP_SHARED_SECRET is optional, lightweight abuse-deterrence (a header
 *   the client sends), NOT real user authentication. Real per-student auth
 *   (issue 27 in the master spec) needs an actual auth provider — this
 *   function is ready to check a verified user id once one exists; see the
 *   TODO near the bottom.
 * - Rate limiting below is in-memory, so it only holds within a single warm
 *   serverless instance and resets on cold start / across regions. That's
 *   fine as a first line of defense, not sufficient alone at real scale —
 *   swap in a shared store (Upstash Redis, Vercel KV, etc.) before you have
 *   meaningful traffic.
 */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 4096; // raised to support batch question generation (CBT Mode requests ~15 MCQs per call); safe to raise since Anthropic bills by tokens actually generated, not this ceiling
const MAX_TEXT_CHARS = 6000;          // combined text across all blocks
const MAX_IMAGE_BASE64_CHARS = 8_000_000; // ~6MB decoded, generous for a phone photo
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12; // per IP per window — a real student won't hit this

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

module.exports = async function handler(req, res) {
  // CORS: allows a Capacitor-packaged native app (different origin than the
  // deployed web app) to call this endpoint too.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Server misconfiguration — never say this leaks details, but the app's
    // own fallback (getDemoAnswer) already covers this gracefully client-side.
    res.status(503).json({ error: 'AI service is not configured on the server yet.' });
    return;
  }

  // Optional lightweight abuse deterrent — see file header note. Only
  // enforced if the deployer opted in by setting APP_SHARED_SECRET.
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
  const validationError = validateContent(content);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  // TODO(auth): once real student accounts exist (master spec item 27),
  // verify a signed session/JWT here and use the authenticated student id
  // for rate limiting and for attributing this call to their Weakness
  // Profile server-side, instead of trusting the client-sent subject/topic.

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content }]
      })
    });

    if (!upstream.ok) {
      // Don't forward upstream error bodies verbatim — they can contain
      // account/billing details we don't want exposed to the client.
      console.error('Anthropic API error', upstream.status);
      res.status(502).json({ error: 'AI service is temporarily unavailable.' });
      return;
    }

    const data = await upstream.json();
    res.status(200).json({ content: data.content });

  } catch (err) {
    console.error('AI proxy error', err && err.message);
    res.status(502).json({ error: 'AI service is temporarily unavailable.' });
  }
};
