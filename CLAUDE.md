# منصة دروس العلم الشرعي

## What this is
An Arabic-first (RTL) Islamic learning app. Lectures are organized into nested sections/items (a section can contain sub-sections and lectures, recursively — e.g. العقيدة → التوحيد → كتاب التوحيد → lessons). Calm, non-competitive tone throughout: no leaderboards, no public ranking, no gamified visuals.

## Scope decision
Telegram bot integration is DEFERRED. For now, lectures are added only through a manual admin upload form. Build the "unclassified" admin review concept anyway (draft/published status), so the bot can plug into the same queue later without any redesign.

## Shipped feature baseline (v1 — all of this is LIVE, do not treat as unbuilt)
The original MVP list (upload form, nested sections, admin panel, player + mini player,
resume, offline downloads, personal progress, About page) shipped long ago, and the
product has since grown far past it (work batches V2→V17, see `PLAN_*.md` history):
- **Playback**: full + mini player, background/lock-screen controls (patched expo-audio),
  auto-advance, playback speed, `?t=` deep-link seek, completion at **95%** listened
  (`COMPLETE_THRESHOLD = 0.95` in `src/config.ts`), offline downloads + offline playback.
- **Roles**: guest (anonymous session) / student / **publisher** / **sheikh** / admin.
- **Quizzes**: server-graded MCQ per section (answer key never reaches the client),
  attempts/time limits, admin editor + results dashboards.
- **Notifications**: push (FCM/APNs via Expo) + server cron reminders (resume, streak,
  weekly goal), broadcasts ("التذكيرات النافعة"), in-app inbox, per-type prefs, badge count.
- **Journey**: weekly goals, daily streak (المداومة) with 2-day tolerance + recovery,
  quiet badges, journey page.
- **Community**: Q&A (public/sheikh-only, anonymity end-to-end), voice notes, private
  lesson notes (autosave), shared "فوائد", study buddy (رفيق الدرب, gender-segregated),
  content reports + blocked-word moderation.
- **Engagement**: onboarding tour, rating prompt, share, WhatsApp/Telegram support links,
  UpdateGate (min-version + 30-day grace).
- **Offline-first**: persisted query cache, outbox sync queue for progress/notes/goals.
- **Admin web**: 22 screens (dashboard, analytics, users+ban, uploads with transcode,
  section tree, sheikhs+bio, quizzes, moderation queues, featured, broadcasts, settings).

## Still out of scope
Telegram ingestion bot (the `unclassified` queue it would feed is built), a dedicated
admin mobile app (the responsive admin web is used from phones), certificates,
community comments/competitions, auto-transcription/summaries, complex permissions.

## Tech Stack

**Single cross-platform codebase targeting iOS, Android, and Web (Expo).**

| Concern | Choice |
|---|---|
| App framework | **Expo (React Native)** — SDK 56 |
| Navigation | **Expo Router** (file-based routing, `app/` directory) |
| Language | **TypeScript** with `strict` mode enabled |
| Backend | **Supabase** — PostgreSQL (87+ migrations, RLS), Auth, Edge Functions. Audio/files live on **Cloudflare R2** via signed-URL edge functions (`r2-upload-url`/`r2-read-url`/`r2-delete`) |
| Audio playback | **expo-audio** |
| Offline downloads | **expo-file-system** |
| Client state | **Zustand** (player state, download state) |
| Server state / data fetching | **TanStack Query** (`@tanstack/react-query`) |

### Why this stack
- One codebase ships the three mobile screens (Home, Section, Player) **and** the web admin dashboard — no separate web app to maintain.
- Supabase Postgres natively supports the recursive `WITH RECURSIVE` CTEs the nested-section rollups need (see `.claude/skills/nested-sections`). Those CTEs live as SQL functions in `supabase/migrations` and are called from the client via `supabase.rpc(...)`.
- The [nested-sections skill](.claude/skills/nested-sections/SKILL.md) originally sketched a Prisma/Next.js data layer; the **schema and query semantics are unchanged**, only the implementation is Supabase SQL + `supabase-js` instead of Prisma.

### Project layout
```text
app/                  Expo Router routes (file-based)
  _layout.tsx         Root shell: session/auth gates, RTL bootstrap, query-cache persistence,
                      notifications bootstrap, UpdateGate, deep links (~620 lines — read before touching)
  (auth)/             Sign-in, register (+oath), reset-password
  (student)/          Student app (Home, section/[id], journey, questions, downloads, profile, …)
  player/[id].tsx     Full-screen player · attachment/[id] transcript reader
  sheikh/             Sheikh Q&A inbox
  admin/              Admin web dashboard (22 screens, role-gated)
src/
  lib/                supabase client, query client, env, audioController, downloads, outbox, notifications
  api/                Data-access functions — the ONLY place that calls supabase
  hooks/              TanStack Query hooks wrapping src/api
  stores/             Zustand stores ×6 (player, downloads, notifications, settings, tour, publicStorage)
  types/              Shared types incl. database.generated.ts
  constants/          Design tokens, queryKeys, badges
  components/         Shared UI (home/, section/, player/, questions/, admin/, …)
supabase/
  migrations/         87+ append-only migrations (schema, RLS, RPCs) — never edit an applied one
  functions/          Edge Functions: admin-users, delete-account, notify-on-publish, r2-*
patches/              patch-package diffs (expo-audio media controls fork, react-native-web I18nManager shim)
audit/                Production-readiness audit: FINDINGS.md log, DEVICE_MATRIX.md, reports/ (see PLAN_AUDIT.md)
```

### Stack conventions
- All data-access goes through `src/api/*`; components never call `supabase` directly.
- Recursive subtree rollups (lecture counts, progress %) are **always** server-side SQL functions, never client-side tree walking.
- Student-facing reads must filter `status = 'published'`; admin reads see drafts too (enforced by RLS, not just query filters).

## Design
RTL throughout, design system synced from Claude Design. Calm muted teal/off-white palette, no bright competitive colors, no heavy animation.

## Testing (audit phase 12)

Jest + React Native Testing Library via the `jest-expo` preset. `npm test` runs everything;
`npm run test:watch` for TDD. CI (`.github/workflows/ci.yml`) runs `npm ci` (which exercises
the patch-package postinstall), `npm run typecheck`, and `npm test` on every push/PR.

**Where tests live**
- `src/<module>/__tests__/<name>.test.ts` — colocated unit tests for pure logic
  (formatters, outbox queue, resume cache, badge catalog, phrase picker, quiz status
  derivation, error mappers, the journey p_today shim).
- `tests/screens/<screen>.test.tsx` — component tests for route screens and shared
  components. Screen tests must NOT live inside `app/` — Expo Router would treat the
  test file as a route.
- `tests/setup.ts` — global setup: dummy `EXPO_PUBLIC_*` env (so `src/lib/env.ts` doesn't
  throw), official AsyncStorage + safe-area-context mocks.
- `tests/contract/*.contract.test.ts` — live contract tests against **staging** Supabase
  (`npm run test:contract`, own `jest.contract.config.js`, node env, needs
  `.env.staging.local`). Excluded from `npm test`/CI; the setup refuses to run against the
  production project ref.

**Conventions**
- RNTL 14 API is **async**: `await render(...)`, `await fireEvent.press(...)`, `await act(...)`.
- Component tests mock at the **hook seam** (`jest.mock('@/hooks/...')`) and `expo-router`,
  never `supabase` directly — the api/hook layering (see Stack conventions) is what makes
  screens testable. Unit tests for `src/api/*` mock `@/lib/supabase`.
- `jest.mock` factory variables must be prefixed `mock*` (Jest hoisting rule).
- Every fixed audit finding that lives in testable logic gets a regression test named
  after it (e.g. «the F-051 regression»); assert on user-visible Arabic copy, not testIDs,
  so the tests also pin the Arabic-first requirement (no English leakage).
- Prefer wall-clock-sensitive tests under `jest.useFakeTimers()` with an explicit
  `setSystemTime`; always restore real timers.
- Don't chase coverage %: new tests should guard a stated invariant or a fixed finding.

## Conventions
[fill in once decided: naming, file structure, etc. — leave blank for now, Claude Code will propose these]

- After any migration touching RLS/policies/functions, run `node scripts/security-check.mjs`.
