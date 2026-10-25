-- =============================================================================
-- 0159_push_governor.sql
-- المَحجّة البَيْضَاء — LOAD V25: pushes never go out faster than the database
-- can absorb the app opens they cause (server only — protects every app version).
--
-- A push wave makes phones open the app. 0155 spread the live-start / new-lesson
-- pushes over 10 minutes at a FIXED pace; two gaps were left:
--
-- 1. Backpressure (the governor). Before every tick (pg_cron, every 5 s) the
--    push worker looks at how many app queries are running right now
--    (pg_stat_activity: PostgREST + GoTrue + Storage backends in state active):
--      calm  (< busy)         → up to 6 requests per tick (as before);
--      busy  (≥ busy)         → 2 per tick;
--      choke (≥ choke)        → 0 — the queue waits until the database is calm.
--    A held push is never held forever: once a due row has waited
--    `max_hold_minutes` the worker sends 1 per tick even when choked.
--    Thresholds live in app_config 'push_governor' (jsonb text) so they can be
--    tuned without a migration. Every throttled tick is logged in
--    push_governor_log (kept 2 days) to tune them after a live.
--
-- 2. «التذكيرات النافعة», daily nudges and every other inbox fan-out (the
--    notifications_push_batch trigger) were still released all at once (~70 s
--    for 8.5k students). They are now staggered like 0155's push_to_users:
--    chunks of 100, ≤ 7 s apart, the whole send within 10 minutes, the most
--    recently active students first. A single personal notification (one
--    chunk) still goes immediately.
--
-- Bodies are the live prod definitions (pg_get_functiondef, 2026-10-05) with
-- only the marked changes. Append-only. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1a. Settings -------------------------------------------------------------------------
insert into public.app_config (key, value)
values ('push_governor', '{"busy": 4, "choke": 10, "max_hold_minutes": 15}')
on conflict (key) do nothing;

-- 1b. What the governor decided, when it held pushes back --------------------------------
create table if not exists public.push_governor_log (
  at     timestamptz not null default now(),
  active int not null,
  budget int not null,
  due    int not null
);
create index if not exists push_governor_log_at_idx on public.push_governor_log (at);
alter table public.push_governor_log enable row level security;
revoke all on table public.push_governor_log from public, anon, authenticated;
comment on table public.push_governor_log is
  '0159: one row per push-worker tick that was throttled (budget < 6): active app queries, requests allowed, rows due. Kept 2 days.';

-- 1c. The decision -------------------------------------------------------------------------
create or replace function public.push_governor_state(out active int, out budget int, out max_hold interval)
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg     jsonb;
  v_busy  int;
  v_choke int;
begin
  begin
    select c.value::jsonb into cfg from public.app_config c where c.key = 'push_governor';
  exception when others then
    cfg := null;  -- a malformed setting must never stop pushes
  end;
  v_busy   := coalesce((cfg ->> 'busy')::int, 4);
  v_choke  := coalesce((cfg ->> 'choke')::int, 10);
  max_hold := make_interval(mins => coalesce((cfg ->> 'max_hold_minutes')::int, 15));

  -- App traffic only: PostgREST (the app + edge functions), GoTrue, Storage.
  -- Not pg_cron, pg_net, the exporter or dashboard queries.
  select count(*) into active
    from pg_stat_activity
   where backend_type = 'client backend'
     and state = 'active'
     and usename in ('authenticator', 'supabase_auth_admin', 'supabase_storage_admin')
     and pid <> pg_backend_pid();

  budget := case
              when active >= v_choke then 0
              when active >= v_busy  then 2
              else 6
            end;
end;
$$;
revoke all on function public.push_governor_state() from public, anon, authenticated;

-- 1d. process_push_queue: the 0155 body with the governor's budget ----------------------
create or replace function public.process_push_queue()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg      record;
  j        record;
  g        record;
  v_sent   int := 0;
  v_budget int;
  v_ids    bigint[];
  v_msgs   jsonb;
  v_due    int;
begin
  select url, auth into cfg from public.push_config;
  if not found then
    return 0;
  end if;

  -- 0159: how much the database can take this tick.
  select * into g from public.push_governor_state();
  v_budget := g.budget;
  if v_budget < 6 then
    select count(*) into v_due
      from public.push_queue
     where sent_at is null and (send_after is null or send_after <= now());
    v_due := v_due + (select count(*) from public.push_outbox where sent_at is null);
    if v_due = 0 then
      return 0;  -- nothing waiting: nothing to hold, nothing to log
    end if;
    -- Held too long → trickle one through even when choked.
    if v_budget = 0 and (
         exists (select 1 from public.push_queue
                  where sent_at is null
                    and coalesce(send_after, created_at) < now() - g.max_hold)
      or exists (select 1 from public.push_outbox
                  where sent_at is null and created_at < now() - g.max_hold)
    ) then
      v_budget := 1;
    end if;
    insert into public.push_governor_log (active, budget, due) values (g.active, v_budget, v_due);
  end if;

  for j in
    select id, ids, payload from public.push_queue
     where sent_at is null
       and (send_after is null or send_after <= now())   -- 0155
     order by coalesce(send_after, created_at), id          -- 0155
     limit v_budget                                         -- 0159 (was 6)
     for update skip locked
  loop
    perform net.http_post(
      url     := cfg.url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', cfg.auth),
      body    := case
                   when j.payload is null
                     then jsonb_build_object('type', 'BATCH', 'ids', to_jsonb(j.ids))
                   else jsonb_build_object('type', 'DIRECT', 'users', to_jsonb(j.ids),
                                           'notification', j.payload)
                 end,
      timeout_milliseconds := 60000
    );
    update public.push_queue set sent_at = now() where id = j.id;
    v_sent := v_sent + 1;
  end loop;

  -- Same budget for the per-user outbox.
  while v_sent < v_budget loop                               -- 0159 (was 6)
    select array_agg(o.id),
           jsonb_agg(jsonb_build_object('user_id', o.user_id, 'type', o.type,
                                        'title', o.title, 'body', o.body, 'data', o.data))
      into v_ids, v_msgs
      from (select id, user_id, type, title, body, data
              from public.push_outbox
             where sent_at is null
             order by id
             limit 100
             for update skip locked) o;
    exit when v_ids is null;
    perform net.http_post(
      url     := cfg.url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', cfg.auth),
      body    := jsonb_build_object('type', 'MESSAGES', 'messages', v_msgs),
      timeout_milliseconds := 60000
    );
    update public.push_outbox set sent_at = now() where id = any(v_ids);
    v_sent := v_sent + 1;
  end loop;

  -- Keep the queues and the log small.
  delete from public.push_queue where sent_at < now() - interval '1 day';
  delete from public.push_governor_log where at < now() - interval '2 days';  -- 0159
  return v_sent;
end;
$$;
revoke all on function public.process_push_queue() from public, anon, authenticated;

-- 2. notify_push_batch: inbox fan-outs staggered like push_to_users (0155) ---------------
create or replace function public.notify_push_batch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ids    uuid[];
  v_total  int;
  v_chunks int;
  v_step   interval;
  i        int;
  c constant int := 100;
begin
  -- 0142 (D6): inbox rows written during quiet hours by the live_start fan-out
  -- are not pushed. Transaction-local; set only by run_live_start_fanout.
  if coalesce(current_setting('app.skip_push', true), '') = 'on' then
    return null;
  end if;
  -- 0159: the most recently active students first (they are the ones who open).
  select array_agg(n.id order by pr.last_opened_at desc nulls last, n.id)
    into v_ids
    from new_rows n
    left join public.profiles pr on pr.id = n.user_id;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then
    return null;
  end if;
  v_chunks := (v_total - 1) / c + 1;
  -- 0159: ≤ 7 s apart and the whole send within 10 minutes; chunk 0 goes now
  -- (so a single personal notification is not delayed).
  v_step := least(interval '7 seconds', interval '10 minutes' / v_chunks);
  for i in 0 .. v_chunks - 1 loop
    insert into public.push_queue (ids, send_after)
    values (v_ids[i * c + 1 : least((i + 1) * c, v_total)],
            case when i = 0 then null else now() + v_step * i end);
  end loop;
  return null;
exception when others then
  -- Same contract as 0009: a push hiccup must never roll back the inbox rows.
  return null;
end;
$$;
