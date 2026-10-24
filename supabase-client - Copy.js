/**
 * StudyMate AI — Supabase client + auth state
 * ─────────────────────────────────────────────────────────────────────────
 * This key is the PUBLISHABLE/anon key, not the secret/service_role key.
 * It is safe to ship in frontend code — Supabase is designed around this;
 * the anon key only grants what your Row Level Security (RLS) policies
 * allow, which is why the weakness_profiles table's "auth.uid() = user_id"
 * policy is what actually protects student data, not key secrecy.
 *
 * NEVER put a service_role/secret key here or in any file under
 * /mnt/user-data/outputs — that key bypasses RLS entirely and must only
 * ever live server-side (it has no business in this app at all, since
 * every write here is scoped to the signed-in student's own row).
 */

// The project URL and publishable key below are filled in for this app.
// The publishable key is safe to ship in frontend code (see note above) —
// it only grants what your RLS policies allow.
const SUPABASE_URL = 'https://xlbnvmkcooueucuayrvy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QHKfnwzCQUW23sNWL2YUPg_H2-oxJ3g';

window.sbClient = null;
if (SUPABASE_PUBLISHABLE_KEY && SUPABASE_PUBLISHABLE_KEY !== 'PASTE_YOUR_SB_PUBLISHABLE_KEY_HERE' && window.supabase) {
  window.sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
} else {
  console.warn('[StudyMate] Supabase client not initialized — set SUPABASE_PUBLISHABLE_KEY in supabase-client.js. Cloud accounts/sync are disabled; the app continues to work fully on local storage.');
}

// ── Auth state, kept in one place so the rest of the app (index.html) can
// read window.sbAuthSession without needing to know Supabase's API shape.
window.sbAuthSession = null;
window.sbAuthReady = false; // flips true once the initial session check completes

// Fires whenever auth state is known/changes — index.html listens for this
// to update the Account settings UI without polling.
function dispatchAuthChange() {
  document.dispatchEvent(new CustomEvent('sb-auth-change', { detail: { session: window.sbAuthSession } }));
}

async function initSupabaseAuth() {
  if (!window.sbClient) { window.sbAuthReady = true; dispatchAuthChange(); return; }

  const { data, error } = await window.sbClient.auth.getSession();
  if (error) console.error('[StudyMate] getSession error', error);
  window.sbAuthSession = data ? data.session : null;
  window.sbAuthReady = true;
  dispatchAuthChange();

  window.sbClient.auth.onAuthStateChange((_event, session) => {
    window.sbAuthSession = session;
    dispatchAuthChange();
  });
}

initSupabaseAuth();
