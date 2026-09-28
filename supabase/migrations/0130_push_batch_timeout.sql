-- =============================================================================
-- 0130_push_batch_timeout.sql
-- المَحجّة البَيْضَاء — BUGFIX: big sends land in the inbox but NO phone push.
--
-- 0122's notify_push_batch hands each 500-row chunk to notify-on-publish via
-- net.http_post with pg_net's DEFAULT 5 s timeout. A 500-row batch takes the
-- function ~9 s (re-read rows, token lookups, 5 sequential Expo calls), so
-- pg_net gave up on every one: prod 2026-09-28 07:00–08:24 logged 222 calls
-- «Timeout of 5000 ms reached … Request/Response time: 8963 ms» and zero
-- 200s for the reminder (10,576 inbox rows, no push) and the 07:00 cron
-- nudges. Small inserts (1–21 rows) still pushed, which hid it — every large
-- fan-out (reminders, lecture announcements, daily nudges) has been pushless
-- since 0122.
--
-- Fix, patched INTO the live function (drift-proof like 0125 — staging and
-- prod carry different URLs/keys in the body, so it is NOT re-created here):
--   * chunk 500 → 100 ids per call (~1–2 s each), and
--   * timeout_milliseconds := 60000 on net.http_post.
-- notify-on-publish now also retries Expo 429/5xx with backoff, since ~106
-- parallel calls can burst past Expo's per-project rate limit.
--
-- Append-only. Idempotent (skips a function already patched; raises if the
-- expected text is missing so a silent no-op can't happen).
-- =============================================================================

do $$
declare
  v_def text := pg_get_functiondef('public.notify_push_batch()'::regprocedure);
  v_new text;
begin
  if v_def ~ 'timeout_milliseconds' and v_def ~ 'c constant int := 100;' then
    raise notice '0130: notify_push_batch already patched';
    return;
  end if;

  if v_def !~ 'c constant int := 500;' then
    raise exception '0130: chunk-size line not found in notify_push_batch';
  end if;
  if v_def !~ $re$body\s*:=\s*jsonb_build_object\('type',\s*'BATCH',\s*'ids',\s*to_jsonb\(v_chunk\)\)$re$ then
    raise exception '0130: net.http_post body line not found in notify_push_batch';
  end if;

  v_new := replace(v_def, 'c constant int := 500;', 'c constant int := 100;');
  v_new := regexp_replace(
    v_new,
    $re$(body\s*:=\s*jsonb_build_object\('type',\s*'BATCH',\s*'ids',\s*to_jsonb\(v_chunk\)\))$re$,
    E'\\1,\n      timeout_milliseconds := 60000'
  );
  execute v_new;

  v_def := pg_get_functiondef('public.notify_push_batch()'::regprocedure);
  if v_def !~ 'timeout_milliseconds := 60000' or v_def !~ 'c constant int := 100;' then
    raise exception '0130: patch did not take';
  end if;
end $$;
