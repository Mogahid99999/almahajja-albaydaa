/**
 * App-wide runtime configuration.
 *
 * `USE_MOCK` is the single switch between the in-memory mock dataset
 * (`src/mock/*`) and the live Supabase backend. Everything in `src/api/*`
 * branches on it, so the rest of the app is unaware of the data source.
 *
 * Auth is intentionally NOT mocked away: sign-in/reset hit real Supabase so
 * email password-reset works. In mock mode, sign-in additionally accepts the two
 * demo accounts locally so emulator testing never blocks on email delivery.
 */
export const USE_MOCK = false;

/** A lecture is marked complete once this fraction has been listened. (PRD §9) */
export const COMPLETE_THRESHOLD = 0.9;

/**
 * Max seconds a single save-progress tick may credit to today's listening total.
 * Caps scrub-forward inflation so jumping ahead can't be counted as listening
 * time (رحلتي العلمية daily feed — see saveLectureProgress / recordListening).
 */
export const MAX_LISTEN_TICK_SEC = 90;

/** The two demo accounts (also seeded in Supabase Auth via scripts/seed-auth.mjs). */
export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@gmail.com', password: 'test55%%', role: 'admin' as const },
  student: { email: 'user@gmail.com', password: 'test55%%', role: 'student' as const },
};

/**
 * Lecture lifecycle. The DB enum currently has only draft/published; we model
 * `unclassified` at the app level now so the deferred Telegram bot + admin
 * review queue (PRD §14.2) plug into the same path without a redesign.
 */
export type AppLectureStatus = 'unclassified' | 'draft' | 'published';
