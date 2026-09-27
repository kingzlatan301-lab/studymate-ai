# StudyMate AI app

StudyMate AI is a mobile-first exam prep tutor for students worldwide — WAEC, GCSE/A-Level, SAT/ACT/AP, IGCSE, IB and more, selectable by country. It works as an installable web app and can be packaged as a native Android or iOS app with Capacitor.

## Run it locally

```bash
npm install
npm run serve
```

Open `http://localhost:5173` on your computer or phone. In Chrome or Edge, use **Install app** from the browser menu to install the PWA.

## Sign-in is required

As of this build, a signed-in Supabase account is required before StudyMate can be used at all — there is no local-only/guest mode. This is what lets the Free/Premium split below be enforced honestly on the server; without a verified identity there's nothing to attach a daily AI-question count or a Premium subscription to. See `enforceAuthGate()` in `index.html`.

## Free plan → Gemini, Premium → Claude

`api/ask.js` is a server-side proxy. It verifies the caller's Supabase session, checks their real subscription status, and routes accordingly:

- **Free** users get **Gemini** (Google's free API tier), capped at 3 AI questions/day, enforced server-side (see `supabase-schema-05-ai-usage.sql`). If Gemini is temporarily rate-limited or down, Free users see a friendly "try again / upgrade" message — they are never silently switched to Claude, so a Gemini hiccup never spends paid credits.
- **Premium** users get **Claude**, with no daily cap.
- Mock Exam, Flashcards, Teach Me, Practice, and Study Material also route Free traffic to Gemini and Premium to Claude, but keep their existing weekly limits enforced client-side (as before) rather than a hard per-request server counter — see the comment at the top of `api/ask.js` for why (they call this endpoint once per generated question/item, not once per use).
- CBT Mode and Past-Paper Intelligence remain Premium-only, checked server-side too (`api/analyze-paper.js`).

The browser never contains an AI provider API key.

1. Import this folder into Vercel (or deploy it with the Vercel CLI).
2. In the Vercel project settings, add `ANTHROPIC_API_KEY` (Premium's provider). Optionally add `ANTHROPIC_MODEL`.
3. Add `GEMINI_API_KEY` (Free's provider) — get one free from [Google AI Studio](https://aistudio.google.com/apikey). Optionally add `GEMINI_MODEL` (defaults to `gemini-flash-lite-latest`) — double-check the current free-tier model lineup at ai.google.dev before launch, since Google periodically retires dated model versions.
4. Run `supabase-schema-05-ai-usage.sql` in the Supabase SQL editor — this backs the Free plan's 3-questions/day limit with a real server-side counter. (This assumes `supabase-schema-04-subscriptions.sql`, for Premium, has already been run — see below.)
5. Optional: add `APP_SHARED_SECRET` (any random string) as a lightweight check that requests are coming from your own app build, not a random script that found the URL. This is not a substitute for the sign-in requirement above.
6. Optional: add `YOUTUBE_API_KEY` (a YouTube Data API v3 key from console.cloud.google.com) to show real video thumbnails under each Ask AI answer, via `api/youtube.js`. Without it, the app falls back to a plain "search on YouTube" link — nothing breaks, it's just less polished. This key is shared across every user of the deployed app; `api/youtube.js` checks a shared cache (see `supabase-schema-03-youtube-cache.sql`) before ever spending quota on it, which is what keeps the free tier's ~100 searches/day viable under real traffic.
7. Required for real Premium payments: add `PAYSTACK_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as environment variables — never in any frontend file, never in the repo. Run `supabase-schema-04-subscriptions.sql` in Supabase first. Then in Paystack's dashboard (Settings → API Keys & Webhooks), set the webhook URL to `https://<your-domain>/api/paystack-webhook` — this is a backup confirmation path, not the primary one (see the comment at the top of that file for why both exist). Start in Paystack's Test Mode with test keys before ever switching to live keys — test card numbers are in Paystack's own docs. **Note**: Paystack cannot charge GBP/CAD/AUD/INR/AED at all — the app displays local-currency prices everywhere, but every actual charge happens in NGN under the hood (see the comment above `PRICING_BY_COUNTRY` in index.html for the full explanation and the conversion table).
8. Deploy. The web app will automatically use its own `/api/ask` endpoint.

If `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` is missing, the corresponding plan's requests fail gracefully (Free falls into the "temporarily busy" message; Premium gets a clear "not configured" error) rather than exposing internals.

`api/ask.js` also validates request size/shape and applies basic in-memory rate limiting per IP. Both are documented as first-line defenses in the file's comments — swap the rate limiter for a shared store (Vercel KV, Upstash) before you expect real traffic across multiple server instances.

## Build a native app

Before building Android or iOS, edit `app-config.js` and set `STUDYMATE_API_URL` to the public URL you deployed above. Do not include `/api/ask` in that value.

```bash
npm install
npx cap add android
npm run sync
npm run open:android
```

For iOS, run `npx cap add ios`, `npm run sync`, and `npm run open:ios` on a Mac with Xcode. In Android Studio or Xcode, set your signing identity and build a signed release for store submission.

## Important before publishing

- Change `appId` and `appName` in `capacitor.config.json` to your final store identity.
- Generate Android/iOS icons from the SVG in `icons/icon.svg` using Capacitor's asset tool.
- Add camera permission descriptions to the native platform project after running `cap add`.
- Use a managed AI key with spending limits and add rate limiting/authentication to `api/ask.js` before public launch.
