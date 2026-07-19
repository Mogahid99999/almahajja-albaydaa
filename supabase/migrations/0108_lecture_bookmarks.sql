-- =============================================================================
-- 0108 · «للمراجعة لاحقًا» — lecture bookmarks (V20 · §4)
--
-- A student marks a specific minute inside a lesson to return to later, with an
-- optional short note. Bookmarks are personal, sync across the student's devices,
-- survive removing the lecture from downloads, and can be added offline (queued
-- via the outbox, replayed here). Reviewing a mark never disturbs the lesson's
-- own resume position — the client seeks with the existing `?t=` deep-link, which
-- is guarded against rewinding progress.
--
--   * lecture_bookmarks(user_id, lecture_id, position_sec, note, status, …)
--   * add_bookmark(...) — insert with a few-seconds dedup window (§4: "يمنع إنشاء
--     علامات متكررة في التوقيت نفسه خلال ثوانٍ قليلة"), returns the row id.
--   * set_bookmark_status / update_bookmark_note / delete_bookmark — management.
--
-- All security invoker; own-rows RLS gates every path. Append-only, idempotent.
-- =============================================================================

create table if not exists public.lecture_bookmarks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  lecture_id   uuid not null references public.lectures (id) on delete cascade,
  position_sec integer not null check (position_sec >= 0),
  note         text,
  status       text not null default 'pending' check (status in ('pending', 'reviewed')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);

create index if not exists lecture_bookmarks_user_status_idx
  on public.lecture_bookmarks (user_id, status, created_at desc);

alter table public.lecture_bookmarks enable row level security;

drop policy if exists lecture_bookmarks_own on public.lecture_bookmarks;
create policy lecture_bookmarks_own on public.lecture_bookmarks
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.lecture_bookmarks to authenticated;

-- --- add (with a few-seconds dedup window) -----------------------------------
-- Returns the existing id when a bookmark for the same lecture already sits
-- within `p_window_sec` of `p_position_sec` (default 8s) — so a double-tap or an
-- offline replay of the same mark doesn't create duplicates. Otherwise inserts.
create or replace function public.add_bookmark(
  p_lecture_id   uuid,
  p_position_sec integer,
  p_note         text default null,
  p_window_sec   integer default 8
)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id  uuid;
  v_pos integer := greatest(0, coalesce(p_position_sec, 0));
begin
  select id into v_id
    from public.lecture_bookmarks
   where user_id = auth.uid()
     and lecture_id = p_lecture_id
     and abs(position_sec - v_pos) <= greatest(0, coalesce(p_window_sec, 8))
   order by created_at desc
   limit 1;
  if v_id is not null then
    return v_id; -- dedup: an equivalent mark already exists
  end if;

  insert into public.lecture_bookmarks (user_id, lecture_id, position_sec, note)
    values (auth.uid(), p_lecture_id, v_pos, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.add_bookmark(uuid, integer, text, integer) to authenticated;

-- --- set status (pending ⇄ reviewed) -----------------------------------------
create or replace function public.set_bookmark_status(p_id uuid, p_reviewed boolean)
returns void
language sql security invoker set search_path = public as $$
  update public.lecture_bookmarks
     set status      = case when p_reviewed then 'reviewed' else 'pending' end,
         reviewed_at = case when p_reviewed then now() else null end
   where id = p_id and user_id = auth.uid();
$$;

grant execute on function public.set_bookmark_status(uuid, boolean) to authenticated;

-- --- update note -------------------------------------------------------------
create or replace function public.update_bookmark_note(p_id uuid, p_note text)
returns void
language sql security invoker set search_path = public as $$
  update public.lecture_bookmarks
     set note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and user_id = auth.uid();
$$;

grant execute on function public.update_bookmark_note(uuid, text) to authenticated;

-- --- list (with lecture + section context for the review page) ---------------
-- Own rows only via RLS; joins the lesson title + immediate section title so the
-- review screen shows «القسم · السلسلة · الدرس» without extra round-trips.
create or replace function public.get_bookmarks()
returns table (
  id            uuid,
  lecture_id    uuid,
  lecture_title text,
  section_id    uuid,
  section_title text,
  position_sec  integer,
  note          text,
  status        text,
  created_at    timestamptz
)
language sql stable security invoker set search_path = public as $$
  select b.id, b.lecture_id, l.title, l.section_id, s.title,
         b.position_sec, b.note, b.status, b.created_at
    from public.lecture_bookmarks b
    join public.lectures l on l.id = b.lecture_id
    left join public.sections s on s.id = l.section_id
   where b.user_id = auth.uid()
   order by b.created_at desc;
$$;

grant execute on function public.get_bookmarks() to authenticated;

-- --- security hygiene: keep these authenticated-only (revoke the implicit PUBLIC
--     grant Postgres adds to a new function; matches every other RPC here) -----
revoke execute on function public.add_bookmark(uuid, integer, text, integer) from public, anon;
revoke execute on function public.set_bookmark_status(uuid, boolean)          from public, anon;
revoke execute on function public.update_bookmark_note(uuid, text)            from public, anon;
revoke execute on function public.get_bookmarks()                             from public, anon;
