-- =============================================================================
-- 0143_live_admin.sql
-- المَحجّة البَيْضَاء — V23 P6: the admin «البث المباشر» screen and the live
-- items of «المحاضرات الواردة» (PLAN_LIVE_V23 §8).
--
-- Why RPCs and not plain table reads (RLS alone is not enough):
--   * live_participants and live_moderation_log are service-role only (0135) —
--     the attendee count of a live session and the «مداخلات» list (who spoke and
--     when) can only reach staff through a definer function.
--   * media_jobs is content-manager only (0132); a sheikh's own sessions still
--     need their recording state.
--   * A sheikh sees his OWN scheduled / ended sessions here (host or his sheikhs
--     row); the green/live slot is shown to every staff member because it is the
--     one slot everybody shares (D3). The base table policy (0134) lets any
--     sheikh read every row — this screen narrows that on purpose.
--   * Finalize + publish must be ONE transaction: finalize_live_lecture (0138)
--     clears review_state, and a separate publish call that then failed would
--     leave the lecture out of «الواردة» as a silent draft.
--
-- Client RPCs (authenticated; each checks the role itself):
--   admin_live_overview(recent)        content manager or sheikh
--                                      → {active, scheduled, recent}
--   admin_live_inbox()                 content manager
--                                      → {drafts (needs_title), pending (being compressed)}
--   get_live_interventions(session)    content manager or sheikh (D2: real names)
--   admin_save_live_lecture(lecture, title, sheikh, section, publish, notify)
--                                      content manager — «تغيير» section (order stays
--                                      automatic: end of the new section) +
--                                      finalize_live_lecture + optional publish with
--                                      notify_on_publish (0123 «نشر بدون إشعار»)
--
-- Nothing here writes to live_sessions / live_participants / the log.
-- Append-only (0001–0142 are never edited). Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- =============================================================================
-- 1. Internal helpers
-- =============================================================================

-- Is this session "mine" for the calling sheikh: he hosts it, or it is recorded
-- under his sheikhs row.
create or replace function public.live_admin_is_mine(p_host uuid, p_sheikh uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_host = auth.uid(), false)
      or exists (
           select 1 from public.sheikhs sh
            where sh.id = p_sheikh and sh.user_id = auth.uid());
$$;
revoke all on function public.live_admin_is_mine(uuid, uuid) from public, anon, authenticated;

-- One live_sessions row → the admin screen's JSON. Never exposes raw paths,
-- egress ids or room names; the job error only to content managers.
create or replace function public.live_admin_session_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id',              s.id,
           'title',           s.title,
           'status',          s.status,
           'section_id',      s.section_id,
           'section_title',   sec.title,
           'sheikh_id',       s.sheikh_id,
           'sheikh_name',     sh.name,
           'host_user_id',    s.host_user_id,
           'host_name',       nullif(btrim(hp.display_name), ''),
           'is_mine',         coalesce(s.host_user_id = auth.uid(), false),
           'scheduled_at',    s.scheduled_at,
           'started_at',      s.started_at,
           'ended_at',        s.ended_at,
           'created_at',      s.created_at,
           'share_code',      s.share_code,
           'allow_requests',  s.allow_requests,
           'peak_listeners',  s.peak_listeners,
           'attendees',       case when s.status in ('green', 'live') then (
                                select count(*)::int from public.live_participants lp
                                 where lp.session_id = s.id and lp.present)
                              else 0 end,
           'lecture_id',      s.lecture_id,
           'lecture_status',  l.status,
           'lecture_needs_title', coalesce(l.review_state = 'needs_title', false),
           'duration_sec',    l.duration_sec,
           'raw_local',       (s.raw_path is not null and s.raw_deleted_at is null),
           'raw_backup',      (s.raw_backup_key is not null),
           'job',             case when j.id is null then null else jsonb_build_object(
                                'id',       j.id,
                                'status',   j.status,
                                'progress', j.progress,
                                'attempts', j.attempts,
                                'error',    case when public.is_content_manager() then j.error end,
                                'finished_at', j.finished_at) end)
    from public.live_sessions s
    join public.sections sec on sec.id = s.section_id
    left join public.sheikhs sh on sh.id = s.sheikh_id
    left join public.profiles hp on hp.id = s.host_user_id
    left join public.lectures l on l.id = s.lecture_id
    left join lateral (
      select mj.id, mj.status, mj.progress, mj.attempts, mj.error, mj.finished_at
        from public.media_jobs mj
       where mj.live_session_id = s.id and mj.kind = 'live_recording'
       order by mj.created_at desc
       limit 1
    ) j on true
   where s.id = p_id;
$$;
revoke all on function public.live_admin_session_json(uuid) from public, anon, authenticated;

-- =============================================================================
-- 2. admin_live_overview — the «البث المباشر» screen
-- =============================================================================
create or replace function public.admin_live_overview(p_recent int default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_manager boolean := public.is_content_manager();
  v_limit   int     := least(greatest(coalesce(p_recent, 20), 1), 50);
  v_active  jsonb;
  v_sched   jsonb;
  v_recent  jsonb;
begin
  if not (v_manager or public.is_sheikh()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  -- green + live: every staff member (the one D3 slot everybody shares).
  select coalesce(jsonb_agg(public.live_admin_session_json(t.id) order by t.sort_at), '[]'::jsonb)
    into v_active
    from (select s.id, coalesce(s.started_at, s.updated_at) as sort_at
            from public.live_sessions s
           where s.status in ('green', 'live')) t;

  select coalesce(jsonb_agg(public.live_admin_session_json(t.id) order by t.sort_at), '[]'::jsonb)
    into v_sched
    from (select s.id, s.scheduled_at as sort_at
            from public.live_sessions s
           where s.status = 'scheduled'
             and (v_manager or public.live_admin_is_mine(s.host_user_id, s.sheikh_id))
           order by s.scheduled_at
           limit 50) t;

  select coalesce(jsonb_agg(public.live_admin_session_json(t.id) order by t.sort_at desc), '[]'::jsonb)
    into v_recent
    from (select s.id, coalesce(s.ended_at, s.started_at, s.created_at) as sort_at
            from public.live_sessions s
           where s.status in ('ended', 'processing', 'ready', 'failed')
             and (v_manager or public.live_admin_is_mine(s.host_user_id, s.sheikh_id))
           order by coalesce(s.ended_at, s.started_at, s.created_at) desc
           limit v_limit) t;

  return jsonb_build_object(
    'active',     v_active,
    'scheduled',  v_sched,
    'recent',     v_recent,
    'is_manager', v_manager);
end;
$$;
revoke all on function public.admin_live_overview(int) from public, anon;
grant execute on function public.admin_live_overview(int) to authenticated;

-- =============================================================================
-- 3. admin_live_inbox — the live items of «المحاضرات الواردة»
-- =============================================================================
-- drafts:  lectures still review_state = 'needs_title' (created by the worker's
--          create_live_lecture, 0138), with the placement (section, order) and a
--          sheikh suggestion: the lecture's own sheikh → the session's → the
--          host's sheikhs row → the sheikh of the section's latest lecture.
-- pending: sessions whose recording is still on its way (ended < 2 h ago with no
--          job yet, processing) or failed — «جارٍ الضغط على الخادم».
create or replace function public.admin_live_inbox()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_drafts  jsonb;
  v_pending jsonb;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(d.j order by d.sort_at desc), '[]'::jsonb)
    into v_drafts
    from (
      select l.created_at as sort_at,
             jsonb_build_object(
               'lecture_id',        l.id,
               'title',             l.title,
               'section_id',        l.section_id,
               'section_title',     sec.title,
               'order',             l."order",
               'sheikh_id',         l.sheikh_id,
               'suggested_sheikh_id', sug.id,
               'suggested_sheikh_name', sug.name,
               'duration_sec',      l.duration_sec,
               'created_at',        l.created_at,
               'notify_on_publish', l.notify_on_publish,
               'session_id',        s.id,
               'session_title',     s.title,
               'started_at',        s.started_at,
               'ended_at',          s.ended_at,
               'peak_listeners',    coalesce(s.peak_listeners, 0)) as j
        from public.lectures l
        left join public.sections sec on sec.id = l.section_id
        left join public.live_sessions s on s.id = l.live_session_id
        left join lateral (
          select x.id, x.name
            from public.sheikhs x
           where x.id = coalesce(
                   l.sheikh_id,
                   s.sheikh_id,
                   (select h.id from public.sheikhs h
                     where h.user_id = s.host_user_id
                     order by h.created_at limit 1),
                   (select o.sheikh_id from public.lectures o
                     where o.section_id = l.section_id
                       and o.id <> l.id
                       and o.sheikh_id is not null
                     order by o."order" desc, o.created_at desc limit 1))
        ) sug on true
       where l.review_state = 'needs_title'
    ) d;

  select coalesce(jsonb_agg(p.j order by p.sort_at desc), '[]'::jsonb)
    into v_pending
    from (
      select coalesce(s.ended_at, s.updated_at) as sort_at,
             public.live_admin_session_json(s.id) as j
        from public.live_sessions s
       where s.lecture_id is null
         and (   s.status in ('processing', 'failed')
              or (s.status = 'ended' and s.ended_at > now() - interval '2 hours'))
       order by coalesce(s.ended_at, s.updated_at) desc
       limit 20
    ) p;

  return jsonb_build_object('drafts', v_drafts, 'pending', v_pending);
end;
$$;
revoke all on function public.admin_live_inbox() from public, anon;
grant execute on function public.admin_live_inbox() to authenticated;

-- =============================================================================
-- 4. get_live_interventions — «المداخلات»: who spoke and when (§8)
-- =============================================================================
-- One row per participant other than the host who was given the word
-- (live_moderation_log `approve`) or has spoken time (moderators speak without
-- an approve). stints: [{from_at, to_at, from_sec, to_sec}] — from = approve,
-- to = the next demote / step_down for that identity, else his last leave, else
-- the session end. *_sec are offsets from started_at (≈ the recording's
-- timeline: the egress starts with the broadcast). spoke_seconds = measured mic
-- time (live_room_event track_published / unpublished).
-- D2 (changed 2026-09-28): staff see the REAL name, incl. a sister who chose
-- «بدون اسم» (hidden_name = true tells the UI to say so).
create or replace function public.get_live_interventions(p_session uuid)
returns table (
  identity      text,
  display_name  text,
  hidden_name   boolean,
  gender        text,
  role          text,
  spoke_seconds int,
  stints        jsonb
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_id      uuid;
  v_host    uuid;
  v_started timestamptz;
  v_ended   timestamptz;
begin
  if not (public.is_content_manager() or public.is_sheikh()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select ls.id, ls.host_user_id, ls.started_at, ls.ended_at
    into v_id, v_host, v_started, v_ended
    from public.live_sessions ls
   where ls.id = p_session;
  if v_id is null then
    raise exception 'المجلس غير موجود';
  end if;

  return query
    with ev as (
      select m.target_identity as ident, m.action as act, m.created_at as ev_at
        from public.live_moderation_log m
       where m.session_id = v_id
         and m.target_identity is not null
         and m.action in ('approve', 'demote', 'step_down')
    ),
    st as (
      select a.ident,
             a.ev_at as from_at,
             (select min(e.ev_at) from ev e
               where e.ident = a.ident
                 and e.act in ('demote', 'step_down')
                 and e.ev_at > a.ev_at) as next_end
        from ev a
       where a.act = 'approve'
    )
    select p.identity,
           p.display_name,
           p.hidden_name,
           p.gender,
           p.role,
           (p.spoke_seconds + public.live_stint_seconds(p.speaking_since))::int,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'from_at',  x.from_at,
                      'to_at',    x.to_at,
                      'from_sec', case when v_started is null then null
                                       else greatest(0, floor(extract(epoch from x.from_at - v_started)))::int end,
                      'to_sec',   case when v_started is null or x.to_at is null then null
                                       else greatest(0, floor(extract(epoch from x.to_at - v_started)))::int end)
                    order by x.from_at)
               from (
                 select st.from_at,
                        least(st.next_end,
                              case when p.left_at > st.from_at then p.left_at end,
                              case when v_ended > st.from_at then v_ended end) as to_at
                   from st
                  where st.ident = p.identity
               ) x
           ), '[]'::jsonb)
      from public.live_participants p
     where p.session_id = v_id
       and p.role <> 'host'
       and p.user_id is distinct from v_host
       and (   p.spoke_seconds > 0
            or p.speaking_since is not null
            or exists (select 1 from ev where ev.ident = p.identity and ev.act = 'approve'))
     order by (select min(ev.ev_at) from ev where ev.ident = p.identity and ev.act = 'approve') nulls last,
              p.joined_at,
              p.identity;
end;
$$;
revoke all on function public.get_live_interventions(uuid) from public, anon;
grant execute on function public.get_live_interventions(uuid) to authenticated;

-- =============================================================================
-- 5. admin_save_live_lecture — finalize (+ publish) in one transaction
-- =============================================================================
-- «حفظ دون نشر»: p_publish false — title + sheikh set, review_state cleared, the
--   lecture stays a draft in its section (leaves «الواردة», listed in المحاضرات).
-- «نشر»: p_publish true — the same, then status = 'published' with
--   notify_on_publish = p_notify (false = «نشر بدون إشعار», 0123). The normal
--   publish triggers run unchanged (fan-out 0129, live publish tracking 0137).
-- p_section: «تغيير» the fixed section; the order stays automatic (end of the
--   new section). null / same section = keep the placement create_live_lecture
--   chose.
create or replace function public.admin_save_live_lecture(
  p_lecture uuid,
  p_title   text,
  p_sheikh  uuid,
  p_section uuid    default null,
  p_publish boolean default false,
  p_notify  boolean default true
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_section uuid;
  v_source  text;
  v_order   int;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select l.section_id, l.source into v_section, v_source
    from public.lectures l where l.id = p_lecture for update;
  if not found or v_source is distinct from 'live' then
    raise exception 'المحاضرة غير موجودة أو ليست من بث مباشر';
  end if;

  if p_section is not null and p_section is distinct from v_section then
    if not exists (select 1 from public.sections where id = p_section) then
      raise exception 'القسم غير موجود';
    end if;
    select coalesce(max(x."order"), 0) + 1 into v_order
      from public.lectures x where x.section_id = p_section;
    update public.lectures
       set section_id = p_section, "order" = v_order
     where id = p_lecture;
    v_section := p_section;
  end if;

  -- The two required fields (0138): title 3–200 chars, an existing sheikh.
  perform public.finalize_live_lecture(p_lecture, p_title, p_sheikh);

  if coalesce(p_publish, false) then
    if v_section is null then
      raise exception 'اختر القسم قبل النشر';
    end if;
    update public.lectures
       set notify_on_publish = coalesce(p_notify, true),
           status            = 'published'
     where id = p_lecture;
  end if;
end;
$$;
revoke all on function public.admin_save_live_lecture(uuid, text, uuid, uuid, boolean, boolean)
  from public, anon;
grant execute on function public.admin_save_live_lecture(uuid, text, uuid, uuid, boolean, boolean)
  to authenticated;
