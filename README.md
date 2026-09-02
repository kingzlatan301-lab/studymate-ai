# StudyMate AI app

StudyMate AI is a mobile-first exam prep tutor for students worldwide — WAEC, GCSE/A-Level, SAT/ACT/AP, IGCSE, IB and more, selectable by country. It works as an installable web app and can be packaged as a native Android or iOS app with Capacitor.

## Run it locally

```bash
npm install
npm run serve
```

Open `http://localhost:5173` on your computer or phone. In Chrome or Edge, use **Install app** from the browser menu to install the PWA.

## Enable real AI answers

The browser never contains an API key. `api/ask.js` is a server-side proxy that sends requests to Anthropic securely.

1. Import this folder into Vercel (or deploy it with the Vercel CLI).
2. In the Vercel project settings, add `ANTHROPIC_API_KEY` as an environment variable. Optionally add `ANTHROPIC_MODEL`.
3. Optional: add `APP_SHARED_SECRET` (any random string) to add a lightweight check that requests are coming from your own app build, not a random script that found the URL. This is not real user authentication — see the note in `api/ask.js` for what that would take.
4. Deploy. The web app will automatically use its own `/api/ask` endpoint.

Without that environment variable, the interface deliberately uses its built-in sample answer if the AI request cannot be completed.

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
