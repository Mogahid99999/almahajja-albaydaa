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

/**
 * TESTING ONLY (PLAN_V3 §15): when true, the local reminder ladders collapse
 * from hours to a few seconds so every notification type can be verified quickly
 * on the device. MUST be `false` for any shipped build — flip back + rebuild
 * after device verification. Has no effect on push/cron timing (server-side).
 */
export const NOTIF_TEST_MODE = false;

/**
 * Environment-specific display overrides (audit F-020): the production DB's
 * `sheikhs.name` for this record predates his family name, and updating live
 * data is an owner action — until then the التعريف بالشيخ hero card shows the
 * fuller name from his biography. Display-only, never persisted. Keyed by
 * `sheikhs.id`, so it is inert on any other environment (mock/staging).
 * DELETE the entry once the DB row is renamed.
 */
export const SHEIKH_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  '7d14315d-1211-4f72-a8ca-8308ed78e1f8': 'الشيخ النذير محمد فرح عثمان',
};

/**
 * Floating-bubble overlay (PLAN_V3 Phase 9) — EXPERIMENTAL, Android-only, OFF by
 * default. The native overlay module (modules/floating-bubble) must be activated
 * via `expo prebuild` and the user must grant SYSTEM_ALERT_WINDOW; until then the
 * JS layer (`src/lib/bubble.ts`) gracefully no-ops. Flip on only once the native
 * module is linked + device-verified.
 */
export const BUBBLE_ENABLED = false;

/** A lecture is marked complete once this fraction has been listened. (PRD §9) */
export const COMPLETE_THRESHOLD = 0.95;

/**
 * Max seconds a single save-progress tick may credit to today's listening total.
 * Caps scrub-forward inflation so jumping ahead can't be counted as listening
 * time (رحلتي العلمية daily feed — see saveLectureProgress / recordListening).
 */
export const MAX_LISTEN_TICK_SEC = 90;

/**
 * The two demo accounts (also seeded in Supabase Auth via scripts/seed-auth.mjs).
 * Only defined in mock mode — must not exist in the release JS bundle, since the
 * literal credentials would otherwise be recoverable from a shipped APK.
 */
export const DEMO_ACCOUNTS = USE_MOCK
  ? {
      admin: { email: 'admin@gmail.com', password: 'test55%%', role: 'admin' as const },
      student: { email: 'user@gmail.com', password: 'test55%%', role: 'student' as const },
    }
  : undefined;

/**
 * Lecture lifecycle. The DB enum currently has only draft/published; we model
 * `unclassified` at the app level now so the deferred Telegram bot + admin
 * review queue (PRD §14.2) plug into the same path without a redesign.
 */
export type AppLectureStatus = 'unclassified' | 'draft' | 'published';
