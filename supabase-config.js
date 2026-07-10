// ============================================================================
// SAGE — supabase-config.js
// ----------------------------------------------------------------------------
// FILL IN THE TWO BLANKS BELOW to turn on the cloud (Supabase) backend.
// Find both in your Supabase project:  Settings → API.
//   • url      → "Project URL"        (looks like https://abcd1234.supabase.co)
//   • anonKey  → "anon public" key    (a long string; public by design — your
//                                       Row-Level-Security policies are the gate)
//
// UNTIL you fill these in, SAGE runs on the in-memory backend and you can open
// index.html directly (no server, data resets on reload). Once they're filled,
// SAGE uses your real database, asks you to sign in, and data persists.
//
// This file is safe to commit to a PUBLIC repo: the anon key is meant to be
// public, and nothing is readable without signing in (authenticated-only RLS).
// ============================================================================

window.SAGE_CONFIG = {
  url:     "https://tpuyniymowurfmcblzsp.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwdXluaXltb3d1cmZtY2JsenNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwOTcyOTQsImV4cCI6MjA5ODY3MzI5NH0.6rwmJ0DihEbvb_jaAvfubGKKfGLufRix0t8btGQTqdo",
};
