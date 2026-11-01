# StudyMate AI — six-feature release (implementation notes)

## What was added
| Feature | Where | Notes |
|---|---|---|
| Formula Book | `formula-data.js` (133 formulas, lazy-loaded), `features-formulas.js` | Maths, Further Maths, Physics, Chemistry. Search by name/topic/symbol, subject filter, favourites, recents, copy, "Use in Calculator". |
| Scientific Calculator | `calc-engine.js` (no `eval`), `features-formulas.js` | DEG/RAD, memory, history, fractions, factorial, %, sci-notation, keyboard, offline (precached). |
| Saved Questions | `features-study.js` (wraps `renderHistory`) | Reuses existing `saved_questions` table (`answer_data.kind = "mcq"`). Duplicates blocked by the existing unique key. Notes need schema 15 (device-only fallback). |
| Exam & Practice History | Progress ▸ History tab, `study_sessions` table | Practice, Mock, CBT, Teach Me quizzes, retries. Append-only. |
| Performance Analytics | Progress ▸ Performance tab | Only recorded answers; topics need ≥5 answers before being called weak (<50%) / strong (≥75%). |
| Smart Question Search | Existing Search screen, "Questions" section | Searches only questions the student has practised/saved. `SMF.registerQuestionSource(fn)` plugs in a real bank later. |

Entry points: Home ▸ toolkit row (Formulas · Calculator · Find · History); Progress ▸ tabs; Saved tab; Search.

## Database (schemas 15–17 — see FINAL-AUDIT.md)
Schema 15 (history + notes), 16 (two missing indexes), 17 (read-only final verification) and `supabase-audit-probe-readonly.sql` (read-only probe). Schema 15 below is the version that was executed.

## Schema 15 detail
`supabase-schema-15-study-sessions.sql`: new `study_sessions` (RLS own-rows; select/insert/delete only — no UPDATE, so results can't be rewritten; `unique(user_id, client_id)`), plus `saved_questions.note` with an own-row UPDATE policy limited by column grant to `note`. Nothing existing is dropped or altered. Without it everything still works on-device.

## Existing files touched (additive only: 0 lines of original `index.html` removed or changed, 28 added)
`index.html` (screens, toolkit row, script tags, guarded `window.SMF` hooks), `service-worker.js` (precache + cache version), `scripts/build-web.js`, `api/account.js` (+`study_sessions` in data export), `README.md`, `package.json`, `tests/audit-regressions.test.js` (schema-12 coverage check now ignores schemas ≥15, which carry their own grants).

## Tests
`npm test` (242, includes 22 new) · `npm run test:e2e` (12 real-browser tests; needs Playwright + Chromium, Supabase/API stubbed).
