'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const rawBase = process.env.STUDYMATE_PREVIEW_URL;
if (!rawBase) {
  throw new Error('Set STUDYMATE_PREVIEW_URL to a branch Preview URL before running this smoke test.');
}

const base = new URL(rawBase);
const knownProductionHosts = new Set([
  'studymate-ai-gray-theta.vercel.app',
  'studymate-ai-studymate-ai5.vercel.app',
  'studymate-a9lh73umm-studymate-ai5.vercel.app'
]);

if (base.protocol !== 'https:' || !base.hostname.endsWith('.vercel.app') || knownProductionHosts.has(base.hostname)) {
  throw new Error('This check requires an HTTPS Vercel Preview deployment URL, not a known Production URL.');
}
base.pathname = '/';
base.search = '';
base.hash = '';

async function get(path) {
  const response = await fetch(new URL(path, base), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, path + ' should return HTTP 200');
  return response;
}

describe('Preview HTTP smoke', () => {
  it('serves the StudyMate HTML shell with mobile viewport metadata', async () => {
    const response = await get('/');
    assert.match(response.headers.get('content-type') || '', /text\/html/i);
    const html = await response.text();
    assert.match(html, /<title>StudyMate AI<\/title>/);
    assert.match(html, /<meta name="viewport"/);
  });

  it('serves a valid install manifest and its referenced icons', async () => {
    const response = await get('/manifest.webmanifest');
    const manifest = await response.json();
    assert.equal(typeof manifest.name, 'string');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
    for (const icon of manifest.icons) {
      assert.equal(typeof icon.src, 'string');
      await get('/' + icon.src.replace(/^\//, ''));
    }
  });

  it('serves the service worker with the no-cache response header', async () => {
    const response = await get('/service-worker.js');
    assert.match(response.headers.get('cache-control') || '', /no-cache/i);
    assert.match(await response.text(), /addEventListener/);
  });
});
