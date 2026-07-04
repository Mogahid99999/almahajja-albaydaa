-- =============================================================================
-- 0021_app_config.sql
-- المَحجّة البَيْضَاء — V4 fix (Issue 5): remote "minimum supported version" so
-- the app can prompt for a binary update when a new APK ships.
--
-- A tiny key/value singleton table, world-readable (every install — guest or
-- registered — checks it on launch). The client compares the installed native
-- version against `min_app_version`; if it's lower it shows a calm "حدّث
-- التطبيق" gate linking to `app_download_url` (empty until a download is
-- hosted). Seeded so the gate is INACTIVE now (min == current 1.0.0); an admin
-- bumps `min_app_version` (Management API / dashboard) to force an update later.
--
-- Append-only migration — 0001–0020 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.app_config (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Read-only to everyone signed in (native guests hold an authenticated anon
-- JWT). Writes go through the service role / dashboard only — no write policy.
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config
  for select to authenticated using (true);

grant select on public.app_config to authenticated;

insert into public.app_config (key, value) values
  ('min_app_version', '1.0.0'),
  ('app_download_url', '')
on conflict (key) do nothing;
