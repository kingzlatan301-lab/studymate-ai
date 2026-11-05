/**
 * StudyMate AI — shared rate limiter (Upstash Redis / Vercel KV over REST)
 * ─────────────────────────────────────────────────────────────────────────
 * WHY: the old per-file limiters were `Map`s inside one serverless instance,
 * so every cold start and every parallel Vercel instance had its own empty
 * counter. This module keeps ONE fixed-window counter per (scope, id) in a
 * shared Redis, so the limit holds across instances and regions.
 *
 * CONFIG (either pair works; Vercel's Upstash/KV integration sets the KV_* pair):
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL        + KV_REST_API_TOKEN
 * No dependency is added: it is two `fetch` calls to the REST API.
 *
 * BEHAVIOUR
 *   - Store configured and healthy → shared, authoritative counter.
 *   - Store NOT configured         → in-memory fallback (same as before:
 *                                    best-effort, per instance). A one-time
 *                                    warning is logged in production.
 *   - Store configured but failing → in-memory fallback for that call, and
 *                                    the failure is logged. A Redis outage
 *                                    must never take sign-in-gated study
 *                                    features or payments offline.
 * The rate limiter is abuse protection. It is NOT the quota system: Free
 * limits and payment integrity stay in Postgres (reserve/commit/release,
 * payment intents) and are unchanged.
 *
 * The user's id / IP are hashed before they become Redis keys, so no raw
 * email, id or IP is stored in the rate-limit store.
 */
const crypto = require('crypto');

const STORE_TIMEOUT_MS = 800;
const memory = new Map();          // key -> number[] (timestamps)
let warnedNoStore = false;

function storeConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

// On Vercel, VERCEL_ENV is authoritative ('production' | 'preview' | 'development'); NODE_ENV is
// 'production' on Preview deployments too, so it is only consulted when VERCEL_ENV is absent.
function isProduction() {
  return process.env.VERCEL_ENV ? process.env.VERCEL_ENV === 'production' : process.env.NODE_ENV === 'production';
}

function hashId(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 24);
}

function memoryHit(key, windowMs, now) {
  const start = now - windowMs;
  const ts = (memory.get(key) || []).filter(t => t > start);
  ts.push(now);
  memory.set(key, ts);
  if (memory.size > 5000) {
    for (const [k, v] of memory) if (!v.some(t => t > start)) memory.delete(k);
  }
  return ts.length;
}

async function redisHit(cfg, key, windowSec) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);
  try {
    // multi-exec = one atomic transaction: INCR then (re)arm the expiry.
    const res = await fetch(`${cfg.url}/multi-exec`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, windowSec + 5]]),
      signal: controller.signal
    });
    if (!res.ok) throw new Error('store status ' + res.status);
    const out = await res.json();
    const n = Array.isArray(out) && out[0] && Number(out[0].result);
    if (!Number.isFinite(n)) throw new Error('store returned no count');
    return n;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{scope:string, id:string, limit:number, windowSec?:number}} o
 * @returns {Promise<{limited:boolean, count:number, backend:'redis'|'memory'}>}
 *   `limited` is true once the (limit+1)th hit lands in the window.
 */
async function rateLimit({ scope, id, limit, windowSec = 60 }) {
  const now = Date.now();
  const bucket = Math.floor(now / (windowSec * 1000));
  const key = `rl:${scope}:${hashId(id)}:${bucket}`;
  const cfg = storeConfig();
  if (cfg) {
    try {
      const count = await redisHit(cfg, key, windowSec);
      return { limited: count > limit, count, backend: 'redis' };
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'ratelimit_store_failed', scope, msg: err && err.name === 'AbortError' ? 'timeout' : (err && err.message) }));
    }
  } else if (!warnedNoStore && isProduction()) {
    warnedNoStore = true;
    console.error(JSON.stringify({ level: 'warn', event: 'ratelimit_no_shared_store', msg: 'Rate limiting is per-instance only. Set UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN).' }));
  }
  const count = memoryHit(key, windowSec * 1000, now);
  return { limited: count > limit, count, backend: 'memory' };
}

function clientIp(req) {
  return String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
}

/** Test helper: forget in-memory counters and the one-time warning. */
function _resetForTests() { memory.clear(); warnedNoStore = false; }

module.exports = { rateLimit, clientIp, _resetForTests };
