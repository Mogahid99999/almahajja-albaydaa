-- =============================================================================
-- 0122_batch_push_fanout.sql
-- المَحجّة البَيْضَاء — publishing a lecture stopped working: batch the push
-- fan-out instead of one HTTP call per recipient.
--
-- THE BUG
-- Publishing a lecture runs notify_lecture_published → fanout_to_all, which
-- inserts ONE public.notifications row per student. 0009 then hung a FOR EACH
-- ROW trigger on that table which calls net.http_post() — so a single INSERT
-- statement queued one Edge Function request per student. At 9,988 students
-- that statement measured **27,205 ms**, against the 8 s statement_timeout the
-- `authenticated` role carries. Postgres cancelled it (SQLSTATE 57014) and
-- PostgREST surfaced that as `500` on POST /rest/v1/lectures, so the lecture
-- row never committed and the admin upload form failed after the audio had
-- already reached R2. Same wall for new attachments and for a broadcast aimed
-- at every student. Measured on prod, in a rolled-back transaction:
--   with the per-row webhook  … 27,205 ms   (9,988 rows)
--   with the webhook skipped  …  1,276 ms   (same 9,988 rows)
-- i.e. ~26 s of the 27 s was the 9,988 individual net.http_post() calls, not
-- the insert. pg_net itself was healthy (empty queue) — it is the per-row
-- design that stopped fitting as the audience grew.
--
-- THE FIX
-- Replace the per-row trigger with a STATEMENT-level trigger that reads the
-- transition table and posts the new rows' ids in chunks of 500. One fan-out
-- to ~10 k students now queues ~20 requests instead of ~10,000, and the
-- publishing transaction is back to the ~1.3 s the plain INSERT costs.
-- notify-on-publish accepts the batch envelope {"type":"BATCH","ids":[…]},
-- resolves recipients itself and sends to Expo in chunks of 100 (Expo's own
-- per-request limit). Deploy that function BEFORE applying this migration.
--
-- Who gets notified is deliberately unchanged (owner's call): every student
-- still receives the inbox row, every registered device still receives a push.
--
-- notify_push_on_notification (0009) is intentionally LEFT IN PLACE, unused —
-- re-creating its trigger is the one-statement rollback if this ever needs
-- reverting.
--
-- Append-only, idempotent. Never edit 0001–0121.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- One HTTP request per ≤500 freshly-inserted notifications, instead of one per
-- row. `new_rows` is the AFTER INSERT transition table, so a single-row insert
-- (a Q&A answer, a buddy request) still posts exactly one request — the batch
-- path is simply a batch of one, which keeps every other caller unchanged.
--
-- Chunked because the whole id list travels as a JSON body: 500 uuids ≈ 19 KB,
-- comfortably inside pg_net's limits, and it lets the Edge Function's own work
-- (token lookup, Expo POSTs) run in parallel across invocations.
--
-- The bearer is the project's PUBLIC anon key, exactly as 0009 used it: it only
-- satisfies the Edge Function gateway's verify_jwt, while the function itself
-- runs with the platform-injected service role. No secret is stored here.
-- ---------------------------------------------------------------------------
create or replace function public.notify_push_batch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ids   uuid[];
  v_chunk uuid[];
  v_total int;
  i       int;
  c constant int := 500;
begin
  select array_agg(id) into v_ids from new_rows;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then
    return null;
  end if;

  for i in 0 .. (v_total - 1) / c loop
    v_chunk := v_ids[i * c + 1 : least((i + 1) * c, v_total)];
    perform net.http_post(
      url     := 'https://prpyxnxgkpspjoxvcaro.supabase.co/functions/v1/notify-on-publish',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBycHl4bnhna3BzcGpveHZjYXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDkzOTcsImV4cCI6MjA5Nzk4NTM5N30.ntadcSKDAo6X3uJsRCSELStG5_esmO-JZ-gBndvNr_A'
      ),
      body    := jsonb_build_object('type', 'BATCH', 'ids', to_jsonb(v_chunk))
    );
  end loop;

  return null;
exception when others then
  -- Same contract as 0009: a push hiccup must never roll back the inbox rows.
  return null;
end;
$$;

-- The per-row webhook is what made publishing impossible — drop it.
drop trigger if exists notifications_push_webhook on public.notifications;

drop trigger if exists notifications_push_batch on public.notifications;
create trigger notifications_push_batch
  after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function public.notify_push_batch();

-- ---------------------------------------------------------------------------
-- Launcher badge, batched. The old function counted a recipient's unread
-- new_lecture rows with one query per push; a 10 k fan-out would now mean 10 k
-- COUNT round trips from the Edge Function. This returns every count the batch
-- needs in a single call. Served by notifications_user_idx (user_id, …).
--
-- service_role only: it reads across users, so it must never be reachable with
-- an anon or authenticated JWT.
-- ---------------------------------------------------------------------------
create or replace function public.push_unread_new_lecture_counts(p_user_ids uuid[])
returns table (user_id uuid, unread integer)
language sql
stable
security definer
set search_path = public
as $$
  select n.user_id, count(*)::int
    from public.notifications n
   where n.user_id = any(p_user_ids)
     and n.type = 'new_lecture'
     and n.read_at is null
   group by n.user_id;
$$;

revoke all on function public.push_unread_new_lecture_counts(uuid[]) from public;
revoke all on function public.push_unread_new_lecture_counts(uuid[]) from anon;
revoke all on function public.push_unread_new_lecture_counts(uuid[]) from authenticated;
grant execute on function public.push_unread_new_lecture_counts(uuid[]) to service_role;
