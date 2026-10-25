-- =============================================================================
-- 0160_sheikh_lecture_manager.sql
-- المَحجّة البَيْضَاء — the شيخ manages LECTURES (owner 2026-10-25).
--
-- is_lecture_manager() = role in ('admin','publisher','sheikh'). It replaces
-- is_content_manager() ONLY on the lecture surface: lectures + attachments
-- (RLS), media_jobs (compression status), the incoming / live-recording queue
-- (admin_live_inbox, admin_save_live_lecture, finalize_live_lecture), reorder,
-- server compression (enqueue_lecture_transcode), the R2 read gate for draft
-- lectures/attachments (can_read_storage_object) and the section picker
-- (get_sections_flat). The sections tree, sheikhs, broadcasts, featured picks
-- and settings stay is_content_manager() / is_admin().
--
-- Function bodies are the LIVE prod definitions (2026-10-25) with that one
-- call swapped. Append-only, idempotent. No new tables (no grants needed).
-- =============================================================================

create or replace function public.is_lecture_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'publisher', 'sheikh')
  );
$$;

revoke execute on function public.is_lecture_manager() from public, anon;
grant execute on function public.is_lecture_manager() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: lectures · attachments · media_jobs
-- ---------------------------------------------------------------------------
drop policy if exists lectures_admin_insert on public.lectures;
create policy lectures_admin_insert on public.lectures for insert to authenticated
  with check ((select public.is_lecture_manager()));
drop policy if exists lectures_admin_update on public.lectures;
create policy lectures_admin_update on public.lectures for update to authenticated
  using ((select public.is_lecture_manager())) with check ((select public.is_lecture_manager()));
drop policy if exists lectures_admin_delete on public.lectures;
create policy lectures_admin_delete on public.lectures for delete to authenticated
  using ((select public.is_lecture_manager()));
drop policy if exists lectures_select on public.lectures;
create policy lectures_select on public.lectures for select to authenticated
  using (status = 'published' or (select public.is_lecture_manager()));

drop policy if exists attachments_admin_insert on public.attachments;
create policy attachments_admin_insert on public.attachments for insert to authenticated
  with check ((select public.is_lecture_manager()));
drop policy if exists attachments_admin_update on public.attachments;
create policy attachments_admin_update on public.attachments for update to authenticated
  using ((select public.is_lecture_manager())) with check ((select public.is_lecture_manager()));
drop policy if exists attachments_admin_delete on public.attachments;
create policy attachments_admin_delete on public.attachments for delete to authenticated
  using ((select public.is_lecture_manager()));
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated
  using (
    (select public.is_admin())
    or section_id is not null
    or exists (select 1 from public.lectures l where l.id = attachments.lecture_id and l.status = 'published')
    or (select public.is_lecture_manager())
  );

drop policy if exists media_jobs_select_content_manager on public.media_jobs;
create policy media_jobs_select_content_manager on public.media_jobs for select to authenticated
  using ((select public.is_lecture_manager()));

-- ---------------------------------------------------------------------------
-- Functions (prod bodies, is_content_manager() → is_lecture_manager())
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_live_lecture(p_lecture uuid, p_title text, p_sheikh uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not public.is_lecture_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'العنوان بين ٣ و٢٠٠ حرف';
  end if;
  if p_sheikh is null or not exists (select 1 from public.sheikhs where id = p_sheikh) then
    raise exception 'اختر الشيخ';
  end if;
  update public.lectures
     set title = v_title, sheikh_id = p_sheikh, review_state = null
   where id = p_lecture and source = 'live';
  if not found then
    raise exception 'المحاضرة غير موجودة أو ليست من بث مباشر';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_live_lecture(p_lecture uuid, p_title text, p_sheikh uuid, p_section uuid DEFAULT NULL::uuid, p_publish boolean DEFAULT false, p_notify boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_section uuid;
  v_source  text;
  v_order   int;
begin
  if not public.is_lecture_manager() then
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_reorder_lectures(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sections integer;
begin
  if not public.is_lecture_manager() then
    raise exception 'غير مصرح';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  -- All rows must exist, share ONE section, and that section must be set
  -- (an unclassified lecture has no order to reorder against).
  select count(distinct section_id) into v_sections
    from public.lectures where id = any (p_ids);
  if v_sections <> 1
     or (select count(*) from public.lectures where id = any (p_ids) and section_id is not null)
        <> array_length(p_ids, 1) then
    raise exception 'ترتيب غير صالح';
  end if;
  update public.lectures l
     set "order" = x.pos
    from unnest(p_ids) with ordinality as x(lid, pos)
   where l.id = x.lid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_lecture_transcode(p_lecture uuid, p_input_key text, p_publish_on_done boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key      text := btrim(coalesce(p_input_key, ''));
  v_existing public.media_jobs%rowtype;
  v_id       uuid;
begin
  if not public.is_lecture_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if v_key not like 'incoming/_%'
     or position('..' in v_key) > 0
     or length(v_key) > 512 then
    raise exception 'مفتاح الملف غير صالح';
  end if;
  if p_lecture is null
     or not exists (select 1 from public.lectures where id = p_lecture) then
    raise exception 'المحاضرة غير موجودة';
  end if;

  -- Serialise concurrent enqueues for the same lecture.
  perform 1 from public.lectures where id = p_lecture for update;

  select * into v_existing
    from public.media_jobs
   where lecture_id = p_lecture
     and kind = 'lecture_transcode'
     and status in ('queued', 'running')
   order by created_at desc
   limit 1;
  if found then
    if v_existing.input_key = v_key then
      -- Retried request for the same file: same job; publish can only turn on.
      if coalesce(p_publish_on_done, false) and not v_existing.publish_on_done then
        update public.media_jobs set publish_on_done = true where id = v_existing.id;
      end if;
      return v_existing.id;
    end if;
    raise exception 'يجري ضغط ملف آخر لهذه المحاضرة، انتظر حتى يكتمل';
  end if;

  -- No active job (none yet, or the previous one is done/failed): enqueue.
  insert into public.media_jobs (kind, input_key, lecture_id, created_by, publish_on_done)
  values ('lecture_transcode', v_key, p_lecture, auth.uid(), coalesce(p_publish_on_done, false))
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_live_inbox()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_drafts  jsonb;
  v_pending jsonb;
begin
  if not public.is_lecture_manager() then
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
$function$;

CREATE OR REPLACE FUNCTION public.can_read_storage_object(p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_key like 'lectures/%' then
      public.is_lecture_manager()
      or exists (
        select 1 from public.lectures l
        where l.audio_path = p_key and l.status = 'published'
      )
    when p_key like 'attachments/%' then
      public.is_lecture_manager()
      or exists (
        select 1 from public.attachments a
        where a.storage_path = p_key
          and (
            a.section_id is not null
            or exists (
              select 1 from public.lectures l
              where l.id = a.lecture_id and l.status = 'published'
            )
          )
      )
    when p_key like 'broadcasts/%' then
      exists (
        select 1 from public.broadcasts b
        where (b.image_path = p_key or b.audio_path = p_key) and b.deleted_at is null
      )
      -- Ticket-reply images live under broadcasts/ too — allow the admin or the
      -- ticket owner to read them, no one else.
      or exists (
        select 1
          from public.feedback_messages m
          join public.feedback f on f.id = m.feedback_id
         where m.image_path = p_key
           and (public.is_admin() or f.user_id = auth.uid())
      )
    when p_key like 'answers/%' then
      public.is_moderator()
      or exists (
        select 1 from public.questions q
        where q.answer_audio_path = p_key
          and (q.asker_id = auth.uid() or (q.audience = 'public' and q.status = 'answered'))
      )
      or exists (
        select 1 from public.question_answers a
        join public.questions q on q.id = a.question_id
        where a.audio_path = p_key
          and (q.asker_id = auth.uid() or (q.audience = 'public' and q.status = 'answered'))
      )
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sections_flat()
 RETURNS TABLE(id uuid, title text, parent_id uuid, depth integer, path text[], ord integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive tree as (
    select s.id, s.title, s.parent_id, 0 as depth, array[s.title] as path,
           s."order" as ord,
           -- Sort key: zero-padded order + title at each level, so siblings
           -- follow their رقم الترتيب and ties fall back to the title.
           array[lpad(s."order"::text, 8, '0') || s.title] as sort_path
      from public.sections s
     where s.parent_id is null
    union all
    select s.id, s.title, s.parent_id, t.depth + 1, t.path || s.title,
           s."order",
           t.sort_path || (lpad(s."order"::text, 8, '0') || s.title)
      from public.sections s
      join tree t on s.parent_id = t.id
  )
  select id, title, parent_id, depth, path, ord
    from tree
   where public.is_lecture_manager()
      or public.section_visible_to_viewer(
           id, (select gender from public.profiles where id = auth.uid())
         )
   order by sort_path;
$function$;
