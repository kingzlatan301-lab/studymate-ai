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
