# Plan: V8 — WhatsApp support contact + مختارات (curated picks replacing «أُضيف حديثاً»)

**Date drafted:** 2026-07-04
**Target:** Android standalone RELEASE, device R5CX10P3BPL, `USE_MOCK=false`.
Migrations continue after the latest existing one — **current max is 0036
(gendered buddy wording), so new migrations start at 0037** (confirm at start).

**This plan is fully decided — the implementing agent must NOT ask the user
questions.** Every choice below is locked; proceed autonomously. Keep the calm,
non-competitive Islamic tone; Arabic UI strings stay Arabic. All data-access via
`src/api/*`; cross-user reads/fan-outs are server-side SECURITY DEFINER RPCs.
Append-only migrations — **never edit 0001–0036.**

---

## Feature A — WhatsApp support contact on the login form

A small, low-emphasis line on the sign-in screen: **"هل لديك مشكلة؟ تواصل مع
الدعم الفني للمنصة"** with a WhatsApp glyph, opening an admin-configured
`wa.me` link. Hidden entirely until an admin sets the link (same "empty =
hidden" convention as the About page's Telegram button).

### Data
Reuses the existing `public.app_config` key/value table and the existing
admin-only `set_app_config(key, value)` DEFINER RPC (migration 0021/0023) —
**no new table, no new RPC.** Only a new key:

- **Migration `0037_support_contact.sql`**: seed `('support_whatsapp_url', '')`
  into `app_config` (`on conflict do nothing`, mirrors the 0021/0023 seeds).
  This is the only DB change for this feature.

### Client
- **`src/api/appContent.ts`**: add a `SUPPORT_KEYS = ['support_whatsapp_url']`
  and a new `getSupportContact(): Promise<{ whatsappUrl: string }>` (same
  try/catch-and-fall-back-to-empty shape as `getAboutContent`). Also add
  `'support_whatsapp_url'` to the existing `SETTINGS_KEYS` array so the admin
  Settings fetch (`getAppConfigForAdmin`) picks it up.
- **`src/hooks/useAppContent.ts`**: add `useSupportContact()` (plain
  `useQuery`, same shape as `useAboutContent`).
- **`src/constants/queryKeys.ts`**: add `supportContact: ['appContent',
  'support'] as const`.
- **`app/(auth)/sign-in.tsx`**: at the very bottom of the screen (after the
  demo-accounts card), when `whatsappUrl` is non-empty, render a small centered
  row: a WhatsApp glyph + the line above, `onPress` →
  `Linking.openURL(whatsappUrl)` (import `Linking` from `react-native`, same as
  `about.tsx`). Muted styling (`colors.textMuted` / a brass-tinted icon),
  clearly secondary to the sign-in form — this is a help affordance, not a CTA.
  **Icon**: this app deliberately uses only `Feather` icons everywhere, but
  Feather has no WhatsApp glyph — use `FontAwesome` (also bundled in
  `@expo/vector-icons`, no new dependency) with `name="whatsapp"` as the one
  deliberate exception, since the user explicitly wants a recognizable
  WhatsApp mark.
- **`app/admin/settings.tsx`**: this screen already renders a declarative
  array of `{ key, label, multiline?, fallback?, placeholder? }` config fields
  (see the existing `telegram_url` entry). Add one more entry:
  `{ key: 'support_whatsapp_url', label: 'رابط الدعم عبر واتساب (يُخفى الزر
  إن تُرك فارغًا)', placeholder: 'https://wa.me/9665XXXXXXXX' }`. No new RPC,
  no new mutation hook — it rides the existing `useSetAppConfig()`.

### Known accepted edge
`app_config`'s RLS is `for select to authenticated` (0021) — a native guest
always has a silent anon session (authenticated role) so the link resolves
fine there; on **web** (the admin dashboard), a genuinely logged-out visitor
has no session at all, so the query returns nothing and the line just doesn't
render. This is pre-existing behavior shared with `min_app_version` /
`telegram_url` — do **not** loosen RLS to "fix" it; it's a non-issue since
web's `/sign-in` is the admin/staff/sheikh login, not a public visitor page.

---

## Feature B — مختارات (curated picks), replacing «أُضيف حديثاً»

Home's "newly added" rail (auto-sorted by `created_at`) is **replaced** by an
admin/publisher-curated list: staff hand-pick existing **published** lectures
from anywhere on the platform and add them to an ordered "مختارات" list, which
renders in the exact same Home slot. Editable (reorder) and removable from a
new admin screen. This is a replacement, not an addition — the old rail and
its route are renamed/repurposed, not kept alongside.

### Data (migration `0038_featured_lectures.sql`)
- **`public.featured_lectures`**: `id uuid pk default gen_random_uuid(),
  lecture_id uuid not null unique references public.lectures(id) on delete
  cascade, "order" integer not null default 0, added_by uuid references
  auth.users(id) on delete set null, created_at timestamptz not null default
  now()`. RLS: `for select to authenticated using (true)` (world-readable, like
  `sections`/`lectures`) — **all writes go through DEFINER RPCs**, never a raw
  table write from the client.
- **`get_featured_lectures()`** — `language sql stable security invoker`,
  `set search_path = public`. Joins `featured_lectures` → `lectures` (+
  `sheikhs`, `sections`) **filtered to `status = 'published'`**, ordered by
  `"order"` asc, and folds in the CALLING user's own
  `user_lecture_progress` (`position_sec`, `completed`) via a left join on
  `auth.uid()` — INVOKER means `auth.uid()` always resolves to the caller, so
  one function serves both the Home rail (ignores position/completed) and the
  full-list screen (uses them), exactly like `get_journey_summary` /
  `get_streak_status` already do. Returns: `lecture_id, title, duration_sec,
  sheikh_name, section_title, "order", position_sec, completed`.
- **`get_featured_lectures_admin()`** — `language plpgsql security definer`,
  gated on `is_content_manager()` (raises if not). Same join, **no status
  filter** (so staff can see/manage an entry even if its lecture was since
  unpublished — it just silently drops out of the public rail per the filter
  above, same "stay silent" precedent as 0007's unpublished-attachment rule).
  Returns: `lecture_id, title, status, duration_sec, sheikh_name,
  section_title, "order"`.
- **`add_featured_lecture(p_lecture_id uuid)`** — DEFINER, `is_content_manager`
  gate; appends at `max("order")+1`; `on conflict (lecture_id) do nothing`
  (idempotent — a lecture can only be featured once).
- **`remove_featured_lecture(p_lecture_id uuid)`** — DEFINER, same gate;
  deletes the row.
- **`reorder_featured_lectures(p_lecture_ids uuid[])`** — DEFINER, same gate;
  walks the array and sets `"order"` = array position for each id. The admin
  screen's ▲/▼ buttons swap two entries in the **client-held** ordered list
  and call this with the whole new id order — simplest correct approach, no
  swap-specific RPC needed.

### Client — rename/repurpose (touches these exact files)
- **`src/api/types.ts`**: rename `HomeData.newlyAdded` → `HomeData.featured`
  (same `LectureCard[]` shape — no new type needed for the Home rail). Add
  `AdminFeaturedRow = { lectureId: string; title: string; status:
  AppLectureStatus; sectionTitle: string | null; sheikhName: string | null;
  durationSec: number; order: number }` for the admin list.
- **`src/api/sections.ts`** (`getHomeData`): replace the current "newRows"
  direct `lectures` query with `supabase.rpc('get_featured_lectures')`, map
  into `LectureCard[]` (`coverLetter` from the section title's first letter,
  same as today), assign to `featured`.
- **`src/api/lectures.ts`**: rename `getRecentLectures` →
  `getFeaturedLectures()`, backed by the same `get_featured_lectures` RPC,
  mapping `position_sec`/`completed` into the existing `LectureRow` status
  logic (`completed` → `'completed'`, else `position_sec > 0` →
  `'in_progress'`, else `'new'`) — same shape `LectureRow[]` as before, just a
  different source query. Drop the now-unused `limit` param (a curated list
  has no natural "more" — the whole set is returned).
- **`src/hooks/useLecture.ts`**: rename `useRecentLectures` →
  `useFeaturedLectures`, calling `getFeaturedLectures()`.
- **`src/constants/queryKeys.ts`**: rename `recentLectures` →
  `featuredLectures: ['lectures', 'featured'] as const`; add
  `adminFeatured: ['admin', 'featured'] as const`.
- **`src/mock/api.ts`**: rename the mock's `newlyAdded` field → `featured` in
  its `getHomeData` mock, and rename/keep its recent-lectures mock as
  `getFeaturedLectures` so `USE_MOCK` stays functional.
- **`src/components/home/NewlyAddedRail.tsx` → rename file+component to
  `src/components/home/FeaturedRail.tsx`** (`export function FeaturedRail`):
  same rail/card visuals, title copy → **"مختارات"** (drop the "newly added"
  framing entirely — this is an editorial pick, not date-based), `onAction`
  still routes to the full-list screen (see below). Renders nothing when the
  list is empty (same as today).
- **`app/(student)/index.tsx`**: swap the import/usage to `<FeaturedRail
  lectures={data?.featured ?? []} />`.
- **`app/(student)/recent.tsx` → rename file to `app/(student)/featured.tsx`**
  (Expo Router file-based routing — this removes `/recent` and adds
  `/featured`; nothing else in the app links to `/recent`, confirmed). Heading
  → **"المختارات"**, backed by `useFeaturedLectures()`. Empty-state copy: adapt
  "لا توجد دروس بعد" → something like "لا مختارات بعد" (exact wording is the
  implementing agent's judgment call, keep it calm).

### Client — new admin surface
- **`src/api/featured.ts`** (new) — mirrors `src/api/broadcasts.ts`'s shape:
  `listAdminFeatured()` (calls `get_featured_lectures_admin`),
  `addFeaturedLecture(lectureId)`, `removeFeaturedLecture(lectureId)`,
  `reorderFeaturedLectures(lectureIds: string[])`.
- **`src/hooks/useFeatured.ts`** (new) — mirrors `src/hooks/useBroadcasts.ts`:
  `useAdminFeatured()`, `useAddFeatured()`, `useRemoveFeatured()`,
  `useReorderFeatured()`, all invalidating `queryKeys.adminFeatured` (and the
  student-facing `home`/`featuredLectures` keys too, so a change is visible
  immediately without an app restart).
- **`src/components/admin/LecturePicker.tsx`** (new) — a searchable overlay
  picker for "add a lecture", modeled directly on
  `src/components/admin/TreePicker.tsx`'s UX (trigger field → modal → search
  input → scrollable rows), but sourced from the **existing**
  `useAdminLectures()` hook (already is_content_manager-aware via the
  `lectures` table's RLS — no new query needed for search). Filter candidates
  client-side to `status === 'published'` AND not already in the current
  featured id set (passed in as a prop). Selecting a row calls the picker's
  `onSelect(lectureId)` and closes.
- **`app/admin/featured.tsx`** (new) — «المختارات» screen: a "إضافة محاضرة"
  trigger opens `LecturePicker`; selecting a lecture calls `useAddFeatured()`.
  Below, the current ordered list (reused row look from `sheikhs.tsx`'s list
  pattern): title, section, sheikh, with **▲/▼** buttons (disabled at the
  ends) that reorder the client-held array and call `useReorderFeatured()`,
  and a remove (trash) icon → `ConfirmDialog` → `useRemoveFeatured()`.
  "التعديل" for a featured entry means **reordering only** — there is no
  separate title/body to edit (it just points at an existing lecture; editing
  the lecture's own content happens in its normal admin editor, unrelated to
  this screen). Make this explicit in the UI copy so it's not confused with
  the broadcasts editor pattern.
- **`src/components/admin/AdminShell.tsx`**: add a `NavKey` `'featured'` →
  `{ key: 'featured', label: 'المختارات', href: '/admin/featured', icon:
  'bookmark' }` (not `adminOnly` — visible to admin **and** publisher, same as
  `reminders`/`quizzes`). Pick `'bookmark'` specifically so it doesn't visually
  duplicate the reminders nav item's `'star'`.

---

## Build order

```
Step 0   (No AskUserQuestion — decisions are locked.)
Step 1   Confirm live migration max (expect 0036) → new migrations start at 0037.
Step 2   DB (0037): seed support_whatsapp_url in app_config → apply live.
Step 3   DB (0038): featured_lectures table + RLS + get_featured_lectures()
             + get_featured_lectures_admin() + add/remove/reorder RPCs → apply
             live; regen src/types/database.generated.ts.
Step 4   Feature A client: appContent.ts + useAppContent.ts + queryKeys +
             sign-in.tsx (WhatsApp line, hidden if empty) + admin/settings.tsx
             (new field).
Step 5   Feature B renames: types.ts (HomeData.featured), sections.ts
             (getHomeData → RPC), lectures.ts (getFeaturedLectures), useLecture.ts,
             queryKeys.ts, mock/api.ts.
Step 6   Feature B rail: NewlyAddedRail.tsx → FeaturedRail.tsx (copy: مختارات),
             (student)/index.tsx, recent.tsx → featured.tsx.
Step 7   Feature B admin: api/featured.ts, hooks/useFeatured.ts,
             components/admin/LecturePicker.tsx, admin/featured.tsx,
             AdminShell.tsx nav item.
Step 8   typecheck → release build → install on R5CX10P3BPL.
Step 9   Device-verify: sign-in WhatsApp line hidden by default → set a URL
             in admin Settings → line appears → tap opens WhatsApp/browser.
             Admin مختارات: add 2–3 published lectures → Home rail shows them
             titled «مختارات» in that order → reorder via ▲/▼ → Home reflects
             the new order → remove one → Home updates. Confirm the OLD
             «أُضيف حديثاً» rail and /recent route are gone, not just hidden.
```

## Rules (same as every prior batch)
- All data-access via `src/api/*`; components never call `supabase` directly.
- Cross-cutting reads/writes that touch other users' or shared editorial data
  go through DEFINER RPCs gated on `is_content_manager()` for staff writes.
- RTL throughout; calm Islamic tone; no code comments unless the WHY is
  non-obvious.
- Migrations are APPEND-ONLY; never edit 0001–0036. New migrations start at
  0037. No new enum values in this batch, so no multi-step transaction
  ordering concern this time.
- To apply migrations live: project ref `prpyxnxgkpspjoxvcaro`; POST SQL to
  `POST /v1/projects/{ref}/database/query` with the user's access token; regen
  types via `GET /v1/projects/{ref}/types/typescript` into
  `src/types/database.generated.ts`. Ask for the token if not supplied.
- To build+install: `$env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10"`,
  prepend node to PATH (`$env:PATH = "C:\Program Files\nodejs;" + $env:PATH`),
  then `android\gradlew.bat -p android :app:assembleRelease`, then install:
  `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL
  install -r android\app\build\outputs\apk\release\app-release.apk`.
- Package id: `com.riwaqalilm.app` · scheme: `riwaqalilm`. Demo admin:
  `admin@gmail.com` / `test55%%`. Device screenshots: `adb ... shell screencap
  -p /sdcard/x.png` then `adb ... pull` (never pipe through PowerShell — it
  corrupts the PNG).

Do NOT touch `app_config.min_app_version` or weaken any existing RLS policy.
