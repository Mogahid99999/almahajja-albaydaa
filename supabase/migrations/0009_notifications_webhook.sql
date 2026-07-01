-- =============================================================================
-- 0009_notifications_webhook.sql
-- منصة دروس العلم الشرعي / المَحجّة البَيْضَاء — Notifications Phase B
--
-- Server push (shade delivery when the app is closed). The DB already fans out a
-- public.notifications row per student on publish / new-attachment (fanout_to_all,
-- 0007). This migration adds the Database Webhook half: on each notifications
-- INSERT, POST the new row to the `notify-on-publish` Edge Function, which looks
-- up the recipient's push_tokens and forwards to Expo Push → FCM.
--
-- Implemented with pg_net (the same mechanism Supabase's dashboard "Database
-- Webhooks" generate). The Authorization bearer is the project's PUBLIC anon key
-- (the same RLS-gated JWT shipped in the app bundle / .env) — it only satisfies
-- the Edge Function gateway's verify_jwt; the function itself runs with the
-- service role injected by the platform. No secret is stored here.
--
-- Append-only, idempotent (create-or-replace + drop-before-create). Never edit
-- 0001–0008.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Fire the Edge Function for each freshly-inserted notification row. Wrapped in
-- a function (not a raw http call in the trigger) so it's create-or-replace and
-- can swallow transient net errors without ever blocking the fan-out INSERT.
-- ---------------------------------------------------------------------------
create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url     := 'https://prpyxnxgkpspjoxvcaro.supabase.co/functions/v1/notify-on-publish',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBycHl4bnhna3BzcGpveHZjYXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDkzOTcsImV4cCI6MjA5Nzk4NTM5N30.ntadcSKDAo6X3uJsRCSELStG5_esmO-JZ-gBndvNr_A'
    ),
    body    := jsonb_build_object('type', 'INSERT', 'record', to_jsonb(NEW))
  );
  return NEW;
exception when others then
  -- Never let a push hiccup roll back the inbox INSERT.
  return NEW;
end;
$$;

drop trigger if exists notifications_push_webhook on public.notifications;
create trigger notifications_push_webhook
  after insert on public.notifications
  for each row execute function public.notify_push_on_notification();
