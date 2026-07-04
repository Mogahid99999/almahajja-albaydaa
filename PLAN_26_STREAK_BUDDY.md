# Plan: Feature 26.1 (Daily Streak) + 26.2 (Study Buddy)

**Date:** 2026-07-02  
**Target:** Android standalone RELEASE build, device R5CX10P3BPL, USE_MOCK=false

---

## Context: What's Already Built

The app already has a streak system built on:

- **`daily_listening` table** — one row per `(user_id, day)`: `seconds_listened`, `lecture_ids[]`
- **`get_current_streak()` SQL function** (`0004_journey.sql`) — gaps-and-islands over
  `daily_listening`; currently breaks after **1 missed day** (anchor: `last_day >= current_date - 1`)
- **`get_journey_summary()`** — returns `current_streak`, `longest_streak`, `active_days`,
  week progress in one round-trip
- **`recordListening()`** in `src/api/journey.ts` — called from `updateProgress()` with any
  positive `delta` seconds (no minimum threshold today)
- **Weekly goal system** — `weekly_goals` table + `get_week_progress()` SQL, **separate** from
  the daily streak
- **Notifications V3** — 7 enum types, FCM push, quiet 23:00–05:00, per-user prefs column
- **Guest mode** — anonymous Supabase auth, `isGuest` flag, no login gate on browse
- **Last migration:** `0013_weekly_goal_reminders.sql` → next migrations start at `0014`

---

## Feature 26.1 — Daily Streak (نظام المداومة اليومية)

The existing streak infrastructure is reused; the work is:
1. Fix the break rule (1 day → 2 days)
2. Add "meaningful activity" threshold
3. Add recovery mechanism (new)
4. Add home-page streak card (new UI)

### Phase A — Database (migration `0014_daily_streak_recovery.sql`)

**1. Update `get_current_streak()` — tolerate 1-day gap**

Change the gaps-and-islands grouping so that a gap of exactly 1 day between two
activity rows is treated as the same run (i.e., the streak is only broken when 2
or more consecutive days have no activity).

- Group rows into islands where the distance between adjacent rows is ≤ 2 calendar days
- Change the anchor from `last_day >= current_date - 1`
  to `last_day >= current_date - 2`
- `longest_streak` in `get_journey_summary()` must use the same updated grouping

**2. New table `streak_recovery_state`**

```sql
create table public.streak_recovery_state (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  broke_at        date,          -- date the streak broke
  streak_before   int,           -- streak value just before breaking
  recovered_at    timestamptz    -- when recovery was last used (30-day cooldown)
);
-- RLS: own rows only (same pattern as daily_listening_own)
```

**3. New RPC `record_meaningful_activity(p_user_id uuid)`**

Called from JS after a meaningful listening tick. Internally:
1. Upserts `daily_listening` (same as current `recordListening` path)
2. Checks whether the streak would break (gap since last activity ≥ 2 days)
3. If breaking: upserts `streak_recovery_state` with `broke_at = today`,
   `streak_before = old_streak`
4. Recovery detection: if there is a valid recovery in `streak_recovery_state` AND
   today's activity meets the compensatory threshold (see Phase B), retroactively
   inserts a placeholder row in `daily_listening` for the most-recently missed day
   (1 second, no lecture_id), then sets `recovered_at = now()`

**4. New RPC `get_streak_status()`**

Returns a single row:
```
current_streak     int
today_counted      bool   -- daily_listening has a row for today
recovery_available bool   -- broke_at within 3 days AND cooldown not active
recovery_days_left int    -- days remaining in the 3-day window
```

---

### Phase B — Progress Integration (`src/api/progress.ts`)

**Meaningful activity threshold:**

In `updateProgress()`, replace the bare `recordListening()` call with
`record_meaningful_activity()` RPC, but gate it:

```typescript
const meaningful = delta >= 120 || justCompleted;
if (meaningful) {
  await supabase.rpc('record_meaningful_activity', { p_user_id: user.id });
}
```

This means the streak only advances when the student listens ≥ 2 minutes
in a single save-progress tick, or finishes a lecture. Brief accidental taps
do not count.

**Recovery completion check:**

The `record_meaningful_activity` SQL function handles recovery internally. On the
JS side, after the RPC call, invalidate the `queryKeys.streak` query so the
home card re-renders immediately.

---

### Phase C — UI

**New hook `useStreakStatus()` (`src/hooks/useStreak.ts`)**

Wraps `get_streak_status()` RPC via TanStack Query (`queryKeys.streak`).
Disabled for guests.

**New component `StreakCard` (`src/components/home/StreakCard.tsx`)**

Displayed on `app/(student)/index.tsx` between `HomeHeader` and `SectionsGrid`,
for logged-in users only. Four quiet states (no heavy animation):

| State | Arabic display |
|---|---|
| Counted today, streak > 0 | "مداومتك: X أيام · واصلت اليوم، نفعك الله" |
| Not counted yet, streak > 0 | "مداومتك: X أيام · لم تواصل اليوم بعد، ولو بقدر يسير" |
| Recovery available | "لديك فرصة لاستعادة مداومتك · X أيام متبقية" + CTA button |
| streak = 0, no recovery | "ابدأ مداومتك اليوم · ولو بقدر يسير" |

Recovery CTA opens a bottom sheet that explains the compensatory activity required
(2 lessons or 4 minutes of listening today). The sheet is informational only —
no explicit "use recovery" button is needed; the `record_meaningful_activity` SQL
handles it automatically once the threshold is met.

**Journey page additions (`app/(student)/journey.tsx` + `JourneyHomeCard`)**

Add a streak detail block below the weekly-goal ring:
- Current streak days
- "واصلت اليوم ✓" / "لم تواصل بعد" indicator
- Recovery status line if `recovery_available = true`

---

## Feature 26.2 — Study Buddy (رفيق الدراسة)

Entirely new. Gender-segregated, optional, 1 buddy per user, no chat in v1.

### Phase A — Database (migration `0015_study_buddy.sql`)

**Gender field on profiles:**

```sql
alter table public.profiles
  add column if not exists gender text check (gender in ('male', 'female'));
```

**Buddy requests table:**

```sql
create table public.buddy_requests (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  uuid not null references auth.users(id) on delete cascade,
  to_user_id    uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique(from_user_id, to_user_id)
);
```

**RLS on `buddy_requests`:**

| Operation | Policy |
|---|---|
| SELECT | `from_user_id = auth.uid() OR to_user_id = auth.uid()` |
| INSERT | `from_user_id = auth.uid()` (send from yourself only) |
| UPDATE | `to_user_id = auth.uid()` (accept/decline) OR `from_user_id = auth.uid() AND status = 'pending'` (cancel) |

**SQL functions (all `SECURITY DEFINER`, gender filter server-side):**

- `get_my_buddy_id()` — returns the other user's `uuid` if an `accepted` pair exists, else null
- `get_buddy_status()` — returns buddy's `display_name`, `current_streak`, `today_counted`,
  `week_progress_pct`, `weekly_goal_met` (reuses existing streak + week progress logic
  scoped to the buddy's `user_id`)
- `search_buddy_candidates(search_term text)` — profiles where `gender = my_gender` AND
  `id != auth.uid()` AND no active buddy pair with me. Returns `id`, `display_name`,
  `current_streak`. Gender filter is enforced inside the function, not on the client.

---

### Phase B — Registration Screen: Gender Field (`app/(auth)/register.tsx`)

Add a **required** gender selector to the registration form, before the submit button.

**UI pattern:** two tappable pill/card options (not a dropdown):

```
  ┌─────────────┐   ┌─────────────┐
  │    ذكر      │   │    أنثى     │
  └─────────────┘   └─────────────┘
```

- Tapping one selects it (highlighted teal border); the other is unselected
- If the user submits without selecting, show an inline error: "يرجى تحديد الجنس"
- Pass `gender` to the existing `signUp()` / `updateProfile()` call so it is saved
  to `profiles.gender` on registration

**Also update `app/(student)/edit-profile.tsx`:**

- Add the same pill selector, pre-filled with the user's current `gender` value
- Allowed to change gender (no restriction in v1 — user may have mis-selected)
- Update `src/api/auth.ts` `updateProfile()` to accept and write `gender`

---

### Phase C — API + Hooks

**`src/api/buddy.ts`**

```typescript
searchBuddyCandidates(query: string): Promise<BuddyCandidate[]>
sendBuddyRequest(toUserId: string): Promise<void>
respondToRequest(requestId: string, accept: boolean): Promise<void>
cancelBuddy(): Promise<void>
getMyBuddyStatus(): Promise<BuddyStatus | null>
getPendingIncomingRequests(): Promise<BuddyRequest[]>
```

**`src/hooks/useBuddy.ts`**

```typescript
useBuddy()                    // active buddy + status, disabled for guests
usePendingBuddyRequests()     // incoming requests
useBuddySearch(query: string) // debounced candidate list
useSendBuddyRequest()         // mutation
useRespondToRequest()         // mutation
useCancelBuddy()              // mutation
```

---

### Phase D — UI Components

**A. Buddy card on home page** (between `StreakCard` and `SectionsGrid`, logged-in only)

| State | Arabic display |
|---|---|
| No buddy | "يمكنك اختيار رفيق دراسة" + CTA "اختر رفيقاً" |
| Pending outgoing request | "طلبك قيد الانتظار" |
| Pending incoming request | "دعاك [اسم] ليكون رفيقك في طلب العلم" + Accept / Decline |
| Buddy active, both counted today | "أنت ورفيقك واصلتما اليوم، نفعكما الله" |
| Buddy active, buddy counted, you haven't | "رفيقك واصل اليوم، فلعلك تلحق به" |
| Buddy active, you counted, buddy hasn't | "واصلت اليوم، فلعل رفيقك يلحق بك" |
| Buddy active, neither counted | "لم تواصلا بعد · ابدأ أنت أولاً" |

**B. Buddy search screen** (`app/(student)/buddy-search.tsx`)

- Arabic search input with debounce
- Candidate list: display_name + current streak days
- "إرسال دعوة" button → confirmation sheet → `sendBuddyRequest()`
- If the student has no `gender` set on profile, show a prompt to set it in
  edit-profile before allowing search

**C. Buddy comparison block on journey page**

Side-by-side weekly progress (no numeric ranking, encouraging phrases only):

| Comparison result | Phrase |
|---|---|
| Both met goal | "كلاكما أكمل هدفه الأسبوعي، بارك الله فيكما" |
| Buddy met goal, you haven't | "رفيقك أكمل هدفه الأسبوعي، فاستعن بالله وواصل" |
| You met goal, buddy hasn't | "أتممت هدفك الأسبوعي، فاثبت وواصل" |
| Both still going | "كلاكما مستمر، نسأل الله لكما الثبات" |
| Buddy ahead in streak | "رفيقك متقدم بخطوة، فامضِ أنت أيضًا" |
| You ahead in streak | "أنت متقدم بخطوة هذا الأسبوع، فاثبت وواصل" |

---

### Phase E — Notifications (migration `0016_buddy_notif_type.sql`)

- Add `'buddy_activity'` to the notification type enum
- Add `buddy_notifications bool default true` column to `notification_prefs`
- Supabase DB trigger on `user_lecture_progress` (`completed = true`) → calls Edge Function
  or pg_net to push a notification to the buddy:
  - Phrase: "رفيقك أتم درساً اليوم، فلعلك تدرك نصيبك من الأجر"
- Respects existing quiet-hours check (23:00–05:00) and the new `buddy_notifications` pref

---

### Phase F — Settings

In `app/(student)/profile.tsx` (or a dedicated settings screen):

- Toggle: "تنبيهات رفيق الدراسة" (on/off), updates `notification_prefs.buddy_notifications`
- Action: "إلغاء رفيق الدراسة" with a confirmation bottom sheet
  - Phrase in sheet: "هل تريد إنهاء رفقة [اسم]؟ يمكنك اختيار رفيق آخر لاحقًا"
  - On confirm: calls `cancelBuddy()`, invalidates buddy queries

---

## Build Order

```
Step 1   migration 0014  — streak recovery table + updated get_current_streak() + record_meaningful_activity() + get_streak_status()
Step 2   progress.ts     — gate recordListening behind meaningful threshold (≥120s or justCompleted)
Step 3   useStreak.ts    — TanStack Query hook for get_streak_status()
Step 4   StreakCard.tsx   — home page card (4 states, recovery bottom sheet)
Step 5   Journey page    — streak detail block in JourneyHomeCard / journey.tsx
Step 6   migration 0015  — profiles.gender + buddy_requests table + RLS + SQL functions
Step 7   register.tsx    — gender pill selector (required), save to profiles.gender on sign-up
Step 8   edit-profile.tsx — gender pill selector (pre-filled), update via updateProfile()
Step 9   auth.ts         — add gender param to updateProfile()
Step 10  buddy.ts        — full API layer
Step 11  useBuddy.ts     — TanStack Query hooks
Step 12  buddy-search.tsx — new screen (search + send request)
Step 13  Home buddy card — BuddyCard component in (student)/index.tsx
Step 14  Journey buddy   — weekly comparison block
Step 15  migration 0016  — buddy_activity notif type + buddy_notifications pref + DB trigger
Step 16  Settings        — buddy notif toggle + cancel buddy action
```

---
