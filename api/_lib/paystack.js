/**
 * StudyMate AI — Paystack server client (initialize) with SAFE diagnostics.
 *
 * WHY THIS EXISTS: checkout used to log only `init.status` ("Paystack initialize failed 403"), which threw away the one
 * thing needed to fix it — Paystack's own explanation. A 403 from api.paystack.co has several unrelated causes
 * (currency not enabled on the account, an IP restriction, an account/live-mode activation problem, or a Cloudflare
 * block that returns an HTML page instead of JSON). `classify()` turns the response into a stable `kind`, and
 * `describe()` returns ONLY fields that are safe to log.
 *
 * NEVER LOGGED / RETURNED: the secret key (or any part of it beyond its public mode prefix), the customer's email, the
 * access code, the authorization header, the raw response body. Paystack's `message` is a short, non-personal sentence
 * ("Currency not supported by merchant"); it is truncated and stripped of anything key-shaped before logging.
 */

const PAYSTACK_BASE = 'https://api.paystack.co';
const INIT_TIMEOUT_MS = 8000;
const USER_AGENT = 'StudyMateAI-Server/1.0 (+https://vercel.com)';

/** Reads the secret from the environment, trimmed (a pasted trailing newline/space is the classic cause of a 401). */
function readSecret(env) {
  const raw = (env || process.env).PAYSTACK_SECRET_KEY;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** 'live' | 'test' | null — from the public prefix only. Anything else (pk_…, quotes, empty, typo) is null. */
function keyMode(secret) {
  const k = String(secret || '');
  if (k.startsWith('sk_live_')) return 'live';
  if (k.startsWith('sk_test_')) return 'test';
  return null;
}

/** Why a configured value is unusable, as a safe label (never the value itself). null = looks fine. */
function keyProblem(secret) {
  const k = String(secret || '');
  if (!k) return 'missing';
  if (k.startsWith('pk_')) return 'public_key_used_as_secret';
  if (/^["'].*["']$/.test(k)) return 'wrapped_in_quotes';
  if (!keyMode(k)) return 'unrecognised_prefix';
  if (/\s/.test(k)) return 'contains_whitespace';
  return null;
}

function scrub(s) {
  return String(s == null ? '' : s)
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/g, '[key]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Maps a failed Paystack response to a machine-readable kind.
 *   currency_unsupported — the account has not enabled this currency (very likely for USD on a NGN-only account)
 *   invalid_key          — 401 / "Invalid key": wrong, revoked, or a public key
 *   ip_restricted        — an IP allow-list on the dashboard (Vercel's outbound IPs are not fixed)
 *   account_inactive     — business not activated / live mode not enabled
 *   edge_blocked         — non-JSON body (Cloudflare/WAF page), usually with a 403
 *   rate_limited | upstream_error | bad_request | unknown
 */
function classify(status, message, contentType) {
  const m = String(message || '').toLowerCase();
  const html = /text\/html/i.test(contentType || '');
  if (/currenc/.test(m)) return 'currency_unsupported';
  if (status === 401 || /invalid key|invalid api key|unauthori[sz]ed/.test(m)) return 'invalid_key';
  if (/\bip\b.*(not|allow|whitelist|restrict)|whitelist|not allowed to (access|use)/.test(m)) return 'ip_restricted';
  if (/activate|not active|inactive|go live|business.*(verif|activ)|live mode/.test(m)) return 'account_inactive';
  if (html || (status === 403 && !m)) return 'edge_blocked';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  if (status === 400 || status === 422) return 'bad_request';
  return 'unknown';
}

/** Kinds that mean "this server/account configuration cannot take this payment right now" (not the student's fault, retrying is pointless). */
const CONFIG_KINDS = new Set(['currency_unsupported', 'invalid_key', 'ip_restricted', 'account_inactive', 'edge_blocked']);

/**
 * POST /transaction/initialize. Never throws. Resolves to
 *   { ok:true, accessCode }                               on success, or
 *   { ok:false, status, kind, message, contentType, requestId, network? }   on any failure
 * `message` is already scrubbed. The caller decides what the student sees.
 */
async function initializeTransaction(secret, payload, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INIT_TIMEOUT_MS);
  let res;
  try {
    res = await doFetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    return { ok: false, status: 0, kind: 'upstream_error', network: err && err.name === 'AbortError' ? 'timeout' : 'network_error', message: '', contentType: '', requestId: null };
  } finally {
    clearTimeout(timer);
  }
  const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  const requestId = (res.headers && res.headers.get && (res.headers.get('cf-ray') || res.headers.get('x-request-id'))) || null;
  let data = null, text = '';
  try { text = await res.text(); data = JSON.parse(text); } catch (_) { data = null; }
  if (res.ok && data && data.status && data.data && typeof data.data.access_code === 'string' && data.data.access_code) {
    return { ok: true, accessCode: data.data.access_code };
  }
  const message = scrub(data && data.message ? data.message : (data ? '' : (/text\/html/i.test(contentType) ? 'html response (edge block?)' : '')));
  const failStatus = res.ok ? 502 : res.status;                       // 200 without an access code is still a failure
  return { ok: false, status: failStatus, kind: classify(failStatus, message, contentType), message, contentType: contentType.split(';')[0].slice(0, 40), requestId: requestId ? String(requestId).slice(0, 40) : null };
}

/** The log fields for a failed initialize: everything needed to diagnose, nothing personal or secret. */
function describe(failure, ctx) {
  return {
    status: failure.status, kind: failure.kind, paystack_message: failure.message, content_type: failure.contentType,
    request_id: failure.requestId, network: failure.network,
    currency: ctx && ctx.currency, amount_minor: ctx && ctx.amount, region: ctx && ctx.region,
    key_mode: ctx && ctx.keyMode, vercel_env: process.env.VERCEL_ENV || null
  };
}

module.exports = { readSecret, keyMode, keyProblem, classify, initializeTransaction, describe, scrub, CONFIG_KINDS, PAYSTACK_BASE };
