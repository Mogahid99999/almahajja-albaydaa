-- =============================================================================
-- 0183_live_comment_pin.sql
-- المَحجّة البَيْضَاء — pin one comment of a live majlis (owner request 2026-11-22).
--
--   * live_sessions.pinned_comment_id: at most one pinned comment per session. The
--     host / the session's moderators / content managers pin any comment of the
--     session (or clear the pin) while green or live — live_set_comment_pinned,
--     service role only, called by live-control (action comment_pin).
--   * A pinned comment that gets deleted (its author, a moderator, a block) leaves the
--     pin at once (trigger) — the room drops it on the same {t:'del'} broadcast.
--   * get_live_comments_state(session) → { closed, pinned: <public comment> | null }
--     (same access as before). Old apps read only `closed`.
--
-- Requires 0147, 0182. Append-only, idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Column + audit action ------------------------------------------------------------
alter table public.live_sessions
  add column if not exists pinned_comment_id uuid
    references public.live_comments (id) on delete set null;

alter table public.live_moderation_log drop constraint if exists live_moderation_log_action_check;
alter table public.live_moderation_log add constraint live_moderation_log_action_check
  check (action = any (array['open_green', 'start', 'end', 'cancel', 'approve', 'reject', 'mute',
                             'demote', 'step_down', 'set_allow_requests', 'host_leave', 'auto_end',
                             'resume_recording', 'comment_delete', 'comment_answered', 'comment_block',
                             'react_block', 'recording_delete', 'comments_close', 'comment_pin']));

-- 2. A deleted comment is never pinned ---------------------------------------------------
create or replace function public.live_comment_unpin_deleted()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.live_sessions
       set pinned_comment_id = null
     where id = new.session_id and pinned_comment_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.live_comment_unpin_deleted() from public, anon, authenticated;

drop trigger if exists live_comment_unpin_deleted on public.live_comments;
create trigger live_comment_unpin_deleted
  after update of deleted_at on public.live_comments
  for each row execute function public.live_comment_unpin_deleted();

-- 3. live_set_comment_pinned — moderators only (live_comment_is_moderator), green or live.
-- p_comment null = clear the pin. Returns { pinned: <public comment> | null, changed }.
create or replace function public.live_set_comment_pinned(
  p_session uuid,
  p_actor   uuid,
  p_comment uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.live_sessions%rowtype;
  c public.live_comments%rowtype;
begin
  select * into s from public.live_sessions x where x.id = p_session for update;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  if not public.live_comment_is_moderator(p_session, p_actor) then
    raise exception 'live_comment:forbidden';
  end if;
  if s.status not in ('green', 'live') then
    raise exception 'live_comment:not_live';
  end if;

  if p_comment is null then
    if s.pinned_comment_id is null then
      return jsonb_build_object('pinned', null, 'changed', false);
    end if;
    update public.live_sessions set pinned_comment_id = null where id = p_session;
    return jsonb_build_object('pinned', null, 'changed', true);
  end if;

  select * into c from public.live_comments x
   where x.id = p_comment and x.session_id = p_session;
  if not found or c.deleted_at is not null then
    raise exception 'live_comment:not_found';
  end if;
  if s.pinned_comment_id is distinct from c.id then
    update public.live_sessions set pinned_comment_id = c.id where id = p_session;
    return jsonb_build_object('pinned', public.live_comment_json(c, null, false, false), 'changed', true);
  end if;
  return jsonb_build_object('pinned', public.live_comment_json(c, null, false, false), 'changed', false);
end;
$$;
revoke all on function public.live_set_comment_pinned(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_set_comment_pinned(uuid, uuid, uuid) to service_role;

-- 4. get_live_comments_state + pinned (0182 access unchanged) ----------------------------
create or replace function public.get_live_comments_state(p_session uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s     public.live_sessions%rowtype;
  c     public.live_comments%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select * into s from public.live_sessions x where x.id = p_session;
  if not found then
    return jsonb_build_object('closed', false, 'pinned', null);
  end if;
  if not (public.is_content_manager() or public.is_sheikh()
          or (s.status in ('green', 'live')
              and exists (select 1 from public.live_participants lp
                           where lp.session_id = p_session and lp.user_id = v_uid))) then
    return jsonb_build_object('closed', false, 'pinned', null);
  end if;
  if s.pinned_comment_id is not null then
    select * into c from public.live_comments x
     where x.id = s.pinned_comment_id and x.deleted_at is null;
  end if;
  return jsonb_build_object(
    'closed', s.comments_closed,
    'pinned', case when c.id is not null then public.live_comment_json(c, null, false, false) end);
end;
$$;
revoke all on function public.get_live_comments_state(uuid) from public, anon;
grant execute on function public.get_live_comments_state(uuid) to authenticated;
