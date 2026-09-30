-- =============================================================================
-- 0147_live_comments.sql
-- المَحجّة البَيْضَاء — V23: «التعليقات والأسئلة أثناء البث» — comments and
-- questions written during a live «مجلس».
--
-- Owner decisions (final, 2026-09-30):
--   * Everyone present in the room sees the comments list (listeners too), live.
--   * Guests (anonymous auth sessions) cannot comment → guest_cannot_comment.
--   * Names: a brother comments with his name or «بدون اسم». A sister who joined
--     WITHOUT her name (live_participants.hidden_name) is ALWAYS nameless (forced
--     here). A sister who joined WITH her name may post named or nameless.
--   * «بدون اسم» is hidden from EVERYONE — sheikh and admins included. Enforced
--     in SQL: a nameless row never even stores a name (check constraint), and no
--     function below ever returns user_id, nor a name for a nameless comment.
--     user_id is kept only for the rate limit, own-delete and the per-session
--     block — deleting and blocking work WITHOUT revealing the author.
--   * Comments are kept after the majlis (staff read them in the admin panel).
--
-- Objects
--   table live_comments          RLS on, NO client grants (service role only)
--   table live_comment_blocks    per-session «منع من التعليق» list, service role only
--   live_moderation_log.action   + comment_delete / comment_answered / comment_block
--   Internal (no grants): live_comment_json(row, viewer, mine, deleted) — THE
--     public shape; live_comment_is_moderator(session, user).
--   Client RPCs (authenticated):
--     get_live_comments(session)   staff (content manager or sheikh): any
--                                  session; anyone else: a participant of that
--                                  session (live_participants row, guests
--                                  included) while it is green|live.
--                                  → jsonb array, oldest first, not deleted,
--                                  the 500 newest, each + mine.
--     admin_live_comments(session) staff only → every comment incl. deleted
--                                  (+ deleted, + mine), oldest first, ≤ 5000 newest.
--   Service-role RPCs (the live-control edge function):
--     live_post_comment(session, user, kind, body, anonymous) → public comment
--     live_delete_comment(session, comment, actor)          → {id, by, already}
--     live_answer_comment(session, comment, actor, answered)→ {id, answered}
--     live_block_comment_author(session, comment, actor)    → {id}
--   Refusals are raised as 'live_comment:<code>' (the edge function maps
--   <code> to its HTTP error: liveRules.ts commentRpcErrorCode):
--     not_found · not_live · guest_cannot_comment · not_present · blocked ·
--     empty · too_long · blocked_words · rate_limited · forbidden ·
--     invalid_target · bad_request
--
-- Public comment shape (camelCase, what every read returns and what live-control
-- broadcasts on the LiveKit data topic "comments"):
--   { id, kind: 'comment'|'question', text, name: string|null (null = nameless),
--     gender: 'm'|'f', answered: boolean, at: 'YYYY-MM-DDTHH:MM:SS.mmmZ' (UTC) }
--   reads add mine: boolean (the caller wrote it); admin_live_comments adds
--   deleted: boolean. Never user_id; never identity.
--
-- Moderators of a session's comments (live_comment_is_moderator): its host
-- (live_sessions.host_user_id, or live_participants.role 'host'), its moderators
-- (live_participants.role 'moderator' — staff who joined), or any content
-- manager (admin/publisher, joined or not). Never a guest.
--
-- Known caveat (same as «مساحة الأسئلة» anonymous questions): the admin's full
-- backup export (export_table, 0102/0124 — every public table verbatim, for
-- disaster recovery) includes live_comments.user_id. No app read returns it.
--
-- Requires 0134, 0135, 0146 (log check list), 0052 (contains_blocked_word).
-- Append-only (0001–0146 are never edited). Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Tables -------------------------------------------------------------------------
create table if not exists public.live_comments (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.live_sessions (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('comment', 'question')),
  body         text not null check (char_length(btrim(body)) between 1 and 300),
  show_name    boolean not null,
  -- Snapshot of the name the room showed at post time — ONLY when show_name.
  display_name text,
  gender       text not null check (gender in ('m', 'f')),
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users (id) on delete set null,
  answered_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- A nameless comment never stores a name (nothing to leak, ever).
  constraint live_comments_name_only_when_shown check (
    (show_name and display_name is not null and char_length(display_name) between 1 and 120)
    or (not show_name and display_name is null))
);

comment on table public.live_comments is
  'V23 «التعليقات والأسئلة أثناء البث». Service role only (live-control); clients read get_live_comments / admin_live_comments, which never return user_id nor a nameless author''s name.';

create index if not exists live_comments_session_idx
  on public.live_comments (session_id, created_at);
-- Rate limit (1 / 10 s per user per session) + own-comment lookups.
create index if not exists live_comments_author_idx
  on public.live_comments (session_id, user_id, created_at desc);
create index if not exists live_comments_user_idx
  on public.live_comments (user_id);

alter table public.live_comments enable row level security;
revoke all on table public.live_comments from public, anon, authenticated;
grant select, insert, update, delete on table public.live_comments to service_role;
-- (no policies: service role only)

create table if not exists public.live_comment_blocks (
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  blocked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

comment on table public.live_comment_blocks is
  'V23: authors a moderator blocked from commenting in one live session (live-control comment_block). Service role only; never exposed.';

create index if not exists live_comment_blocks_user_idx
  on public.live_comment_blocks (user_id);

alter table public.live_comment_blocks enable row level security;
revoke all on table public.live_comment_blocks from public, anon, authenticated;
grant select, insert, update, delete on table public.live_comment_blocks to service_role;

-- 2. Moderation log: the three staff comment actions --------------------------------
-- (0146's list + comment_delete / comment_answered / comment_block. The author
-- deleting his own comment is not logged; `detail` never names a nameless author.)
alter table public.live_moderation_log
  drop constraint if exists live_moderation_log_action_check;
alter table public.live_moderation_log
  add constraint live_moderation_log_action_check check (action in (
    'open_green', 'start', 'end', 'cancel', 'approve', 'reject',
    'mute', 'demote', 'step_down', 'set_allow_requests', 'host_leave',
    'auto_end', 'resume_recording',
    'comment_delete', 'comment_answered', 'comment_block'));

-- 3. Internal helpers -----------------------------------------------------------------

-- THE public shape of one comment. The only place a row becomes JSON: user_id
-- never, the name only when show_name (and the row can't hold one otherwise).
create or replace function public.live_comment_json(
  c              public.live_comments,
  p_viewer       uuid,
  p_with_mine    boolean default false,
  p_with_deleted boolean default false
)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
           'id',       c.id,
           'kind',     c.kind,
           'text',     c.body,
           'name',     case when c.show_name then c.display_name end,
           'gender',   c.gender,
           'answered', c.answered_at is not null,
           -- The ES date-time format exactly (UTC, milliseconds, 'Z'): parses
           -- everywhere, Hermes included (jsonb's default has 6 fraction digits).
           'at',       to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      || case when p_with_mine
              then jsonb_build_object('mine', coalesce(p_viewer is not null and c.user_id = p_viewer, false))
              else '{}'::jsonb end
      || case when p_with_deleted
              then jsonb_build_object('deleted', c.deleted_at is not null)
              else '{}'::jsonb end;
$$;
revoke all on function public.live_comment_json(public.live_comments, uuid, boolean, boolean)
  from public, anon, authenticated;

-- Who moderates a session's comments: host, the session's moderators, content
-- managers. Never a guest (read fresh from auth.users, like is_guest(), 0125).
create or replace function public.live_comment_is_moderator(p_session uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null
     and not coalesce((select u.is_anonymous from auth.users u where u.id = p_user), true)
     and (
          exists (select 1 from public.live_sessions s
                   where s.id = p_session and s.host_user_id = p_user)
       or exists (select 1 from public.live_participants lp
                   where lp.session_id = p_session and lp.user_id = p_user
                     and lp.role in ('host', 'moderator'))
       or exists (select 1 from public.profiles p
                   where p.id = p_user and p.role in ('admin', 'publisher')));
$$;
revoke all on function public.live_comment_is_moderator(uuid, uuid) from public, anon, authenticated;

-- 4. Service-role RPCs (live-control) ---------------------------------------------------

-- live_post_comment — checks in this order: kind, session (not_found), live
-- (not_live — green too), guest (guest_cannot_comment), participant present
-- (not_present), block list (blocked), text (empty / too_long / blocked_words),
-- rate limit 1 per 10 s per user per session (rate_limited; the participant row
-- is locked first, so two concurrent posts serialise and the second one loses).
-- p_anonymous null counts as nameless. A sister who joined with hidden_name is
-- always nameless. The name snapshot is the one the room shows (the participant's
-- display_name, whitespace-collapsed, ≤ 60 chars; «طالب/طالبة», «مشرف/مشرفة» when empty).
-- Returns the public comment (no `mine` — live-control adds mine:true for the author).
create or replace function public.live_post_comment(
  p_session   uuid,
  p_user      uuid,
  p_kind      text,
  p_body      text,
  p_anonymous boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_body   text := btrim(coalesce(p_body, ''));
  v_status public.live_status;
  p        public.live_participants%rowtype;
  v_show   boolean;
  v_name   text;
  c        public.live_comments%rowtype;
begin
  if p_user is null then
    raise exception 'live_comment:forbidden';
  end if;
  if p_kind is null or p_kind not in ('comment', 'question') then
    raise exception 'live_comment:bad_request';
  end if;

  select s.status into v_status from public.live_sessions s where s.id = p_session;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  if v_status <> 'live' then
    raise exception 'live_comment:not_live';
  end if;

  if coalesce((select u.is_anonymous from auth.users u where u.id = p_user), true) then
    raise exception 'live_comment:guest_cannot_comment';
  end if;

  select * into p
    from public.live_participants lp
   where lp.session_id = p_session and lp.user_id = p_user
     for update;
  if not found or not (p.present or p.left_at is null) then
    raise exception 'live_comment:not_present';
  end if;

  if exists (select 1 from public.live_comment_blocks b
              where b.session_id = p_session and b.user_id = p_user) then
    raise exception 'live_comment:blocked';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'live_comment:empty';
  end if;
  if char_length(v_body) > 300 then
    raise exception 'live_comment:too_long';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'live_comment:blocked_words';
  end if;

  if exists (select 1 from public.live_comments x
              where x.session_id = p_session and x.user_id = p_user
                and x.created_at > now() - interval '10 seconds') then
    raise exception 'live_comment:rate_limited';
  end if;

  v_show := not coalesce(p_anonymous, true)
            and not (p.gender = 'f' and p.hidden_name);
  if v_show then
    v_name := left(nullif(btrim(regexp_replace(coalesce(p.display_name, ''), '\s+', ' ', 'g')), ''), 60);
    if v_name is null then
      v_name := case
                  when p.role in ('host', 'moderator') then
                    case p.gender when 'f' then 'مشرفة' else 'مشرف' end
                  else
                    case p.gender when 'f' then 'طالبة' else 'طالب' end
                end;
    end if;
  end if;

  insert into public.live_comments (session_id, user_id, kind, body, show_name, display_name, gender)
  values (p_session, p_user, p_kind, v_body, v_show, case when v_show then v_name end, p.gender)
  returning * into c;

  return public.live_comment_json(c, null, false, false);
end;
$$;
revoke all on function public.live_post_comment(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.live_post_comment(uuid, uuid, text, text, boolean)
  to service_role;

-- live_delete_comment — soft delete by its author OR a moderator (any session
-- status: staff may clean up after the majlis too). Idempotent (already deleted
-- → ok, already:true). `by` = 'author' | 'moderator' (live-control logs only
-- the moderator's). Never returns who the author is.
create or replace function public.live_delete_comment(
  p_session uuid,
  p_comment uuid,
  p_actor   uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c    public.live_comments%rowtype;
  v_by text;
begin
  if p_actor is null then
    raise exception 'live_comment:forbidden';
  end if;
  select * into c from public.live_comments x
   where x.id = p_comment and x.session_id = p_session
     for update;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  if c.user_id = p_actor
     and not coalesce((select u.is_anonymous from auth.users u where u.id = p_actor), true) then
    v_by := 'author';
  elsif public.live_comment_is_moderator(p_session, p_actor) then
    v_by := 'moderator';
  else
    raise exception 'live_comment:forbidden';
  end if;

  if c.deleted_at is null then
    update public.live_comments
       set deleted_at = now(), deleted_by = p_actor
     where id = c.id;
  end if;
  return jsonb_build_object('id', c.id, 'by', v_by, 'already', c.deleted_at is not null);
end;
$$;
revoke all on function public.live_delete_comment(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_delete_comment(uuid, uuid, uuid) to service_role;

-- live_answer_comment — «تمت الإجابة» on/off, moderators only (checked before
-- the lookup, so a non-moderator learns nothing). A deleted comment is not_found.
create or replace function public.live_answer_comment(
  p_session  uuid,
  p_comment  uuid,
  p_actor    uuid,
  p_answered boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.live_comments%rowtype;
begin
  if p_answered is null then
    raise exception 'live_comment:bad_request';
  end if;
  if not public.live_comment_is_moderator(p_session, p_actor) then
    raise exception 'live_comment:forbidden';
  end if;
  select * into c from public.live_comments x
   where x.id = p_comment and x.session_id = p_session and x.deleted_at is null
     for update;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  update public.live_comments
     set answered_at = case when p_answered then coalesce(answered_at, now()) end
   where id = c.id;
  return jsonb_build_object('id', c.id, 'answered', p_answered);
end;
$$;
revoke all on function public.live_answer_comment(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.live_answer_comment(uuid, uuid, uuid, boolean) to service_role;

-- live_block_comment_author — «منع من التعليق»: blocks that comment's author from
-- commenting in THIS session and deletes that comment, moderators only — without
-- ever saying who it was (returns the comment id only). Blocking one's own
-- comment is invalid_target. Idempotent.
create or replace function public.live_block_comment_author(
  p_session uuid,
  p_comment uuid,
  p_actor   uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.live_comments%rowtype;
begin
  if not public.live_comment_is_moderator(p_session, p_actor) then
    raise exception 'live_comment:forbidden';
  end if;
  select * into c from public.live_comments x
   where x.id = p_comment and x.session_id = p_session
     for update;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  if c.user_id = p_actor then
    raise exception 'live_comment:invalid_target';
  end if;

  insert into public.live_comment_blocks (session_id, user_id, blocked_by)
  values (p_session, c.user_id, p_actor)
  on conflict (session_id, user_id) do nothing;

  update public.live_comments
     set deleted_at = coalesce(deleted_at, now()),
         deleted_by = case when deleted_at is null then p_actor else deleted_by end
   where id = c.id;
  return jsonb_build_object('id', c.id);
end;
$$;
revoke all on function public.live_block_comment_author(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_block_comment_author(uuid, uuid, uuid) to service_role;

-- 5. Client RPCs ----------------------------------------------------------------------------

-- get_live_comments — the room's list (refetched on join; live updates arrive
-- as LiveKit data messages). Staff (content manager or sheikh): any session,
-- any status. Anyone else (guests too — they read, they don't post): a
-- participant of that session while it is green|live. Unknown session → staff
-- get [], others «غير مصرح» (no existence oracle). The 500 newest non-deleted,
-- oldest first, each + mine.
create or replace function public.get_live_comments(p_session uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_staff  boolean := public.is_content_manager() or public.is_sheikh();
  v_status public.live_status;
begin
  if v_uid is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if not v_staff then
    select s.status into v_status from public.live_sessions s where s.id = p_session;
    if v_status is null
       or v_status not in ('green', 'live')
       or not exists (select 1 from public.live_participants lp
                       where lp.session_id = p_session and lp.user_id = v_uid) then
      raise exception 'غير مصرح' using errcode = '42501';
    end if;
  end if;

  return coalesce((
    select jsonb_agg(public.live_comment_json(t.c, v_uid, true, false)
                     order by (t.c).created_at, (t.c).id)
      from (select x as c
              from public.live_comments x
             where x.session_id = p_session and x.deleted_at is null
             order by x.created_at desc, x.id desc
             limit 500) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_live_comments(uuid) from public, anon;
grant execute on function public.get_live_comments(uuid) to authenticated;

-- admin_live_comments — the admin page, after the majlis: every comment incl.
-- deleted ones (+ deleted, + mine), oldest first, the 5000 newest. Staff only.
-- Nameless stays nameless here too.
create or replace function public.admin_live_comments(p_session uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not (public.is_content_manager() or public.is_sheikh()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public.live_comment_json(t.c, v_uid, true, true)
                     order by (t.c).created_at, (t.c).id)
      from (select x as c
              from public.live_comments x
             where x.session_id = p_session
             order by x.created_at desc, x.id desc
             limit 5000) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_live_comments(uuid) from public, anon;
grant execute on function public.admin_live_comments(uuid) to authenticated;
