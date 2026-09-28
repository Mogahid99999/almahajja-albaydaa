-- =============================================================================
-- 0131_paced_push_queue.sql
-- المَحجّة البَيْضَاء — pace push delivery so big sends reach every phone.
--
-- After 0130 (100 ids per call, 60 s timeout) a re-push of the 2026-09-28
-- reminder (10,576 rows) delivered 6,086 pushes but lost ~2,200: the trigger
-- fired all 106 calls AT ONCE, so 4 hit `503 BOOT_ERROR` (too many edge
-- isolates starting together) and ~23 had every Expo chunk rejected even after
-- retries — ~8k pushes in a few seconds is far past Expo's ~600/s per project,
-- and the synchronized retries collided again.
--
-- Fix: the statement trigger now only ENQUEUES 100-id chunks into push_queue;
-- pg_cron runs process_push_queue() every 5 s and hands at most 6 chunks per
-- tick to notify-on-publish (≈120 pushes/s average, ≤6 concurrent isolates).
-- A 10k send completes in ~90 s; a single notification waits ≤5 s.
--
-- The target URL + Authorization differ per environment (staging's live
-- notify_push_batch points at staging; the repo's 0122 hardcodes prod), so
-- they are copied OUT of the live function into push_config at migration time
-- instead of being written here.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Private config (one row) ---------------------------------------------------
create table if not exists public.push_config (
  id   boolean primary key default true check (id),
  url  text not null,
  auth text not null
);
alter table public.push_config enable row level security;
revoke all on table public.push_config from public, anon, authenticated;

do $$
declare
  d      text := pg_get_functiondef('public.notify_push_batch()'::regprocedure);
  v_url  text := substring(d from 'url\s*:=\s*''([^'']+)''');
  v_auth text := substring(d from '''Authorization'',\s*''([^'']+)''');
begin
  if exists (select 1 from public.push_config) then
    return;  -- already captured (re-run)
  end if;
  if v_url is null or v_auth is null then
    raise exception '0131: could not read url/Authorization from the live notify_push_batch';
  end if;
  insert into public.push_config (url, auth) values (v_url, v_auth);
end $$;

-- 2. The queue -------------------------------------------------------------------
create table if not exists public.push_queue (
  id         bigserial primary key,
  ids        uuid[]      not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists push_queue_pending_idx on public.push_queue (id) where sent_at is null;
alter table public.push_queue enable row level security;
revoke all on table public.push_queue from public, anon, authenticated;
revoke all on sequence public.push_queue_id_seq from public, anon, authenticated;

-- 3. Trigger: enqueue only (same trigger, new body) -----------------------------
create or replace function public.notify_push_batch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ids   uuid[];
  v_total int;
  i       int;
  c constant int := 100;
begin
  select array_agg(id) into v_ids from new_rows;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then
    return null;
  end if;
  for i in 0 .. (v_total - 1) / c loop
    insert into public.push_queue (ids)
    values (v_ids[i * c + 1 : least((i + 1) * c, v_total)]);
  end loop;
  return null;
exception when others then
  -- Same contract as 0009: a push hiccup must never roll back the inbox rows.
  return null;
end;
$$;

-- 4. Paced sender ------------------------------------------------------------------
create or replace function public.process_push_queue()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg    record;
  j      record;
  v_sent int := 0;
begin
  select url, auth into cfg from public.push_config;
  if not found then
    return 0;
  end if;

  for j in
    select id, ids from public.push_queue
     where sent_at is null
     order by id
     limit 6
     for update skip locked
  loop
    perform net.http_post(
      url     := cfg.url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', cfg.auth),
      body    := jsonb_build_object('type', 'BATCH', 'ids', to_jsonb(j.ids)),
      timeout_milliseconds := 60000
    );
    update public.push_queue set sent_at = now() where id = j.id;
    v_sent := v_sent + 1;
  end loop;

  -- Keep the table small: handed-off chunks older than a day are history.
  delete from public.push_queue where sent_at < now() - interval '1 day';
  return v_sent;
end;
$$;
revoke all on function public.process_push_queue() from public, anon, authenticated;

-- 5. Schedule (every 5 s) ---------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-queue') then
    perform cron.unschedule('push-queue');
  end if;
  perform cron.schedule('push-queue', '5 seconds', $cmd$ select public.process_push_queue(); $cmd$);
end $$;
