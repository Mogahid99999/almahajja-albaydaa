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

Paste the contents of `migrations/0001_initial_schema.sql` into the SQL editor
and run it. The migration is idempotent, so it's safe to re-run.

## After applying

1. Put your project URL + anon key in the app's `.env` (see `.env.example`).
2. Create the first admin: sign a user up, then in the SQL editor run
   `update public.profiles set role = 'admin' where id = '<user-uuid>';`
3. Regenerate the typed client whenever the schema changes:

   ```bash
   npx supabase gen types typescript --linked > src/types/database.ts
   ```

## What's in the migration

- **Tables:** `profiles`, `sections` (self-referencing tree), `sheikhs`,
  `lectures`, `user_lecture_progress`.
- **RLS:** students read published content + their own progress; admins read/write
  everything. Role is read from `profiles` via `is_admin()`.
- **RPC functions** (called from `src/api/sections.ts`):
  `get_section_rollup`, `get_children_rollups`, `get_sections_flat` — recursive
  `WITH RECURSIVE` CTEs that aggregate counts/progress across a whole subtree.
- **Storage:** private `lectures` bucket; signed URLs minted per playback.
