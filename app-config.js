// For the web app, leave this blank: it uses the same domain's /api/ask route.
// For Android/iOS builds, set this to your deployed app URL, without /api/ask.
// Example: window.STUDYMATE_API_URL = 'https://studymate.example.com';
window.STUDYMATE_API_URL = '';

// ── PAYSTACK PUBLIC KEY (test vs live) ──────────────────────────────────
// This is a PUBLIC key (safe in frontend code). The matching SECRET key lives
// only in the server environment (PAYSTACK_SECRET_KEY) — never here.
//
//   pk_test_…  → TEST MODE. The paywall shows a "TEST MODE" banner and no
//                real money moves. The server must have the sk_test_… key.
//   pk_live_…  → LIVE. Real charges. The server must have the sk_live_… key.
//
// BEFORE PUBLIC / PLAY STORE LAUNCH you must change THREE things together:
//   1. Replace the key below with your pk_live_… key.
//   2. Set PAYSTACK_SECRET_KEY in the hosting environment to the sk_live_… key.
//   3. Point the Paystack LIVE dashboard webhook at /api/paystack-webhook.
// (Test-mode payments are recorded with plan 'premium_monthly_test' so they
//  can be found and removed: delete from subscriptions where plan like '%_test';)
window.STUDYMATE_PAYSTACK_PUBLIC_KEY = 'pk_test_243ce26d5c666c1a015841c05e9ac3b920198594';
