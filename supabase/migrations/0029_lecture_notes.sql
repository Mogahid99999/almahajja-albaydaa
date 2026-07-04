-- =============================================================================
-- 0029_lecture_notes.sql
-- المَحجّة البَيْضَاء — V6 Feature B: ملاحظاتي (one private note per lesson).
--
-- Strictly private: own-rows RLS on every verb, no moderator carve-out, no
-- DEFINER reads — nobody but the author (not even admin queries through
-- PostgREST) can read a note. One editable row per (user, lecture); the client
-- upserts on the PK with a debounced autosave.
--
-- Append-only — 0001–0028 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.lecture_notes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, lecture_id)
);

drop trigger if exists lecture_notes_set_updated_at on public.lecture_notes;
create trigger lecture_notes_set_updated_at
  before update on public.lecture_notes
  for each row execute function public.set_updated_at();

alter table public.lecture_notes enable row level security;

drop policy if exists lecture_notes_own on public.lecture_notes;
create policy lecture_notes_own on public.lecture_notes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.lecture_notes to authenticated;
