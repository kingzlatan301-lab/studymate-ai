# StudyMate AI app

StudyMate AI is a mobile-first exam-prep tutor for students worldwide (WAEC, JAMB, NECO, GCSE/A-Level, SAT/ACT/AP, CBSE, IGCSE, IB and more, chosen by country/exam). It is an installable web app (PWA) and can be packaged as an Android/iOS app with Capacitor.

> **Status:** the code-level audit fixes are in. Live-environment items (Supabase, Vercel, Paystack, Google, Android SDK) cannot be verified from this repository — see [Unresolved external tasks](#unresolved-external-tasks) and the checklists below. Nothing here has been tested against live Paystack, live Supabase or real AI providers.

## Run it locally

```bash
npm install
npm run serve        # http://localhost:5173
npm test             # all automated tests (mocked backends — NOT live integration tests)
```

Sign-in is required: a verified Supabase identity is what lets the Free/Premium split be enforced on the server (`enforceAuthGate()` in `index.html`). There is no guest mode.

## Plans and AI routing (server-enforced)

`api/ask.js` verifies the caller's Supabase session, reads their real subscription, then routes:

- **Free** → Gemini. Limits live in `api/_lib/limits.js`: Ask AI 3/day; Practice 6/week; Mock Exam 1/week (one run of up to 40 calls); Flashcards, Teach Me and Study Material 1/week each. Enforced **server-side** with reserve → commit/release (`supabase-schema-07/09`), so a failed AI call does not cost a slot and concurrent requests cannot exceed the limit. `localStorage` counters are display-only.
- **Premium** → Claude, no per-feature caps. CBT Mode and Past-Paper Intelligence are Premium-only (also checked in `api/analyze-paper.js`).
- Gemini outages never silently switch Free users to Claude (so a Gemini problem never spends paid credit).
- No AI key is ever in the browser.

## Environment variables (derived from `api/**`)

Set these in **Vercel → Project → Settings → Environment Variables**. Use separate values for *Preview* and *Production* (never share live Paystack keys with Preview). None of them may appear in any frontend file or the repo; `tests/audit-regressions.test.js` fails if a Paystack secret or JWT-looking key is found in a frontend file.

| Variable | Needed for | Required? | Secret? | Notes |
|---|---|---|---|---|
| `GEMINI_API_KEY` | Free-plan AI (`api/_lib/gemini.js`) | **Required** for Free users | **Secret** | Missing → Free users see the "temporarily busy" message. |
| `GEMINI_MODEL` | Free model | Optional | No | Default `gemini-flash-lite-latest`. Re-check Google's current free models before launch. |
| `ANTHROPIC_API_KEY` | Premium AI + past-paper analysis | **Required** for Premium | **Secret** | Set a monthly spend limit in the Anthropic console. |
| `ANTHROPIC_MODEL` | Premium model | Optional | No | Default `claude-sonnet-5-5`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Payment activation, webhook, YouTube cache writes | **Required** for payments | **Secret — bypasses RLS** | Server only. |
| `PAYSTACK_SECRET_KEY` | Checkout, verification, webhook signature | **Required** for payments | **Secret** | `sk_test_…` in Preview/testing, `sk_live_…` only in Production at go-live. Must match the public key mode in `app-config.js` (see below). |
| `YOUTUBE_API_KEY` | Real video thumbnails | Optional | **Secret** | Without it the app shows a plain "search on YouTube" link. |
| `APP_SHARED_SECRET` | Light check that calls come from your build | Optional | Secret-ish | Not a substitute for sign-in. If set, the client must send it. |

**Not environment variables (in code, public by design):** the Supabase project URL and the Supabase **anon/publishable** key (`supabase-client.js`, `api/_lib/plan.js`) and the Paystack **public** key (`app-config.js`, `pk_test_…` today). Never put a `service_role`/`sk_` key in those files.

## Database migrations

Run in the Supabase SQL editor. `supabase-schema.sql` (weakness_profiles) comes first, then 02 → 12 in numeric order (both `05` files are independent; run either order). Every file is idempotent, but **do not re-run files blindly** — find out what is applied first.

### How to tell what is already applied (read-only queries)

```sql
-- tables that exist
select table_name from information_schema.tables where table_schema='public' order by 1;
-- functions that exist (07/09/10 create the usage + payment functions)
select proname from pg_proc where pronamespace='public'::regnamespace order by 1;
-- schema 12 applied? anon must have NO table grants except youtube_cache SELECT
select grantee, table_name, string_agg(privilege_type, ', ') from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated') group by 1,2 order by 1,2;
-- are the old youtube_cache write policies gone? (expect no rows after schema 12)
select policyname from pg_policies where tablename='youtube_cache' and cmd in ('INSERT','UPDATE');
```

Evidence in this project: you ran schema 09 earlier and ran schema 11 (feedback). **Schema 10 is not confirmed** — check that `profile_country_changes` exists. **Schema 12 is new and not applied.**

### Migration inventory

| File | Purpose | Depends on | Creates / alters / grants |
|---|---|---|---|
| `supabase-schema.sql` | Weakness profile rows | — | creates `weakness_profiles` + RLS/own-row policies |
| `supabase-schema-02-dedupe-constraint.sql` | Unique key so sync "upsert, ignore duplicates" works | base | alters `weakness_profiles` (constraint) |
| `supabase-schema-03-youtube-cache.sql` | Shared YouTube search cache | — | creates `youtube_cache`; **its "anyone can write" policies are removed by schema 12** |
| `supabase-schema-04-subscriptions.sql` | Premium source of truth | — | creates `subscriptions` + select-own policy |
| `supabase-schema-05-academic-intelligence.sql` | Review schedule, readiness snapshots, past-paper analyses | — | creates 3 tables + own-row policies |
| `supabase-schema-05-ai-usage.sql` | First (legacy) server-side usage counter | — | creates `ai_usage`, function `check_and_increment_usage` (**no longer called; execute revoked by schema 12**) |
| `supabase-schema-06-payment-reference-unique.sql` | One payment reference ↔ one account | 04 | adds unique constraint |
| `supabase-schema-07-profiles-saved-usage-payments.sql` | Profiles/onboarding, saved questions, reserve→commit/release usage, payments ledger | 04, 05-ai-usage | creates `profiles`, `saved_questions`, `ai_usage_reservations`, `payments` + functions; revokes client writes on `ai_usage` |
| `supabase-schema-08-visual-presets.sql` | Background/Accent/Bagley choices | 04, 07 | creates `user_visual_preferences`, RPC `set_visual_preferences` (re-checks Premium) |
| `supabase-schema-09-launch-hardening.sql` | Payment intents, idempotent payment application, run-based quotas | 04, 06, 07 | creates `payment_intents`, `reserve_usage_run`, `apply_verified_payment_v2` |
| `supabase-schema-10-pricing-integrity.sql` | Regional-pricing lock and abuse log | 09 | creates `profile_country_changes`, adds profile/payment columns + triggers |
| `supabase-schema-11-answer-feedback.sql` | 👍/👎/report feedback | — | creates `answer_feedback` + RLS (own rows; append-only) — **no grants** (added by 12) |
| **`supabase-schema-12-data-api-grants.sql`** | **NEW.** Explicit least-privilege Data API grants for every table, `youtube_cache` write lockdown, function EXECUTE hardening, default privileges for future tables | all above (tolerates missing tables) | grants/revokes only; drops 2 over-permissive policies; no data changes; atomic |

**Why 12 matters:** from **30 Oct 2026** Supabase stops auto-exposing new `public` tables to the Data API; tables must be granted explicitly. Existing tables keep their legacy grants, which were broader than needed (RLS was the only guard) and which schemas 03–11 never made explicit. Schema 12 makes access explicit and minimal and behaves the same before and after the cut-over. It is **not** wired to the app by any code change — apply it in Supabase.

### Apply schema 12 safely

1. Supabase → **Database → Backups**: confirm a recent backup exists (Pro) or export the tables you care about.
2. Open `supabase-schema-12-data-api-grants.sql`, paste into the SQL editor, run **once**. It is one transaction: all-or-nothing.
3. Run the VERIFY queries at the bottom of that file. Expected: `anon` has only `youtube_cache SELECT`; `authenticated` has only what the file lists.
4. Smoke-test as a signed-in student: sign in, complete/open profile, ask a question, **Save** it, give 👍 feedback, open Presets, open Progress. A `42501 permission denied` means a grant is missing for that table — report which; do not re-grant broadly.
5. Rollback for one table (temporary): `grant select, insert, update, delete on public.<table> to authenticated;` — RLS still keeps rows private.

## Deploy, verify, roll back

1. Push to a **Preview** deployment with **test** keys. Run the Paystack test-mode steps below.
2. Run migrations in Supabase **before** promoting code that needs them (12 can be applied any time; it does not change behaviour).
3. Bump `CACHE_VERSION` in `service-worker.js` on every frontend release (currently `v40-2026-10-09`) so installed apps pick up new assets.
4. Promote to Production. `vercel.json` adds security headers and `no-cache` for the service worker; `.vercelignore` keeps SQL, tests and generators from being served publicly.
5. **Rollback:** Vercel → Deployments → previous deployment → *Promote to Production*. Database changes are additive; to undo schema 12 for one table use the grant in step 5 above. Do not drop tables.

## Android / iOS (Capacitor)

Config is `capacitor.config.json` (the old `capacitor_config.json` was **ignored by Capacitor** and has been renamed). `webDir` is `www`, produced by `npm run build` (`scripts/build-web.js`): it copies only the files `index.html` actually loads, and fails if one is missing — API code, SQL, tests and README are not packaged. App ID is `com.studymate.ai` — change it before your first store upload (it cannot change after publishing).

```bash
# 1. Set STUDYMATE_API_URL in app-config.js to your deployed https URL (no /api/ask suffix)
npm install
npm run build                  # writes www/
npx cap add android            # once; creates android/
npx @capacitor/assets generate --android   # launcher icons + splash from assets/ (needs network)
npm run sync                   # build + cap sync
npm run open:android           # Android Studio → Build → Generate Signed Bundle
```

iOS: `npx cap add ios`, `npm run sync`, `npm run open:ios` on a Mac with Xcode. Add camera/photo usage descriptions in the native project (the app uses the file picker for photos). Icon/splash sources are in `assets/`; PWA icons in `icons/`.

**Not verified:** `cap sync`, Gradle and release builds could not be run in the audit environment (no Capacitor CLI/Android SDK/network). The repository-side checks (config name, webDir contents, every referenced asset exists) are covered by `tests/audit-regressions.test.js`.

## Payments (Paystack) — what the code guarantees

- The server owns the price; the browser never sends an amount (`api/_lib/pricing.js`). Premium is granted only by `apply_verified_payment_v2` after the server verifies the transaction with Paystack (`api/verify-payment.js`) or a signature-verified webhook (`api/paystack-webhook.js`, HMAC over the raw body). Amount, currency, status, reference, ownership and the server-created intent are all checked; one reference activates once; duplicates/retries are idempotent.
- **New:** test/live mixing guard. `api/checkout.js` reports the server key mode (`sk_test_`/`sk_live_`); the app refuses to start a payment if that disagrees with the public key in `app-config.js`; verify and webhook reject any transaction whose `domain` contradicts the key mode.
- Not implemented (product decisions): recurring subscriptions/auto-renewal (each payment buys a fixed period), cancellation, and refunds — a refunded payment keeps Premium until it expires.

### Test-mode verification (no real money)

1. Vercel *Preview*: `PAYSTACK_SECRET_KEY=sk_test_…`, `SUPABASE_SERVICE_ROLE_KEY`; `app-config.js` keeps the `pk_test_…` key (the TEST MODE banner shows).
2. Paystack dashboard (test mode) → webhook URL `https://<preview-domain>/api/paystack-webhook`.
3. Pay with a Paystack test card. Expect: Premium unlocks; one row in `payments`; the intent shows `success`.
4. Failure cases: use a declined test card (no Premium), close the popup (intent stays pending/abandoned, no Premium), reload `…?reference=<same ref>` (no second activation).
5. Mixing check: temporarily use a `sk_live_` key with the `pk_test_` page → the app must refuse to start checkout.

### Enabling live payments — checklist

- [ ] Paystack account activated for live; business verified; settlement account set.
- [ ] Vercel **Production** only: `PAYSTACK_SECRET_KEY=sk_live_…`. Preview stays on `sk_test_`.
- [ ] `app-config.js`: replace `pk_test_…` with `pk_live_…` (public key) and redeploy.
- [ ] Paystack **live** webhook URL → `https://<production-domain>/api/paystack-webhook`.
- [ ] Re-verify the Paystack currencies enabled on your account match the NGN charge.
- [ ] Make one real low-value payment yourself, confirm Premium + the `payments` row, then refund/handle it in the dashboard.
- [ ] Decide your refund policy (see above).

## Unresolved external tasks

- Run **schema 12** (new) and confirm **schema 10** is applied; run the VERIFY queries.
- Confirm in Supabase that **Auth** email/redirect URLs and any CAPTCHA/rate limits match your production domain.
- Vercel: set the variables above per environment; confirm the project plan's function timeout/body limits (request bodies over ~4.5 MB are rejected by Vercel; the app now shrinks photos and caps paper uploads to ~3 MB total to stay under it).
- Rate limiting in `api/ask.js` is **in-memory per serverless instance (best-effort)**. The hard protections are the server-side quotas, sign-in, and body/text limits. Premium Ask AI is unlimited by design, so set **spend limits** at Anthropic and Google; consider a fair-use daily ceiling (a business-rule change — not applied).
- No CSP header: the app relies on inline scripts/handlers; a nonce-based CSP is a larger refactor.
- Android SDK/Gradle release build and a real-device test are not done.

## Presets (visual personalization)

- Entry: Profile → **Presets** (also tap Bagley on the Home screen). Three independent layers — Backgrounds, Accents, Bagley — plus My Preset and curated Combos.
- Catalog: `personalization-data.js` (generated; 100 backgrounds / 100 accents / 100 Bagley / 20 combos), `personalization-scenes.js` (lazy, background scene specs), `personalization-art.js` (procedural SVG renderer — no image files), `personalization.js` (engine + UI), `personalization.css`. Edit the sources in `gen/` and run `node gen/build.js` to regenerate.
- Free = the first 5 of each category (`..._001`–`..._005`). Premium status is the existing subscription logic; the database function `set_visual_preferences()` re-checks it server-side (run `supabase-schema-08-visual-presets.sql`).
- No new environment variables.

## Bagley Personalization Layer (pre-agent)

Makes Bagley feel like he knows the student, while staying a plain request/response system (no tools, function calling, agent loops, background work or autonomous memory writes — those wait for the future Bagley Agent).

- **Client:** `bagley-context.js` → `BagleyContext.build()` is a pure function that assembles a compact context from data the app already holds for the signed-in account: profile (first name, country, exam, class, routine, language), Weakness Profile (weak/strong/declining topics, mastery, trend, recent mistakes, readiness), and recent activity (recent topics, saved questions) — all scoped to the current subject. Missing data is omitted, never guessed. Visual presets are not sent. `index.html` calls it from `askQuestion()` and sends it as `bagleyContext` with the Ask AI request.
- **Server:** `api/_lib/bagley-context.js` whitelists/sanitizes the object, caps its size, trims depth by the *verified* plan (Free = core, Premium = deeper history), and prepends one prompt block to the question for **both** Gemini (Free) and Claude (Premium). Bad input is ignored; the request proceeds as before.
- **Behaviour rules** live in that block: never recite data, never invent memories/improvement, correctness first, the student's own instruction always wins, difficulty nudges are gentle (low/medium/high), education context only from the selected country/exam.
- **Response contract:** Ask AI JSON gained optional `bagleyInsight` and `nextStep` (rendered as a subtle "Bagley's Insight / Recommended next" box only when present). Existing fields are unchanged.
- **Other features** (Practice, Teach Me, Study Material, Flashcards) keep their existing weakness brief, now produced by the same builder (`BagleyContext.toBrief`) so there is one definition of "weak".
- **YouTube:** `buildVideoQuery()` prefixes the student's selected exam short name (e.g. "GCSE …"); with no exam selected the query stays neutral.
- No migrations, no new environment variables. Tests: `node tests/bagley-context.test.js`.


## Launch hardening (schemas 09 & 10)

**Run order.** In the Supabase SQL editor run `supabase-schema-09-launch-hardening.sql`, then
`supabase-schema-10-pricing-integrity.sql` (both idempotent), THEN deploy. Vercel needs
`PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`.
`app-config.js` must hold the matching `pk_live_` key (it is `pk_test_` while building).

**Free limits are enforced on the server** (`api/_lib/limits.js`, `api/ask.js`): reserve → provider →
commit, or release on failure. The browser only displays usage (`/api/usage`).

**Payments** (`api/checkout.js`, `api/verify-payment.js`, `api/paystack-webhook.js`):
- The server owns the price (`api/_lib/pricing.js`); the browser never sends an amount, currency or region.
- First purchase is priced by the *selected* country. The edge IP country is stored as a risk signal
  (`api/_lib/risk.js`) and is never returned to the browser. A mismatch only asks the student to confirm;
  repeated country switching / cheaper-region shopping pauses new checkouts for at most 24 h.
- The first successful payment locks the student's pricing region for good.
- Premium is granted only when Paystack's verified amount AND currency equal the server-created intent
  for that reference and user; the ledger is idempotent per reference.
- Tune risk thresholds in `api/_lib/risk.js` (`MEDIUM`, `HIGH`, `COOLDOWN_MS`); every intent stores its
  `risk_score` / `risk_flags` for review.

**Tests.** `npm test` runs everything. The pricing/quota tests run the real handlers against
`tests/helpers/fake-backend.js`, a JavaScript port of the SQL rules — it is NOT a database, so verify
schemas/triggers/RLS in Supabase and run one real Paystack test-mode purchase before launch.

**XSS hardening.** Every AI-, user- or storage-controlled value that reaches `innerHTML` goes through
`escapeHtml()` (text/attributes) or `escapeForInlineHandler()` (arguments inside `onclick="…"`).
`tests/curriculum-security.test.js` scans `index.html` for regressions — if you add a new template that
interpolates a topic, subject, file name, AI text or error message, wrap it, or that test will fail.
