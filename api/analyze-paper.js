/**
 * StudyMate AI — Past-Paper Intelligence: extract topic frequency from
 * uploaded exam papers
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SAFER THAN IT LOOKS: this needs to read text out of PDFs and
 * scanned images, which usually means a client-side or server-side PDF
 * parsing library whose reliability is hard to verify without live
 * testing. Instead, this sends the file straight to Claude as a native
 * "document" content block — Claude reads PDFs and images directly, no
 * separate extraction step at all. Same trusted pattern Ask AI's photo
 * upload already uses for images, just extended to PDFs too.
 *
 * DELIBERATE SPLIT (per the spec's own cost-control instruction): this
 * endpoint's ONLY job is extracting what topics actually appear in the
 * uploaded papers and how often — that's genuinely something only the AI
 * can do. The HIGH/MEDIUM/LOW priority classification (frequency crossed
 * with the student's own weak topics) happens entirely client-side,
 * deterministically, at zero extra AI cost — see index.html's
 * buildPastPaperPriorityMap().
 *
 * COST: this is one of the most expensive calls in the app (large
 * documents, bigger max_tokens). It's gated Premium-only in the frontend,
 * AND still capped even for Premium users (see PAST_PAPER_WEEKLY_LIMIT in
 * index.html) — deliberately not "unlimited on Premium" like everything
 * else, because this specific feature's cost profile is meaningfully
 * higher per use.
 *
 * PRIVACY: the uploaded file itself is never stored anywhere — it's sent
 * to Claude for this one request and discarded. Only the AI's structured
 * output (topic names and counts) gets saved, in past_paper_analyses.
 *
 * AUTH: this endpoint always calls Claude (there's no Free-tier version of
 * Past-Paper Intelligence — see index.html's ⚡ PREMIUM gate on this
 * feature), so it independently re-checks that the caller is both signed
 * in AND Premium server-side before ever touching the Anthropic API. This
 * used to have no such check at all — the frontend's gate was the only
 * thing stopping a Free user (or a script that found the URL) from
 * spending paid Claude credits here directly.
 */

const { getAuthedUser, isPremium } = require('./_lib/plan');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 2048;
const MAX_DOCS = 3;
const MAX_DOC_BASE64_CHARS = 20_000_000; // ~15MB decoded per file — real exam papers can be multi-page
const ALLOWED_DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5; // this is an expensive call — a tight per-IP window on top of the app-level weekly cap

const hits = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (hits.get(key) || []).filter(t => t > windowStart);
  timestamps.push(now);
  hits.set(key, timestamps);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some(t => t > windowStart)) hits.delete(k);
    }
  }
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function validateRequest(body) {
  if (!body || typeof body.subject !== 'string' || !body.subject.trim()) return 'Missing subject.';
  if (body.subject.length > 100) return 'Subject name too long.';
  if (!Array.isArray(body.documents) || body.documents.length === 0) return 'No documents provided.';
  if (body.documents.length > MAX_DOCS) return `Upload at most ${MAX_DOCS} documents at once.`;
  for (const doc of body.documents) {
    if (!doc || typeof doc !== 'object') return 'Malformed document.';
    if (!ALLOWED_DOC_TYPES.has(doc.media_type)) return 'Unsupported file type — use PDF, JPEG, PNG, or WebP.';
    if (typeof doc.data !== 'string' || !doc.data.length) return 'Malformed document data.';
    if (doc.data.length > MAX_DOC_BASE64_CHARS) return 'One of your files is too large.';
  }
  return null;
}

function buildPrompt(subject, paperCount) {
  return `You are analyzing ${paperCount} past exam paper${paperCount === 1 ? '' : 's'} for a student studying ${subject}. Look at the actual questions in the document(s) provided.

Identify:
1. Which specific topics/concepts actually appear in these papers, and how many times each one comes up across all the documents provided.
2. Any recurring question structures or wording patterns worth noting (1-3 sentences, optional).

Stay strictly to what is OBSERVED in the documents — do not invent topics that aren't actually present, and never claim any topic "will" appear on a future exam. This is a description of what's in the papers provided, nothing more.

Respond ONLY in this exact JSON format (no markdown, no backticks, no extra text):
{
  "topicFrequency": [ {"topic": "specific topic name", "count": 3} ],
  "notes": "1-3 sentences on recurring patterns, or empty string if none stand out"
}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  // ── AUTHENTICATION + AUTHORIZATION ──
  // Same trust model as api/ask.js: identity from a verified Supabase
  // token, Premium status from a live, RLS-scoped read of `subscriptions`
  // — never from anything the client claims about itself.
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
  const premium = await isPremium(accessToken, user.id);
  if (!premium) {
    res.status(403).json({ error: 'Past-Paper Intelligence is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(503).json({ error: 'AI service is not configured on the server yet.' }); return; }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
    return;
  }

  const validationError = validateRequest(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const { subject, documents } = req.body;

  const content = [
    { type: 'text', text: buildPrompt(subject.trim(), documents.length) },
    ...documents.map(doc => ({
      type: doc.media_type === 'application/pdf' ? 'document' : 'image',
      source: { type: 'base64', media_type: doc.media_type, data: doc.data }
    }))
  ];

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
      console.error('Anthropic API error (analyze-paper)', upstream.status);
      res.status(502).json({ error: 'Paper analysis is temporarily unavailable.' });
      return;
    }

    const data = await upstream.json();
    res.status(200).json({ content: data.content });

  } catch (err) {
    console.error('analyze-paper proxy error', err && err.message);
    res.status(502).json({ error: 'Paper analysis is temporarily unavailable.' });
  }
};
