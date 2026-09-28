-- =============================================================================
-- 0129_async_fanout.sql
-- المَحجّة البَيْضَاء — BUGFIX: «تعذّر الإرسال» on التذكيرات النافعة, and lecture
-- publish-with-notification failing (admins switched to «نشر بدون إشعار»).
--
-- Both fan out one notifications row per student (~10.6k) INSIDE the admin's
-- request, which PostgREST caps at the `authenticated` 8 s statement_timeout.
-- Measured on prod 2026-09-28 in rolled-back blocks: a reminder send took
-- 18–25 s, a lecture fan-out 3–8.6 s. The rows themselves are cheap (EXPLAIN:
-- ~1.2 s warm) but the same 10k-row insert swings from ~1 s to 7.5 s+ with
-- cache/IO state, so any synchronous fan-out keeps failing intermittently.
-- A timeout (57014) is not caught by `exception when others`, so the whole
-- send rolled back: no reminder has been created since 2026-08-25, and 24 of
-- the last 29 lectures were published silently.
--
-- Fix: the request only records the reminder/lecture and ENQUEUES the fan-out
-- (one tiny row). pg_cron runs process_fanout_queue() every 10 s, outside any
-- request timeout. Each job runs in its own subtransaction and is marked done
-- in the same one, so a job is delivered exactly once (retried on error, up
-- to 5 attempts). A reminder deleted / lecture unpublished before its job runs
-- is skipped.
--
-- Recipient rules are unchanged (same SELECTs as 0121 / fanout_to_all).
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. The queue ------------------------------------------------------------------
create table if not exists public.fanout_queue (
  id          bigserial primary key,
  kind        text        not null check (kind in ('broadcast', 'lecture')),
  ref_id      uuid        not null,
  params      jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  done_at     timestamptz,
  attempts    int         not null default 0,
  last_error  text
);
create index if not exists fanout_queue_pending_idx
  on public.fanout_queue (id) where done_at is null;

-- Internal only: RLS on with no policies, and no table grants to API roles.
alter table public.fanout_queue enable row level security;
revoke all on table public.fanout_queue from public, anon, authenticated;
revoke all on sequence public.fanout_queue_id_seq from public, anon, authenticated;

-- 2. Broadcast fan-out (the 0121 recipient SELECT, verbatim) --------------------
create or replace function public.run_broadcast_fanout(p_broadcast_id uuid, p_params jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  b                record;
  p_no_email       boolean := coalesce((p_params ->> 'no_email')::boolean, false);
  p_not_registered boolean := coalesce((p_params ->> 'not_registered')::boolean, false);
  v_gender         text    := nullif(btrim(coalesce(p_params ->> 'gender', '')), '');
  p_user_ids       uuid[]  := case
                                when jsonb_typeof(p_params -> 'user_ids') = 'array'
                                then array(select jsonb_array_elements_text(p_params -> 'user_ids')::uuid)
                              end;
  v_targeted       boolean;
begin
  select id, title, body, image_path into b
    from public.broadcasts
   where id = p_broadcast_id and deleted_at is null;
  if not found then
    return;  -- deleted before delivery: send nothing
  end if;
  if p_user_ids is not null and array_length(p_user_ids, 1) is null then
    p_user_ids := null;
  end if;

  v_targeted := p_no_email or p_not_registered or v_gender is not null
             or coalesce(array_length(p_user_ids, 1), 0) > 0;

  insert into public.notifications (user_id, type, title, body, data)
  select r.id, 'beneficial_reminder', b.title, left(b.body, 300),
         jsonb_build_object(
           'route',       '/(student)/reminder/' || b.id,
           'broadcastId', b.id
         ) || case when b.image_path is not null
                then jsonb_build_object('imagePath', b.image_path)
                else '{}'::jsonb
              end
    from (
      select p.id
        from public.profiles p
        left join auth.users u on u.id = p.id
       where p.role = 'student'
         and (not v_targeted
              or (
                   (not p_no_email       or u.email is null)
               and (not p_not_registered or coalesce(u.is_anonymous, false) = true)
               and (v_gender is null     or p.gender = v_gender)
              ))
         and (
               p_no_email
            or p_not_registered
            or v_gender is not null
            or coalesce(array_length(p_user_ids, 1), 0) = 0
             )
      union
      select p.id
        from public.profiles p
       where p.role = 'student'
         and p_user_ids is not null
         and p.id = any(p_user_ids)
    ) r
    left join public.notification_prefs np
      on np.user_id = r.id and np.type = 'beneficial_reminder'
   where coalesce(np.enabled, true);  -- missing pref row = ON
end;
$$;
revoke all on function public.run_broadcast_fanout(uuid, jsonb) from public, anon, authenticated;

-- 3. The worker ------------------------------------------------------------------
create or replace function public.process_fanout_queue()
returns int
language plpgsql security definer set search_path = public as $$
declare
  j      record;
  v_done int := 0;
  v_err  text;
begin
  for j in
    select * from public.fanout_queue
     where done_at is null and attempts < 5
     order by id
     limit 20
     for update skip locked
  loop
    update public.fanout_queue
       set started_at = now(), attempts = attempts + 1
     where id = j.id;
    begin
      if j.kind = 'broadcast' then
        perform public.run_broadcast_fanout(j.ref_id, j.params);
      elsif j.kind = 'lecture' then
        -- Only if it is still published by the time the job runs.
        if exists (select 1 from public.lectures l
                    where l.id = j.ref_id and l.status = 'published') then
          perform public.fanout_to_all(
            'new_lecture',
            j.params ->> 'title',
            j.params ->> 'body',
            coalesce(j.params -> 'data', '{}'::jsonb)
          );
        end if;
      end if;
      -- Same subtransaction as the inserts: delivered ⇔ marked done.
      update public.fanout_queue set done_at = now(), last_error = null where id = j.id;
      v_done := v_done + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.fanout_queue set last_error = left(v_err, 500) where id = j.id;
    end;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.process_fanout_queue() from public, anon, authenticated;

-- 4. Reminder send: record + enqueue (same signature as 0121) ------------------
create or replace function public.create_broadcast_targeted(
  p_title          text,
  p_body           text,
  p_show_on_home   boolean   default false,
  p_image_path     text      default null,
  p_link_url       text      default null,
  p_link_label     text      default null,
  p_audio_path     text      default null,
  p_no_email       boolean   default false,
  p_not_registered boolean   default false,
  p_gender         text      default null,
  p_user_ids       uuid[]    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid;
  v_targeted  boolean;
  v_gender    text := nullif(btrim(coalesce(p_gender, '')), '');
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  v_targeted := coalesce(p_no_email, false)
             or coalesce(p_not_registered, false)
             or v_gender is not null
             or coalesce(array_length(p_user_ids, 1), 0) > 0;

  insert into public.broadcasts
    (title, body, show_on_home, created_by, published_at,
     image_path, link_url, link_label, audio_path, is_targeted)
  values (
    trim(p_title), trim(p_body), coalesce(p_show_on_home, false), auth.uid(), now(),
    nullif(trim(coalesce(p_image_path, '')), ''),
    nullif(trim(coalesce(p_link_url, '')), ''),
    nullif(trim(coalesce(p_link_label, '')), ''),
    nullif(trim(coalesce(p_audio_path, '')), ''),
    v_targeted
  )
  returning id into v_id;

  -- Delivered by process_fanout_queue (pg_cron, every 10 s) — never inside
  -- this request's 8 s statement_timeout.
  insert into public.fanout_queue (kind, ref_id, params)
  values ('broadcast', v_id, jsonb_build_object(
    'no_email',       coalesce(p_no_email, false),
    'not_registered', coalesce(p_not_registered, false),
    'gender',         v_gender,
    'user_ids',       case when coalesce(array_length(p_user_ids, 1), 0) > 0
                           then to_jsonb(p_user_ids) end
  ));

  return v_id;
end;
$$;
revoke execute on function public.create_broadcast_targeted(
  text, text, boolean, text, text, text, text, boolean, boolean, text, uuid[])
  from public, anon;
grant execute on function public.create_broadcast_targeted(
  text, text, boolean, text, text, text, text, boolean, boolean, text, uuid[])
  to authenticated;

-- 5. Lecture publish: enqueue instead of fanning out in the INSERT/UPDATE ------
create or replace function public.notify_lecture_published()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_section_title text;
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    -- «نشر بدون إشعار» (0123): the admin asked for this lecture to land quietly.
    if not coalesce(new.notify_on_publish, true) then
      return new;
    end if;
    if new.section_id is null then
      return new;
    end if;
    select s.title into v_section_title
      from public.sections s where s.id = new.section_id;
    insert into public.fanout_queue (kind, ref_id, params)
    values ('lecture', new.id, jsonb_build_object(
      'title', 'أُضيف درس جديد في ' || coalesce(v_section_title, ''),
      'body',  new.title,
      'data',  jsonb_build_object('lectureId', new.id, 'sectionId', new.section_id)
    ));
  end if;
  return new;
end;
$$;

-- 6. Schedule the worker (every 10 s; pg_cron ≥ 1.5 second schedules) ---------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'fanout-queue') then
    perform cron.unschedule('fanout-queue');
  end if;
  perform cron.schedule(
    'fanout-queue',
    '10 seconds',
    $cmd$ set statement_timeout = '5min'; select public.process_fanout_queue(); $cmd$
  );
end $$;
