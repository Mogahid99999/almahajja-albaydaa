-- =============================================================================
-- 0124_export_table_keyset.sql
-- المَحجّة البَيْضَاء — «النسخ الاحتياطي» broke, and was quietly losing rows
-- before it broke. Two bugs in export_table (0102), one fix.
--
-- BUG 1 — the backup times out (visible: «canceling statement due to statement
-- timeout», POST /rest/v1/rpc/export_table → 500, ZIP dies on
-- database/notifications.jsonl).
-- The single-PK branch ordered by the PK *cast to text*:
--     where ($1 is null or (id)::text > $1) order by (id)::text
-- `(id)::text` is not what notifications_pkey indexes, so every page did a
-- parallel seq scan plus an external merge sort of the whole table. Measured on
-- prod for ONE 2000-row page of notifications (348k rows):
--     order by (id)::text  → seq scan + sort spilling 164 MB to disk, 10,793 ms
--     order by id          → Index Scan using notifications_pkey,      364 ms
-- 10.8 s per page against an 8 s statement_timeout — and notifications needs
-- ~174 pages. Casting the CURSOR to the column's type instead of the column to
-- text keeps the index in play.
--
-- BUG 2 — silent row loss, worse than the outage because it looked like it
-- worked. The composite/no-PK branch numbered rows with
--     (coalesce($1::int,0) + row_number() over ()) … limit N offset $1
-- but a window function is evaluated BEFORE OFFSET, so row_number() counts from
-- the start of the whole table, not from the start of the page. Verified on
-- prod with push_tokens: page 2 returned the right rows labelled pk 7,8,9
-- instead of 4,5,6. The client feeds the last pk back as the next offset
-- (src/api/backup.ts), so each page skipped a widening band of rows and the
-- loop ended early on a short page. Every composite-PK table over one page was
-- affected: weekly_goal_state (41,853), user_lecture_progress (18,004),
-- daily_listening (11,942), push_tokens (7,702), user_badges (3,055),
-- celebrated (2,741). Existing ZIPs taken before this migration are INCOMPLETE
-- for those tables — re-take any backup you intend to rely on.
--
-- THE FIX — one keyset path for every table, built from the real PK columns.
-- Rows are ordered by the PK exactly as the PK index stores them, and the
-- cursor is a JSON array of that row's PK values, cast back to the column types
-- on the next call. Row-wise comparison `(a,b) > (x,y)` is index-friendly, so
-- page N costs the same as page 1 — no sort, no OFFSET scan, no drift if rows
-- are inserted mid-backup. `pk` stays an opaque cursor string, which is all the
-- client ever does with it, so no app release is needed.
--
-- Append-only, idempotent. Never edit 0001–0123.
-- =============================================================================

create or replace function public.export_table(
  p_table text,
  p_after text default null,
  p_limit integer default 1000
)
returns table (pk text, row_json jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cols    text[];
  v_types   text[];
  v_limit   int := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_row     text;   -- t.c1, t.c2
  v_cursor  text;   -- ($1::jsonb->>0)::uuid, ($1::jsonb->>1)::date
  v_pk      text;   -- t.c1::text, t.c2::text
  v_sql     text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Only allow tables that are in the backup set (prevents reading arbitrary
  -- tables, e.g. auth.* or the deny-list, through this function).
  if not exists (
    select 1 from public.backup_table_order() bt where bt.table_name = p_table
  ) then
    raise exception 'table % is not exportable', p_table using errcode = '42P01';
  end if;

  -- PK columns in index order, with their types — this is the sort key, so it
  -- matches the PK index for one column or twenty.
  select array_agg(a.attname order by k.ord),
         array_agg(format_type(a.atttypid, a.atttypmod) order by k.ord)
    into v_cols, v_types
    from pg_index i
    cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = ('public.' || quote_ident(p_table))::regclass
     and i.indisprimary;

  if v_cols is null then
    -- No primary key at all: fall back to ctid order with an offset cursor.
    -- The window now runs over the already-paged subquery, so row_number()
    -- restarts at 1 per page and the cursor advances by exactly one page
    -- (this is what Bug 2 got wrong).
    return query execute format(
      'select (coalesce($1::int, 0) + row_number() over ())::text as pk,
              to_jsonb(t) as row_json
         from (select * from public.%1$I order by ctid
                limit %2$s offset coalesce($1::int, 0)) t',
      p_table, v_limit
    ) using p_after;
    return;
  end if;

  select string_agg(format('t.%I', c.col), ', ' order by c.ord),
         string_agg(format('($1::jsonb->>%s)::%s', c.ord - 1, c.typ), ', ' order by c.ord),
         string_agg(format('t.%I::text', c.col), ', ' order by c.ord)
    into v_row, v_cursor, v_pk
    from unnest(v_cols, v_types) with ordinality as c(col, typ, ord);

  v_sql := format(
    'select jsonb_build_array(%1$s)::text as pk, to_jsonb(t) as row_json
       from public.%2$I t
      where ($1 is null or (%3$s) > (%4$s))
      order by %3$s
      limit %5$s',
    v_pk, p_table, v_row, v_cursor, v_limit
  );
  return query execute v_sql using p_after;
end;
$function$;
