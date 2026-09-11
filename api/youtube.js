/**
 * StudyMate AI — secure backend proxy for YouTube video search
 * ─────────────────────────────────────────────────────────────────────────
 * Frontend (index.html)  →  THIS FUNCTION (server-side, has the key)  →  YouTube Data API v3
 *
 * Mirrors api/ask.js's security pattern: the key never reaches the browser,
 * requests are validated and rate-limited, and errors are generic rather
 * than forwarding upstream detail.
 *
 * Set YOUTUBE_API_KEY in Vercel's Environment Variables (same place as
 * ANTHROPIC_API_KEY) — never commit it to the repo, never put it in any
 * frontend file.
 *
 * SHARED CACHE (Supabase): before ever calling YouTube, this checks a
 * shared `youtube_cache` table (run supabase-schema-03-youtube-cache.sql
 * once to create it) keyed by the normalized search query. A hit within
 * CACHE_TTL_MS is served with zero YouTube-quota cost — so once any
 * student has searched "photosynthesis", every student after them for the
 * next CACHE_TTL_MS gets it for free. This is what makes the shared key's
 * quota survive real traffic, since most searches converge on a fairly
 * small set of common topics.
 *
 * QUOTA NOTE: this key is shared across every student using the app,
 * unlike the old "bring your own key" flow (still supported as a fallback
 * in index.html — see fetchRelatedVideos()). YouTube Data API's free tier
 * is 10,000 units/day, and a search.list call costs 100 units — so
 * *uncached* searches are capped at ~100/day total. The cache above is
 * what keeps actual usage well under that in practice; if you still hit
 * the ceiling, the next lever is requesting a quota increase from Google.
 *
 * The Supabase URL/anon key below are the same public, safe-for-frontend
 * values already in supabase-client.js — reused here directly rather than
 * as an env var, since they're designed to be public (RLS is what protects
 * data, not key secrecy) and this table's RLS is deliberately open (see
 * the SQL file — it holds no personal data, just cached public results).
 *
 * Request:  GET /api/youtube?q=<search text>
 * Response: 200 { items: [ { videoId, title, channelTitle, thumbnail } ] }
 *           4xx/5xx { error: 'human-readable, non-leaky message' }
 */

const SUPABASE_URL = 'https://xlbnvmkcooueucuayrvy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QHKfnwzCQUW23sNWL2YUPg_H2-oxJ3g';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — video results don't go stale fast

const MAX_QUERY_CHARS = 200;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20; // per IP per window — generous for normal browsing

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

function normalizeQuery(q) {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function readFromCache(cacheKey) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/youtube_cache?query=eq.${encodeURIComponent(cacheKey)}&select=results,cached_at`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    const row = rows[0];
    const age = Date.now() - new Date(row.cached_at).getTime();
    if (age > CACHE_TTL_MS) return null; // stale — treat as a miss, refresh below
    return row.results;
  } catch (err) {
    console.error('YouTube cache read failed (continuing without cache):', err && err.message);
    return null; // cache being unavailable should never break the actual search
  }
}

async function writeToCache(cacheKey, items) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates' // upsert on the query primary key
      },
      body: JSON.stringify({ query: cacheKey, results: items, cached_at: new Date().toISOString() })
    });
  } catch (err) {
    // A failed cache write just means the next request re-fetches from
    // YouTube — never let it fail the response that's already succeeded.
    console.error('YouTube cache write failed (non-fatal):', err && err.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
    return;
  }

  const rawQuery = (req.query && req.query.q ? String(req.query.q) : '').trim();
  if (!rawQuery) {
    res.status(400).json({ error: 'Missing search query.' });
    return;
  }
  if (rawQuery.length > MAX_QUERY_CHARS) {
    res.status(400).json({ error: 'Search query is too long.' });
    return;
  }

  const cacheKey = normalizeQuery(rawQuery);

  // 1. Try the shared cache first — zero YouTube quota cost on a hit.
  const cached = await readFromCache(cacheKey);
  if (cached) {
    res.status(200).json({ items: cached, fromCache: true });
    return;
  }

  // 2. Cache miss — this is the only path that actually spends quota.
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    // Not fatal client-side — index.html falls back to a plain "search on
    // YouTube" link when this endpoint isn't configured or fails.
    res.status(503).json({ error: 'Video search is not configured on the server yet.' });
    return;
  }

  try {
    const upstreamUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=3&type=video&videoEmbeddable=true&safeSearch=strict&order=relevance&q=${encodeURIComponent(rawQuery)}&key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(upstreamUrl);

    if (!upstream.ok) {
      // Don't forward upstream error bodies verbatim — they can reveal the
      // key's project/quota details.
      console.error('YouTube API error', upstream.status);
      res.status(502).json({ error: 'Video search is temporarily unavailable.' });
      return;
    }

    const data = await upstream.json();
    const items = (data.items || [])
      .filter(item => item.id && item.id.videoId && item.snippet)
      .map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails && item.snippet.thumbnails.medium ? item.snippet.thumbnails.medium.url : null
      }));

    res.status(200).json({ items, fromCache: false });

    // 3. Populate the cache for next time — fired after responding so it
    // never adds latency to this request.
    if (items.length) writeToCache(cacheKey, items);

  } catch (err) {
    console.error('YouTube proxy error', err && err.message);
    res.status(502).json({ error: 'Video search is temporarily unavailable.' });
  }
};

