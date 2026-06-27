# خطة المرحلة الثانية — المرفقات · الإشعارات · رحلتي العلمية

Implementation plan for the three deferred features, scoped to the **existing**
Expo (SDK 56) + Supabase architecture. Nothing here changes the data-driven section
renderer, the `USE_MOCK` seam, or the calm RTL design. Each feature plugs into the
patterns already in `src/api/*`, `src/hooks/*`, `src/stores/*`, and
`supabase/migrations/*`.

Design stays as-is: teal `#1f4a42`, sand `#f3ecdd`, brass `#c9a463`, Arabic-Indic
numerals, geometric rhombus/motif, no leaderboards, no comparison, no loud
gamification visuals (badges render as quiet brass seals, not trophies).

> **Golden rule (unchanged):** components never touch `supabase` directly — all data
> access goes through `src/api/*`, every function branches on `USE_MOCK`, and the live
> branch throws `NOT_LIVE(...)` until wired. Mock implementations live in `src/mock/api.ts`
> against the in-memory `src/mock/db.ts` dataset.

---

## 0. Conventions carried over (so nothing forces a redesign)

| Pattern | Where it lives now | Phase-2 reuse |
|---|---|---|
| `USE_MOCK` branch per fn | every `src/api/*.ts` | identical for all new APIs |
| UI DTOs decoupled from DB | `src/api/types.ts` | add new DTOs in same file |
| TanStack hooks wrap api | `src/hooks/*` | one hook file per feature |
| Central query keys | `src/constants/queryKeys.ts` | extend, don't inline keys |
| Recursive subtree rollups = SQL | `get_section_rollup`, `get_children_rollups` | reuse for "section followed → new lecture" + journey rollups |
| RLS: own-rows for personal data | `progress_own` policy | copy verbatim for prefs/goals/streak/badges/follows |
| RLS: admin-write content | `*_admin_write` policies | copy for attachments |
| Migrations are idempotent | `0001_initial_schema.sql` header | every new migration follows the same `do $$ … exception when duplicate_object` + `drop policy if exists` style |
| Zustand for device/UI state | `playerStore`, `downloadsStore` | new `notificationsStore` (permission + token), streak fed from player events |

Migrations are **append-only** new files; `0001` is never edited.
`0002` = attachments, `0003` = notifications, `0004` = goals/streak/badges.

---

## 1. Feature A — Attachments system

Any **section node or lecture** can carry attachments of type PDF / كتاب / تفريغ /
صورة / رابط. Students view & download; admins add/remove per node or per lecture.
The renderer seam already exists: a node DTO is
`{title, description, sheikh, lectureCount, progress, subsections[], lectures[], attachments?[]}`
— attachments slot in as one more optional array.

### 1.1 Database — migration `0002_attachments.sql`

```sql
-- enum: attachment kinds
create type public.attachment_type as enum ('pdf','book','transcript','image','link');

-- One table, polymorphic owner enforced by a CHECK: exactly one of
-- (section_id, lecture_id) is non-null. Mirrors how a node OR a lecture owns it.
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  type          public.attachment_type not null,
  title         text not null,
  description   text,
  storage_path  text,        -- path in the new `attachments` bucket (pdf/image/transcript)
  external_url  text,        -- for type='link' and 'book' references
  "order"       integer not null default 0,
  section_id    uuid references public.sections (id) on delete cascade,
  lecture_id    uuid references public.lectures (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint attachment_owner_one check (
    (section_id is not null)::int + (lecture_id is not null)::int = 1
  ),
  constraint attachment_payload check (
    (type = 'link'  and external_url is not null) or
    (type = 'book'  and (external_url is not null or storage_path is not null)) or
    (type in ('pdf','image','transcript') and storage_path is not null)
  )
);

create index attachments_section_idx on public.attachments (section_id, "order");
create index attachments_lecture_idx on public.attachments (lecture_id, "order");

-- updated_at trigger (reuse public.set_updated_at)
create trigger attachments_set_updated_at before update on public.attachments
  for each row execute function public.set_updated_at();
```

**RLS** — students read attachments only when the owner is visible to them; admins do
everything. The visibility rule must respect lecture `status='published'`:

```sql
alter table public.attachments enable row level security;

-- read: section attachments are public to authenticated; lecture attachments only
-- when the parent lecture is published (or caller is admin).
create policy attachments_select on public.attachments
  for select to authenticated using (
    public.is_admin()
    or section_id is not null
    or exists (
      select 1 from public.lectures l
      where l.id = attachments.lecture_id and l.status = 'published'
    )
  );

create policy attachments_admin_write on public.attachments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

**Storage bucket** — new private `attachments` bucket, same policy shape as
`lectures` (any authenticated read so the app can mint signed URLs, admin-only write):

```sql
insert into storage.buckets (id,name,public) values ('attachments','attachments',false)
  on conflict (id) do nothing;
-- attachments_objects_read / attachments_objects_admin_write : copy lectures_objects_* policies
```

> Books (`كتاب`) and links (`رابط`) need no storage object — they store `external_url`.
> PDFs/images/transcripts upload to the bucket and the app mints a signed URL on open
> (same `createSignedUrl` flow as lecture audio).

### 1.2 `src/api` + types

`src/api/types.ts` additions:

```ts
export type AttachmentType = 'pdf' | 'book' | 'transcript' | 'image' | 'link';

export type Attachment = {
  id: string;
  type: AttachmentType;
  title: string;
  description: string | null;
  /** Signed URL (storage) or external_url (link/book). null until resolved. */
  url: string | null;
  order: number;
};
```

Extend the existing DTOs **without touching the renderer**:
- `SectionPageData` gains `attachments: Attachment[]`.
- `LecturePlayback` gains `attachments: Attachment[]`.

New `src/api/attachments.ts`:

```ts
listSectionAttachments(sectionId): Promise<Attachment[]>
listLectureAttachments(lectureId): Promise<Attachment[]>
// admin
createAttachment(input): Promise<Attachment>      // uploads to bucket if file, else stores url
deleteAttachment(id): Promise<void>
reorderAttachments(ownerRef, orderedIds): Promise<void>
```

Each branches on `USE_MOCK`; live branch resolves storage paths → signed URLs in the
api layer (never in components). `getSectionPage` / `getLecturePlayback` live branches
also embed attachments so a section/player loads them in one round-trip.

### 1.3 Hooks + query keys

`queryKeys` additions: `sectionAttachments(id)`, `lectureAttachments(id)`,
`adminAttachments(ownerRef)`.
New `src/hooks/useAttachments.ts`: `useSectionAttachments`, `useLectureAttachments`,
and admin mutations (`useCreateAttachment`, `useDeleteAttachment`) that invalidate the
owning section/lecture keys.

### 1.4 Screens & components

- `src/components/attachments/AttachmentList.tsx` — renders below the lecture list on
  the section page and inside the full player (collapsible "المرفقات" group). Each row:
  type icon (rhombus-framed), title, action.
- `src/components/attachments/AttachmentRow.tsx` — tap behavior by type:
  - pdf/image → open in in-app viewer / `expo-web-browser`
  - transcript → in-app reader screen `app/attachment/[id].tsx`
  - book → show reference text + optional link
  - link → `expo-web-browser`
  - download icon reuses the existing `DownloadButton` pattern (expo-file-system) for
    pdf/image/transcript.
- Admin: `src/components/admin/AttachmentManager.tsx` mounted in the section editor
  (`app/admin/sections.tsx`) and the upload/edit form (`app/admin/upload.tsx`):
  add (type picker + file/url), reorder, delete.

### 1.5 Mock wiring

`src/mock/db.ts`: add an `attachments` array keyed by `sectionId|lectureId`; seed a few
(one PDF, one كتاب, one رابط) so the UI is exercised. `src/mock/api.ts`: implement the
five functions over that array; `getSectionPage`/`getLecturePlayback` mocks attach the
matching rows. No signed URLs in mock — use static sample URLs.

---

## 2. Feature B — Notifications

Push for: (1) new lecture published in a **followed** section, (2) new
quiz/attachment added to a followed section/lecture, (3) resume reminder
("لديك درس لم تكمله"). Android via **expo-notifications + FCM**. Per-student on/off per
type. (Quizzes are still deferred — we ship the `quiz` preference + payload type now so
it lights up later with no migration.)

### 2.1 Database — migration `0003_notifications.sql`

```sql
create type public.notification_type as enum
  ('new_lecture','new_attachment','new_quiz','resume_reminder');

-- A student follows a section (root or nested); follow implies the whole subtree.
create table public.section_follows (
  user_id    uuid not null references auth.users(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, section_id)
);
create index section_follows_section_idx on public.section_follows(section_id);

-- Per-user device push tokens (Expo push token). Multiple devices per user.
create table public.push_tokens (
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null,
  platform   text not null default 'android',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- Per-user, per-type on/off. Absence of a row = default ON.
create table public.notification_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  type    public.notification_type not null,
  enabled boolean not null default true,
  primary key (user_id, type)
);

-- Delivered/queued notifications, so the in-app "الإشعارات" inbox can render history
-- and we can de-dupe. (Resume reminders are scheduled, not stored as content.)
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       public.notification_type not null,
  title      text not null,
  body       text not null,
  data       jsonb not null default '{}',  -- {sectionId|lectureId|attachmentId}
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
```

**RLS** — every one of these is personal: copy the `progress_own` shape
(`using (user_id = auth.uid()) with check (user_id = auth.uid())`) for
`section_follows`, `push_tokens`, `notification_prefs`, and `notifications` (select +
own-write). The **fan-out insert** into other users' `notifications` rows runs in a
`SECURITY DEFINER` function / Edge Function (service role), not from the client.

### 2.2 Server-side fan-out (the part the client cannot do under RLS)

A **Supabase Edge Function** `notify-on-publish` (or a DB trigger calling
`pg_net`/`supabase.functions`) fires when:
- a lecture transitions to `status='published'` (AFTER UPDATE/INSERT trigger on
  `lectures`), or
- an attachment is inserted on a section/lecture.

It resolves the **followers of the section subtree** (reuse the `WITH RECURSIVE
subtree` pattern already in `0001` — walk ancestors of the lecture's section up to any
followed node), filters by each follower's `notification_prefs`, inserts
`notifications` rows, and POSTs to the **Expo Push API** using their `push_tokens`.

```sql
-- helper: who follows a section, counting ancestor follows (subtree semantics)
create function public.followers_of_section(p_section_id uuid)
returns table(user_id uuid) language sql stable security definer ...
-- walk parent chain of p_section_id; return distinct user_ids whose follow row
-- matches any ancestor (or the section itself).
```

Resume reminders are **scheduled locally** on-device (no server needed): when playback
saves an in-progress (not completed) position, schedule a local
`expo-notifications` reminder (e.g. +24h, cancelled if the lecture completes). This
keeps reminders working offline and avoids a cron. Gate it on the `resume_reminder`
pref.

### 2.3 `src/api` + types

`src/api/types.ts`: `NotificationType`, `NotificationItem`, `NotificationPrefs`
(map of type→bool), `FollowState`.

New `src/api/notifications.ts`:

```ts
registerPushToken(token, platform): Promise<void>
getNotificationPrefs(): Promise<NotificationPrefs>
setNotificationPref(type, enabled): Promise<void>
listNotifications(): Promise<NotificationItem[]>
markNotificationRead(id): Promise<void>
markAllRead(): Promise<void>
// follows
isSectionFollowed(sectionId): Promise<boolean>
followSection(sectionId): Promise<void>
unfollowSection(sectionId): Promise<void>
```

### 2.4 Device layer (Zustand + expo-notifications)

New `src/stores/notificationsStore.ts` — permission status + Expo push token +
last-registered flag. App bootstrap (`app/_layout.tsx`):
1. request permission (Android channel `default` with calm settings),
2. get Expo push token, call `registerPushToken`,
3. set notification handler + a response listener that deep-links via Expo Router
   (`data.lectureId` → `/player/[id]`, `data.sectionId` → `/section/[id]`).

`src/lib/notifications.ts` — wraps `expo-notifications`: `ensurePermission`,
`getToken`, `scheduleResumeReminder(lectureId)`, `cancelResumeReminder(lectureId)`.
The resume-reminder scheduling is invoked from the existing
`useSaveProgress` success path (in-progress → schedule, completed → cancel), gated on
the pref.

### 2.5 Hooks + query keys

`queryKeys`: `notifications`, `notificationPrefs`, `sectionFollow(id)`.
`src/hooks/useNotifications.ts`: `useNotifications`, `useUnreadCount` (derived),
`useNotificationPrefs` + `useSetNotificationPref`, `useSectionFollow(id)` +
`useToggleFollow`.

### 2.6 Screens & components

- `app/(student)/notifications.tsx` — "الإشعارات" inbox: list with read/unread dot,
  tap → deep link, "تعليم الكل كمقروء". Calm list, no badges-with-counts noise; a
  single quiet brass dot for unread.
- Notification preferences: a section inside `app/(student)/profile.tsx`
  (`src/components/notifications/PrefsToggles.tsx`) — one switch per type, Arabic
  labels (درس جديد / مرفق جديد / اختبار جديد / تذكير بالمتابعة).
- **Follow button**: `src/components/section/FollowButton.tsx` in the section header
  (`app/(student)/section/[id].tsx`) — "متابعة القسم" / "إيقاف المتابعة", brass outline,
  no counts.
- Home: small unread dot on a bell affordance in the header.

### 2.7 Mock wiring

`src/mock/db.ts`: `follows`, `notificationPrefs`, `notifications` arrays for the demo
user. `src/mock/api.ts`: implement all functions; in mock mode the "fan-out" is faked —
e.g. following a section + an admin publishing in it pushes a local in-app notification
row (no Expo Push, no Edge Function). `src/lib/notifications.ts` no-ops on web and when
`USE_MOCK` and permission denied, so emulator testing never blocks.

---

## 3. Feature C — رحلتي العلمية (weekly goals · مداومة/streak · badges)

Personal only, never compared. Weekly listening goal the student sets (e.g. 3
lectures/week OR 60 min/week). Streak = consecutive days with any listening. Quiet
milestone badges (أكملت ١٠ دروس، استمعت ٣٠ يوماً متتالياً). A "رحلتي العلمية" page shows
the personal journey. No leaderboards, no ranking, no streak-shaming.

### 3.1 Data source: one new event table, everything else is a rollup

The existing `user_lecture_progress` records position+completed but **not when/how much
was listened per day**. Streak and weekly-minute goals need a daily listening signal,
so add a lightweight daily aggregate (not a per-second log):

```sql
-- migration 0004_journey.sql

-- One row per (user, day): minutes listened + whether anything was heard.
-- Fed by the same save-progress path that already runs every ~5s.
create table public.daily_listening (
  user_id        uuid not null references auth.users(id) on delete cascade,
  day            date not null,
  seconds_listened integer not null default 0,
  lectures_touched int  not null default 0,  -- distinct lectures heard that day
  created_at     timestamptz not null default now(),
  primary key (user_id, day)
);
create index daily_listening_user_day_idx on public.daily_listening(user_id, day desc);

-- Weekly goal the student sets. metric = 'lectures' | 'minutes'. One active goal.
create type public.goal_metric as enum ('lectures','minutes');
create table public.weekly_goals (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  metric     public.goal_metric not null default 'lectures',
  target     integer not null default 3,
  updated_at timestamptz not null default now()
);

-- Earned badges (milestones). Definition lives in app code; we store earned instances.
create table public.user_badges (
  user_id    uuid not null references auth.users(id) on delete cascade,
  badge_key  text not null,           -- e.g. 'completed_10', 'streak_30'
  earned_at  timestamptz not null default now(),
  primary key (user_id, badge_key)
);
```

**RLS** — all personal: copy `progress_own` shape for the four tables (select + own
write). `daily_listening` is upserted by the client (own rows) — acceptable since it's
non-competitive and only the user reads it; the increment is small and idempotent per
day.

### 3.2 Streak, weekly progress, badges = SQL rollups (never client tree-walking)

Following the CLAUDE.md rule that rollups are server-side, add RPCs:

```sql
-- Current streak: longest run of consecutive days ending today (or yesterday)
-- with seconds_listened > 0. Done with a gaps-and-islands query over daily_listening.
create function public.get_current_streak() returns integer ...

-- This week's progress toward the active goal (Sat–Fri week, Hijri-friendly later).
create function public.get_week_progress()
  returns table(metric public.goal_metric, target int, current int) ...

-- Journey summary for the page: total completed, total minutes, longest streak,
-- current streak, this-week progress, days-active. One round-trip.
create function public.get_journey_summary()
  returns table(
    completed_lectures bigint, total_seconds bigint,
    current_streak int, longest_streak int,
    active_days int
  ) ...
```

Badge evaluation runs in the api layer after each save: call `get_journey_summary`,
compare against the static badge definitions in `src/constants/badges.ts`, and
`insert ... on conflict do nothing` any newly-earned `user_badges`. (Optionally a DB
trigger on `daily_listening`/`user_lecture_progress`, but app-side keeps badge rules in
TS and out of migrations.)

### 3.3 Feeding `daily_listening` from the existing player

No new player code path — extend the **already-debounced** `saveLectureProgress`:
- mock + live both upsert today's `daily_listening` row, adding the listened delta and
  bumping `lectures_touched` when a new lecture is touched that day.
- The api layer computes the delta from the position change (cap per tick to avoid
  scrub-inflation). This is the single integration point; the player UI is untouched.

### 3.4 `src/api` + types

`src/api/types.ts`: `WeeklyGoal`, `WeekProgress`, `Streak`, `Badge`,
`JourneySummary`.
`src/constants/badges.ts`: static catalog `{ key, titleAr, descAr, threshold, kind }`
(completed-count and streak-day milestones) — quiet brass-seal styling metadata only.

New `src/api/journey.ts`:

```ts
getJourneySummary(): Promise<JourneySummary>   // page header stats
getWeeklyGoal(): Promise<WeeklyGoal>
setWeeklyGoal(metric, target): Promise<void>
getEarnedBadges(): Promise<Badge[]>            // joins user_badges × badges catalog
recordListening(delta): Promise<Badge[]>       // upsert daily, re-eval badges, return newly earned
```

`recordListening` is called from `saveLectureProgress`'s success path; returns
newly-earned badges so the UI can show a calm "نلت وسامًا جديدًا" toast (no confetti).

### 3.5 Hooks + query keys

`queryKeys`: `journey`, `weeklyGoal`, `badges`.
`src/hooks/useJourney.ts`: `useJourneySummary`, `useWeeklyGoal` + `useSetWeeklyGoal`,
`useBadges`. Invalidation: the save-progress mutation also invalidates `journey` +
`badges`.

### 3.6 Screens & components

- `app/(student)/journey.tsx` — "رحلتي العلمية": header with current streak (مداومة) as
  a calm ring, this-week goal progress bar (reuse `ProgressBar`), totals
  (دروس مكتملة / دقائق الاستماع / أيام النشاط), then an earned-badges grid.
  Linked from `profile.tsx` and a small Home card.
- `src/components/journey/StreakRing.tsx` — concentric-rhombus motif, brass fill, no
  fire emoji, no "don't break your streak!" pressure copy. Neutral, encouraging.
- `src/components/journey/GoalCard.tsx` + `GoalEditorSheet.tsx` — set metric
  (دروس/دقائق) + target; weekly progress.
- `src/components/journey/BadgeSeal.tsx` — earned = brass seal, locked = muted outline
  with the threshold hint. Tapping shows the Arabic description.

### 3.7 Mock wiring

`src/mock/db.ts`: `dailyListening`, `weeklyGoal`, `userBadges` for the demo student,
pre-seeded with a believable history (e.g. a 5-day streak, 7 completed) so the page is
populated. `src/mock/api.ts`: implement the journey functions and the streak/week
computations in TS (mirroring the SQL semantics) so behavior matches when the flag
flips.

---

## 4. Cross-cutting: live-mode wiring (`USE_MOCK=false`)

Phase 2 is the natural moment to also wire the **existing** live branches, because the
new features assume a live backend for fan-out. Recommended order within the live cutover:
1. `src/lib/supabase.ts` client + signed-URL helpers (audio + attachments).
2. Live branches for `sections.ts`/`lectures.ts`/`progress.ts` (call the existing
   `0001` RPCs) — proves the seam before layering Phase-2 tables.
3. Then the Phase-2 live branches.

Each `src/api/*` function keeps the `if (USE_MOCK) return mock.…; ` first line and
replaces only the `throw NOT_LIVE(...)` with the real Supabase call. No component or
hook changes when the flag flips.

---

## 5. Build order & dependencies

```
Migrations (serial, append-only):
  0002 attachments → 0003 notifications → 0004 journey
  (independent of each other; numbered for ordering only)

Shared prerequisites (do first):
  P0. queryKeys + api/types.ts additions for all three (tiny, unblocks everyone)
  P0. src/lib/notifications.ts skeleton + notificationsStore (unblocks B)
  P0. extend saveLectureProgress success seam (unblocks B resume-reminder + C daily feed)
```

Dependency graph:

- **A (Attachments)** depends only on P0 + `0002`. Self-contained. Lowest risk — ship
  first; it also exercises the new `attachments` storage bucket needed by nothing else.
- **B (Notifications)** depends on P0 + `0003` + the Edge Function for server fan-out.
  The **in-app inbox, prefs, and follow button** can be built and demoed in mock mode
  **before** the Edge Function exists. The Edge Function + Expo Push + FCM credentials
  are the only live-only piece and can land last.
- **C (Journey)** depends on P0 + `0004` + the `daily_listening` feed from the save
  path. Independent of A and B.

Recommended sequence: **A → C → B** (B's server fan-out + FCM setup is the longest pole;
let it run in parallel from the start but gate its live cutover last).

### What can be built in parallel (file-disjoint, mirrors Phase-1 agent split)

| Track | Owns | Touches shared files |
|---|---|---|
| **Agent 1 — Attachments** | `0002`, `api/attachments.ts`, `hooks/useAttachments.ts`, `components/attachments/*`, `components/admin/AttachmentManager.tsx`, `app/attachment/[id].tsx` | `api/types.ts`, `queryKeys.ts`, `mock/*` (append), section/player screens (mount point only) |
| **Agent 2 — Notifications** | `0003`, Edge Function, `api/notifications.ts`, `hooks/useNotifications.ts`, `stores/notificationsStore.ts`, `lib/notifications.ts`, `app/(student)/notifications.tsx`, `components/notifications/*`, `components/section/FollowButton.tsx` | `api/types.ts`, `queryKeys.ts`, `mock/*`, `app/_layout.tsx` (bootstrap), `profile.tsx` (prefs) |
| **Agent 3 — Journey** | `0004`, `api/journey.ts`, `hooks/useJourney.ts`, `constants/badges.ts`, `app/(student)/journey.tsx`, `components/journey/*` | `api/types.ts`, `queryKeys.ts`, `mock/*`, `api/progress.ts` (save seam — coordinate with B) |

**Shared-file contention** is limited to `api/types.ts`, `queryKeys.ts`, `mock/db.ts`,
`mock/api.ts`, and the `saveLectureProgress` seam. Land P0 (the type/key/seam stubs)
**first and serially**, then the three tracks append to disjoint regions with minimal
conflict — exactly how the Phase-1 screen agents were split.

---

## 6. Definition of done (per feature)

- **A:** Admin adds a PDF + كتاب + رابط on a section and on a lecture; student sees them
  under the section list and in the player; download works for file types; RLS hides
  attachments on draft lectures; mock + live both pass.
- **B:** Student follows a section, toggles each pref; publishing a lecture in a
  followed subtree delivers a push (Android) + inbox row honoring prefs; resume reminder
  fires for an in-progress lecture and cancels on completion; deep links route correctly.
- **C:** Student sets a weekly goal (lectures or minutes); listening updates the week bar
  and streak; completing the 10th lecture / hitting a 30-day streak earns a quiet badge;
  "رحلتي العلمية" shows accurate personal totals — with zero comparison to other students.

All three keep the calm RTL Arabic-first design, Arabic-Indic numerals, and the
`USE_MOCK` seam intact.
