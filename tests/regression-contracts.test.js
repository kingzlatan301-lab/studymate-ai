'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

describe('bagley-context', () => {
  const { sanitize, buildContextBlock, MAX_RAW_JSON_CHARS } = require('../api/_lib/bagley-context');

  it('sanitizes and bounds Free and Premium context depth', () => {
    const raw = {
      student: { name: 'Ari' },
      performance: {
        weakTopics: Array.from({ length: 8 }, (_, i) => ({
          topic: 'Topic ' + i, mastery: 'Developing', accuracyPct: 120, trend: 'unknown'
        }))
      },
      current: { subject: 'Math', topic: 'Fractions' }
    };
    const free = sanitize(raw, false);
    const premium = sanitize(raw, true);
    assert.equal(free.student.name, 'Ari');
    assert.equal(free.performance.weakTopics.length, 3);
    assert.equal(premium.performance.weakTopics.length, 5);
    assert.equal(free.performance.weakTopics[0].accuracyPct, 100);
    assert.equal(free.performance.weakTopics[0].trend, null);
    assert.match(buildContextBlock(raw, false), /STUDENT CONTEXT/);
  });

  it('ignores malformed and oversized context', () => {
    assert.equal(sanitize(null, false), null);
    assert.equal(sanitize([], false), null);
    assert.equal(sanitize({ student: { name: 'x'.repeat(MAX_RAW_JSON_CHARS + 1) } }, false), null);
  });
});

describe('pricing-integrity', () => {
  const pricing = require('../api/_lib/pricing');

  it('uses a locked region before the editable profile country', () => {
    const quote = pricing.resolvePricing('ng', 'gb');
    assert.equal(quote.region, 'ng');
    assert.equal(quote.currency, 'NGN');
    assert.equal(quote.source, 'locked');
  });

  it('uses the default for unknown profile regions and computes server charge terms', () => {
    const quote = pricing.resolvePricing(null, 'not-a-region');
    assert.equal(quote.region, pricing.DEFAULT_REGION);
    const charge = pricing.resolveCharge({ currency: 'USD', amount: 429 }, { NGN_PER_USD: '1330' });
    assert.deepEqual(charge, { currency: 'NGN', amount: 570600, converted: true, rate: 1330 });
  });

  it('does not accept client amount or currency as checkout authority', () => {
    const checkout = read('api/checkout.js');
    assert.match(checkout, /resolvePricing\(/);
    assert.match(checkout, /resolveCharge\(pricing\)/);
    assert.doesNotMatch(checkout, /body\.amount\b/);
    assert.doesNotMatch(checkout, /body\.currency\b/);
  });
});

describe('quota', () => {
  const { FREE_FEATURE_LIMITS, RUN_ID_RE } = require('../api/_lib/limits');
  const { periodKeyFor } = require('../api/_lib/plan');

  it('keeps the documented Free limits in one server-side table', () => {
    assert.deepEqual(FREE_FEATURE_LIMITS.askAI, { period: 'daily', max: 3, maxCalls: 1, label: 'free AI questions' });
    assert.equal(FREE_FEATURE_LIMITS.practice.max, 6);
    assert.equal(FREE_FEATURE_LIMITS.mockExam.max, 1);
    assert.equal(FREE_FEATURE_LIMITS.mockExam.maxCalls, 40);
    assert.equal(FREE_FEATURE_LIMITS.flashcards.max, 1);
    assert.equal(FREE_FEATURE_LIMITS.teachMe.max, 1);
    assert.equal(FREE_FEATURE_LIMITS.studyMaterial.max, 1);
  });

  it('uses UTC day and ISO week boundaries and validates run identifiers', () => {
    assert.equal(periodKeyFor('daily', new Date('2026-11-28T23:59:00.000Z')), '2026-11-28');
    assert.equal(periodKeyFor('weekly', new Date('2026-01-04T23:59:00.000Z')), '2026-W1');
    assert.equal(periodKeyFor('weekly', new Date('2026-01-05T00:01:00.000Z')), '2026-W2');
    assert.equal(RUN_ID_RE.test('mock-run_123'), true);
    assert.equal(RUN_ID_RE.test('short'), false);
  });

  it('keeps API RPC argument types aligned with the server-only SQL function', () => {
    const plan = read('api/_lib/plan.js');
    const schema = read('supabase-schema-14-server-only-usage.sql');
    assert.match(plan, /serviceRpc\('srv_reserve_usage_run'/);
    assert.match(schema, /p_user_id uuid,[\s\S]*p_feature text,[\s\S]*p_period_key text,[\s\S]*p_max integer,[\s\S]*p_run_id text,[\s\S]*p_max_calls integer/);
  });
});

describe('curriculum-security', () => {
  it('returns only published curriculum and protects draft rows with RLS policies', () => {
    const api = read('api/curriculum.js');
    const schema = read('supabase-schema-20-curriculum.sql');
    assert.match(api, /curriculum_syllabi\?status=eq\.published/);
    assert.match(schema, /create policy curriculum_syllabi_read[\s\S]*using \(status = 'published'\)/i);
    assert.match(schema, /create policy curriculum_topics_read[\s\S]*status = 'published'/i);
    assert.match(schema, /create policy curriculum_translations_read[\s\S]*status = 'published'/i);
    assert.match(schema, /revoke all on function public\.publish_syllabus\(uuid\) from public, anon, authenticated/i);
  });
});

describe('audit-regressions', () => {
  it('keeps the server safety module present and attached to the AI handler', () => {
    assert.equal(fs.existsSync(path.join(root, 'api/_lib/safety.js')), true);
    const ask = read('api/ask.js');
    assert.match(ask, /require\(['"]\.\/_lib\/safety['"]\)/);
    assert.match(ask, /systemPromptFor\(\)/);
  });

  it('routes Premium to Claude and Free to Gemini without a Free fallback', () => {
    const ask = read('api/ask.js');
    const premiumStart = ask.indexOf('if (premium) {');
    const freeStart = ask.indexOf('// ── FREE ──', premiumStart);
    assert.ok(premiumStart >= 0 && freeStart > premiumStart);
    const premium = ask.slice(premiumStart, freeStart);
    const free = ask.slice(freeStart);
    assert.match(premium, /callClaude\(/);
    assert.match(free, /askGemini\(/);
    assert.doesNotMatch(free, /callClaude\(/);
    assert.match(free, /releaseUsage\(/);
  });

  it('keeps rate-limit configuration diagnostics secret-free and supports both shared stores', () => {
    const limiter = require('../api/_lib/ratelimit');
    const keys = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    try {
      keys.forEach(k => delete process.env[k]);
      assert.equal(limiter.storeDiagnostics().configured, false);
      process.env.KV_REST_API_URL = 'https://redis.example.test';
      assert.deepEqual(limiter.storeDiagnostics().missing, ['KV_REST_API_TOKEN']);
      process.env.KV_REST_API_TOKEN = 'test-token';
      assert.equal(limiter.storeDiagnostics().source, 'KV');
      assert.equal('token' in limiter.storeDiagnostics(), true);
    } finally {
      keys.forEach(k => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      });
    }
  });

  it('pins Node to the tested Vercel major version', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.engines.node, '24.x');
    assert.equal(pkg.scripts.test, 'node --test');
  });
});
