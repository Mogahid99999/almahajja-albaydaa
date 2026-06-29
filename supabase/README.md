# Supabase

Database schema, RLS, recursive-rollup functions, and the `lectures` storage
bucket for منصة دروس العلم الشرعي.

## Apply the schema

**Option A — Supabase CLI (recommended)**

```bash
# one-time: link to your project
npx supabase link --project-ref <your-project-ref>
# apply all migrations
npx supabase db push
```

**Option B — Dashboard SQL editor**

Paste each file in `migrations/` (in number order, `0001` → `0006`) into the SQL
editor and run it. Every migration is idempotent, so re-running is safe.

## After applying

1. Put your project URL + anon key in the app's `.env` (see `.env.example`).
2. Create the first admin: sign a user up, then in the SQL editor run
   `update public.profiles set role = 'admin' where id = '<user-uuid>';`
3. Regenerate the typed client whenever the schema changes:

   ```bash
   npx supabase gen types typescript --linked > src/types/database.ts
   ```

## What's in the migrations

- **0001 — core:** `profiles`, `sections` (self-referencing tree), `sheikhs`,
  `lectures`, `user_lecture_progress`; RLS (students read published + own,
  admins all, via `is_admin()`); recursive rollup RPCs
  (`get_section_rollup`, `get_children_rollups`, `get_sections_flat`).
- **0002 — attachments:** polymorphic `attachments` (section OR lecture).
- **0003 — notifications:** `section_follows`, `push_tokens`,
  `notification_prefs`, `notifications` (all own-rows RLS).
- **0004 — رحلتي العلمية:** `daily_listening`, `weekly_goals`, `user_badges`;
  streak / week-progress / journey-summary RPCs.
- **0005 — live cutover:** storage buckets + Phase-2 table grants.
- **0006 — notification fan-out:** `followers_of_section` (subtree walk) +
  triggers that insert inbox rows when a lecture is published / an attachment is
  added in a followed subtree. Device push delivery is the
  `notify-on-publish` Edge Function — see
  `functions/notify-on-publish/README.md`.
- **Storage:** private `lectures` + `attachments` buckets; signed URLs per open.
