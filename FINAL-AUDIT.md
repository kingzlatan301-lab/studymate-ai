# StudyMate AI — final audit (1 Nov 2026)

## Results actually obtained
| Check | Result |
|---|---|
| `npm test` (original 220 + new) | **242 / 242 pass** |
| Real-browser tests (Chromium, Supabase + /api stubbed) | **12 / 12 pass** (`npm run test:e2e`) |
| Calculator engine vs. JavaScript arithmetic | 4000 random expressions agree (also cross-checked against a tree evaluator) |
| Calculator fuzz | 20 000 garbage inputs + pathological inputs: never throws, never hangs, never non-finite |
| Every formula worked example (≈150 outputs) re-computed through the engine | pass |
| Hostile-text injection test (AI-generated topic/subject/question/ids) | pass; **fails when the old vulnerable handler is restored** (mutation-checked) |
| Theme files vs. original upload (hash baseline) | byte-identical; `index.html` — 0 original lines removed |
| Text contrast of new screens: 100 accents × 12 backgrounds × dark/light | 0 failures |
| Syntax check of every JS file | 0 failures |
| Secrets in browser-delivered files | none (only comments naming env vars) |
| Duplicate DOM ids / missing precached files | none |

## Defects found by this audit and fixed
1. **Injection via inline handlers** — `esc()` output is decoded by the browser before an `onclick` runs, so an AI-generated topic such as `');…//` could execute. Fixed: index/`data-` attribute handlers, strict ID charset (`jid`), cloud-loaded sessions re-validated, client ids restricted to `[A-Za-z0-9_-]`.
2. Mock-exam hook read `mockExam` after the results screen cleared it (would have thrown after every mock exam).
3. Calculator zeroed legitimate tiny SI results (e.g. 3.3×10⁻¹⁹ J).
4. Button text ignored the theme engine's contrast tokens.
5. Schema 15 draft: missing `service_role` grant, unused client DELETE, unrestricted INSERT columns, no self-check — all corrected in the version that was run.
6. Earlier audit claim that `ai_usage` still had client write policies was wrong (schema 07 drops them) — no change needed.

## Database state (verified by you, not by me)
Schemas 15 and 16 ran successfully; schema 17 (read-only verification of RLS, anon/authenticated/service_role grants, function ACLs, `srv_*` functions, `search_path`) ran with no failure.

## NOT verified / residual risk (be aware)
- Postgres RLS has never been exercised from two real accounts. Do a two-account smoke test (save a question as A, confirm B sees nothing).
- The SQL was never run by me; only by you in Supabase. Repo schema 15 is the version you ran.
- No real-device (iOS/Android/Capacitor) testing; no real AI, Paystack or sign-in flow was driven end to end.
- `npm audit` could not run (no lockfile / offline).
- `vercel.json` sets nosniff, frame-deny, referrer and permissions headers but **no Content-Security-Policy**. Pre-existing; adding one needs care because the app uses inline handlers.
- Formula Book content is standard textbook material I wrote; it needs subject-teacher review (four entries flagged `rv`).
- Search covers only questions the student has practised or saved (the app has no question bank).


---
# Update 2 — onboarding theme step, light-mode redesign, API-lib guard (3 Nov 2026)

## What changed
- **Onboarding "Pick your look"** (new step after the study-routine question): shows **Light** (pre-selected default) plus the **five free themes** (Midnight Study, Deep Ocean, Aurora Night, Enchanted Forest, Cosmic Drift) with real scene previews. Tapping a card previews it live; saving goes through the existing server-checked `set_visual_preferences` (free ids only — premium themes can never be chosen here). No choice = Light. "Keep Light for now" reverts any preview. Strings added in EN/FR/ES/PT.
- **New-student default is Light.** Only applied when the student has never chosen an appearance; an explicit Dark choice and every returning student are untouched (tested).
- **Light mode redesigned** (`light-mode.css`, scoped to `[data-theme="light"]` only; dark mode and all theme files untouched): the chosen background now shows (veil follows the Clarity setting; art lifted), text darker and heavier (17:1 / 9:1 contrast), borders stronger, cards opaque with shadows, selected chips solid, halo behind text that sits directly on the scene.
- **Two real bugs fixed along the way:** (1) the onboarding card was taller than small phone screens and did not scroll (top/bottom clipped) — now scrolls; (2) *pre-existing:* the invisible toast intercepted taps in a box at bottom-centre, silently blocking buttons beneath it — now `pointer-events: none`.
- **API libraries confirmed:** `api/_lib/safety.js`, `limits.js`, `ratelimit.js`, `plan.js` (and all other API files) are byte-identical to your original upload except `api/account.js` (export list, earlier). Safety prompt is used by `ask`, `analyze-paper` and `gemini`; limits by `ask`, `usage`, `analyze-paper`; rate limiting on 6 endpoints; auth on 7; usage accounting calls `srv_*`. New guard test `tests/api-libs-guard.test.js` fails if any of that is removed. Free limits in force: AI questions 3/day, practice 6/week, mock exam 1/week, flashcards 1/week, Teach Me 1/week, study material 1/week; premium past-paper analysis 5/week.

## Results
`npm test`: **245 / 245**. `npm run test:e2e`: **16 / 16** (adds onboarding, existing-student preservation, measured light-mode quality, toast regression). Theme files: still byte-identical to the original upload.

## Not verified
Real iOS/Android devices; light mode on every one of the 100 premium backgrounds (visually reviewed the five free ones; contrast of text/buttons is tested across all accents); onboarding with a live Supabase (the stub implements `set_visual_preferences`; the real function enforces free-only on the server).

---
# Update 3 — audit sweep (3 Nov 2026)

## Method
Pixel-level legibility sweep: every screen + every onboarding step + the themes modal, in light and dark, over all five free backgrounds
(130 views, 3,455 text runs per mode; text colour vs. sampled background pixels). Plus assumption checks (RPC contracts, element ids,
cleanup paths), data-corruption and offline tests, and re-verification of the whole suite.

## Found and fixed
1. **Light-mode legibility** — first sweep: 174 of 3,455 runs below WCAG AA (small text on busy scenes, translucent badges/pills/tabs).
   After fixes: 56, all explained (31 intentionally faded locked-achievement emoji, 15 disabled "Price unavailable" buttons in the test stub,
   5 decorative empty-state emoji, 5 gradient-filled heading words the method cannot measure). On the screens I built: **0 below AA, both modes**.
2. **Calculator "DEG" pill** was 3.8:1 in dark mode — fixed. Search hint text (existing screen) was 3.1:1 — fixed in both modes.
3. **Sessions never retried uploading** after a cloud failure (offline sessions stayed device-only and were missing on a new device).
   Now uploaded on the next history load (max 25 per attempt, 60 s back-off, idempotent via `unique(user_id, client_id)`).
4. **Shared-device privacy** — calculator memory was not scoped to the account, and a previous account's local history, notes,
   favourites and calculator history stayed on the device. Memory is now per account; other accounts' keys are purged on sign-in.
5. **Corrupted / tampered local storage** crashed the calculator memory buttons. Every stored value read by the new features is now
   shape-validated; a test corrupts all keys and opens every new screen.

## Verified (not changed)
- `set_visual_preferences` returns `{ok}` — matches how onboarding and the theme engine read it.
- Progress tabs hide/show the original content correctly; no duplicate element ids; all precached files exist.
- Only ONE original line of `index.html` differs from your upload (onboarding hands off to the theme step instead of the plan step).
- API: only `api/account.js` differs from your upload (export list, earlier). Theme files: byte-identical.

## Known limitations / pre-existing (not changed)
- **Dark mode has pre-existing lower-contrast spots** in the original UI (e.g. selected chips: green on green-tint ≈ 2.8:1; small grey helper text ≈ 3.5–4.2:1;
  "Retry" 4.2:1). Dark mode and the premium themes were deliberately left alone; say the word and I'll fix them.
- **The new screens' labels are English only** (Formula Book, Calculator, History, Performance, Search results). Only the onboarding step is translated
  (EN/FR/ES/PT). Translating the rest is a separate task.
- Light mode was visually reviewed on the five free backgrounds; the other 95 premium backgrounds were not individually reviewed.
- New devices start in Dark on the sign-in screen until onboarding begins (the Light default is applied when a new student's onboarding starts).

## Results
`npm test` 245/245 · `npm run test:e2e` 19/19 · syntax clean · no secrets in browser files · production build OK.
