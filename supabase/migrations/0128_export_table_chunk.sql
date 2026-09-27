-- =============================================================================
-- 0128_export_table_chunk.sql
-- المَحجّة البَيْضَاء — «النسخ الاحتياطي» speed: ~10 min → a few minutes.
--
-- After 0124 a full backup is complete but slow: PostgREST's `max_rows: 1000`
-- caps every export_table response at 1000 ROWS, so notifications (~350k rows)
-- alone takes ~350 round trips at ~1.5 s each (8.5 min measured end-to-end).
--
-- export_table_chunk returns ONE row — a jsonb object holding up to 5000 table
-- rows pre-serialised as JSONL text — so max_rows (a row cap, not a size cap)
-- no longer limits the page. ~5× fewer round trips.
--
-- It is a thin wrapper over export_table (0124), which keeps doing the
-- is_admin() check, the backup-table allow-list, and the keyset cursor. The
-- cursor format is unchanged; `next` is the last row's pk (null when empty).
-- Lines are jsonb::text — the same JSON values the client used to
-- JSON.stringify (whitespace differs; restore parses each line).
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

create or replace function public.export_table_chunk(
  p_table text,
  p_after text default null,
  p_limit integer default 5000
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rows  int;
  v_next  text;
  v_jsonl text;
begin
  select count(*)::int,
         string_agg(e.row_json::text, E'\n' order by e.ord),
         (array_agg(e.pk order by e.ord desc))[1]
    into v_rows, v_jsonl, v_next
    from public.export_table(p_table, p_after, p_limit)
         with ordinality as e(pk, row_json, ord);

  return jsonb_build_object(
    'rows', v_rows,
    'next', v_next,
    'jsonl', coalesce(v_jsonl, '')
  );
end;
$function$;

revoke all on function public.export_table_chunk(text, text, integer) from public, anon;
grant execute on function public.export_table_chunk(text, text, integer) to authenticated;
