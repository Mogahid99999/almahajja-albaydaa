-- =============================================================================
-- 0102_backup_restore.sql
-- Backup & Restore (النسخ الاحتياطي والاستعادة) — v1 backend.
--
-- Everything the admin-web backup page needs on the DB side:
--   • backup_log        — full audit trail of every backup/restore operation.
--   • restore_sessions  — a server-issued restore_id that scopes staged R2
--                         writes to restore-staging/{restore_id}/ (see the
--                         backup-media Edge Function). The client can never
--                         invent a restore_id; it must be minted here.
--   • export_*          — admin-gated, keyset-paginated table export (JSONL is
--                         assembled client-side from these rows).
--   • restore_tables    — admin-gated, single-transaction, FK-safe DB restore.
--
-- Design notes:
--   • Role gate is the EXISTING is_admin() — no super-admin role (per spec).
--   • Export/restore are SCHEMA-DRIVEN: the FK-safe table order is computed
--     from information_schema + pg_constraint at runtime (public base tables,
--     topologically sorted), so adding a table later needs no edit here. A
--     small deny-list keeps infra/audit tables out of the data backup.
--   • Consistency model: per-table (each export_table call is its own snapshot).
--     The manifest documents this; a maintenance/read-only window is the
--     operator's tool for a near-consistent capture. No fake global snapshot ts.
--   • RESTORE is destructive and runs as SECURITY DEFINER with a hard is_admin()
--     gate at the top of every function — the service role is never handed to
--     the client.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.backup_op_type as enum ('backup', 'restore');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.backup_op_status as enum (
    'pending', 'running', 'validating', 'uploading',
    'restoring', 'verifying', 'success', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.restore_mode as enum ('full_replace', 'merge');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.restore_session_status as enum (
    'open', 'staged', 'validated', 'activated', 'completed', 'failed', 'expired'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- backup_log — one row per backup/restore operation (the §17 audit trail).
-- Written ONLY by the SECURITY DEFINER functions below (and the Edge Function
-- via service role); admins may read.
-- ---------------------------------------------------------------------------
create table if not exists public.backup_log (
  id                    uuid primary key default gen_random_uuid(),
  operation_type        public.backup_op_type   not null,
  actor_id              uuid references auth.users (id) on delete set null,
  actor_name            text,
  status                public.backup_op_status not null default 'pending',
  file_name             text,
  size_bytes            bigint,
  table_counts          jsonb,
  media_count           integer,
  media_bytes           bigint,
  backup_format_version text,
  schema_version        text,
  app_version           text,
  restore_mode          public.restore_mode,
  restore_id            uuid,
  error_code            text,
  error_message         text,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz
);

create index if not exists backup_log_started_idx
  on public.backup_log (started_at desc);

-- ---------------------------------------------------------------------------
-- restore_sessions — server-issued restore_id, scopes staged R2 writes and
-- ties the whole restore to one admin session with an expiry.
-- ---------------------------------------------------------------------------
create table if not exists public.restore_sessions (
  restore_id  uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users (id) on delete cascade,
  status      public.restore_session_status not null default 'open',
  file_name   text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '2 hours')
);

create index if not exists restore_sessions_actor_idx
  on public.restore_sessions (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: admins read both tables; nobody writes directly (writes go through the
-- SECURITY DEFINER functions / service role).
-- ---------------------------------------------------------------------------
alter table public.backup_log       enable row level security;
alter table public.restore_sessions enable row level security;

drop policy if exists backup_log_admin_read on public.backup_log;
create policy backup_log_admin_read on public.backup_log
  for select to authenticated using (public.is_admin());

drop policy if exists restore_sessions_admin_read on public.restore_sessions;
create policy restore_sessions_admin_read on public.restore_sessions
  for select to authenticated using (public.is_admin());

-- No insert/update/delete policies → direct writes are denied for everyone
-- (SECURITY DEFINER functions below bypass RLS by design).
grant select on public.backup_log       to authenticated;
grant select on public.restore_sessions to authenticated;

-- ===========================================================================
-- Table ordering: FK-safe topological sort of public base tables.
-- Returns tables parents-first (safe INSERT order); reverse for TRUNCATE.
-- A deny-list keeps infra/audit tables out of the DATA backup — schema itself
-- is owned by migrations, and these tables must not be clobbered by a restore.
-- ===========================================================================
create or replace function public.backup_excluded_tables()
returns text[] language sql immutable as $$
  select array[
    'backup_log',        -- audit trail must survive a restore
    'restore_sessions',  -- transient restore state
    'schema_migrations', -- owned by the migration history, never data-restored
    'blocked_words'      -- moderation config; keep current, not backup's copy
  ]::text[];
$$;

-- Ordered list of public base tables, parents before children (Kahn's algo).
-- Self-references (e.g. sections.parent_id) are ignored for ordering — the
-- restore inserts a whole table at once, so intra-table order is handled by
-- deferring FK checks inside restore_tables' transaction.
create or replace function public.backup_table_order()
returns table (ord int, table_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tables text[];
  v_edges  record;
  v_deps   jsonb := '{}'::jsonb;      -- table -> array of tables it depends on
  v_remaining text[];
  v_ord int := 0;
  v_progress boolean;
  t text;
  d text;
  v_ready boolean;
begin
  -- All public base tables minus the deny-list.
  select array_agg(c.relname order by c.relname)
    into v_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname <> all (public.backup_excluded_tables());

  -- Build dependency edges from FKs (child depends on parent), skipping
  -- self-references and edges to excluded/non-public tables.
  for v_edges in
    select con.conrelid::regclass::text  as child,
           con.confrelid::regclass::text as parent
    from pg_constraint con
    join pg_class cc on cc.oid = con.conrelid
    join pg_namespace nc on nc.oid = cc.relnamespace
    join pg_class pc on pc.oid = con.confrelid
    join pg_namespace np on np.oid = pc.relnamespace
    where con.contype = 'f'
      and nc.nspname = 'public'
      and np.nspname = 'public'
      and con.conrelid <> con.confrelid
  loop
    -- strip the "public." schema prefix regclass may add
    declare
      child_t  text := split_part(v_edges.child,  '.', greatest(1, array_length(string_to_array(v_edges.child, '.'), 1)));
      parent_t text := split_part(v_edges.parent, '.', greatest(1, array_length(string_to_array(v_edges.parent, '.'), 1)));
    begin
      if child_t = any(v_tables) and parent_t = any(v_tables) then
        v_deps := jsonb_set(
          v_deps,
          array[child_t],
          coalesce(v_deps -> child_t, '[]'::jsonb) || to_jsonb(parent_t),
          true
        );
      end if;
    end;
  end loop;

  v_remaining := v_tables;

  -- Kahn: repeatedly emit tables whose deps are all already emitted.
  loop
    exit when array_length(v_remaining, 1) is null;
    v_progress := false;
    foreach t in array v_remaining loop
      v_ready := true;
      for d in select jsonb_array_elements_text(coalesce(v_deps -> t, '[]'::jsonb)) loop
        if d = any(v_remaining) then
          v_ready := false;
          exit;
        end if;
      end loop;
      if v_ready then
        v_ord := v_ord + 1;
        ord := v_ord;
        table_name := t;
        return next;
        v_remaining := array_remove(v_remaining, t);
        v_progress := true;
      end if;
    end loop;
    -- Cycle guard: if a full pass made no progress, emit the rest as-is
    -- (restore_tables defers FK checks, so a cycle still restores correctly).
    if not v_progress then
      foreach t in array v_remaining loop
        v_ord := v_ord + 1;
        ord := v_ord;
        table_name := t;
        return next;
      end loop;
      exit;
    end if;
  end loop;
end; $$;

grant execute on function public.backup_excluded_tables() to authenticated;
grant execute on function public.backup_table_order()      to authenticated;

-- ===========================================================================
-- EXPORT — admin-gated, keyset-paginated per-table row fetch.
-- The client walks each table (from backup_table_order) calling this with an
-- increasing cursor until it gets fewer than p_limit rows, streaming JSONL to
-- the ZIP. Rows come back as jsonb so the client writes them verbatim.
--
-- Keyset cursor: uses the table's primary key when it's a single column;
-- falls back to ctid-ordered OFFSET only if there is no usable single-col PK
-- (none of our tables hit that path today, but it keeps the export total).
-- ===========================================================================
create or replace function public.export_table(
  p_table  text,
  p_after  text default null,   -- last PK value seen (text-encoded), null = start
  p_limit  int  default 1000
)
returns table (pk text, row_json jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_pk_col text;
  v_sql    text;
  v_limit  int := least(greatest(coalesce(p_limit, 1000), 1), 5000);
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

  -- Single-column primary key, if any (only when the PK has exactly one column).
  select a.attname into v_pk_col
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = ('public.' || quote_ident(p_table))::regclass
    and i.indisprimary
    and cardinality(i.indkey::int2[]) = 1;

  if v_pk_col is not null then
    v_sql := format(
      'select (%1$I)::text as pk, to_jsonb(t) as row_json
         from public.%2$I t
        where ($1 is null or (%1$I)::text > $1)
        order by (%1$I)::text
        limit %3$s',
      v_pk_col, p_table, v_limit
    );
    return query execute v_sql using p_after;
  else
    -- Composite/no PK: stable ctid order, OFFSET cursor (p_after = offset text).
    -- pk is returned as the next offset so the client keeps paging.
    return query execute
      format(
        'select (coalesce($1::int, 0) + row_number() over ())::text as pk,
                to_jsonb(t) as row_json
           from public.%1$I t
          order by t.ctid
          limit %2$s offset coalesce($1::int, 0)',
        p_table, v_limit
      )
      using p_after;
  end if;
end; $$;

-- Row counts per table, for the manifest + post-restore verification.
create or replace function public.export_table_counts()
returns table (table_name text, row_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare r record; n bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in select bt.table_name from public.backup_table_order() bt loop
    execute format('select count(*) from public.%I', r.table_name) into n;
    table_name := r.table_name;
    row_count  := n;
    return next;
  end loop;
end; $$;

-- Current sequence values, so a restore can realign identity/serial columns.
create or replace function public.export_sequences()
returns table (seq_name text, last_value bigint)
language plpgsql stable security definer set search_path = public as $$
declare r record; v bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in
    select n.nspname as sch, c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname = 'public'
  loop
    execute format('select last_value from %I.%I', r.sch, r.name) into v;
    seq_name := r.name;
    last_value := v;
    return next;
  end loop;
end; $$;

grant execute on function public.export_table(text, text, int) to authenticated;
grant execute on function public.export_table_counts()          to authenticated;
grant execute on function public.export_sequences()             to authenticated;

-- ===========================================================================
-- RESTORE SESSION lifecycle — the client asks for a restore_id here; the
-- Edge Function validates writes against it. Admin-gated.
-- ===========================================================================
create or replace function public.start_restore_session(p_file_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.restore_sessions (actor_id, file_name)
  values (auth.uid(), p_file_name)
  returning restore_id into v_id;
  return v_id;
end; $$;

create or replace function public.set_restore_session_status(
  p_restore_id uuid, p_status public.restore_session_status)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.restore_sessions
     set status = p_status
   where restore_id = p_restore_id and actor_id = auth.uid();
end; $$;

-- Is a restore_id valid, owned by the caller, and unexpired? Used by the Edge
-- Function (via the caller's JWT) to gate staged writes.
create or replace function public.is_restore_session_active(p_restore_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restore_sessions
    where restore_id = p_restore_id
      and actor_id = auth.uid()
      and expires_at > now()
      and status not in ('completed', 'failed', 'expired')
  ) and public.is_admin();
$$;

grant execute on function public.start_restore_session(text)                                   to authenticated;
grant execute on function public.set_restore_session_status(uuid, public.restore_session_status) to authenticated;
grant execute on function public.is_restore_session_active(uuid)                                to authenticated;

-- ===========================================================================
-- RESTORE (database) — single transaction, FK-safe, all-or-nothing.
-- The client sends one table's rows at a time as a jsonb array; each call runs
-- in its own transaction BUT the whole set is only "activated" after every
-- table restores successfully AND row counts verify (the client orchestrates
-- and, on any failure, calls restore_abort). For true all-or-nothing across
-- ALL tables we expose restore_tables(payload jsonb) which does the entire DB
-- in ONE transaction when the payload fits; the client uses that for our data
-- sizes (2–5 GB media, but the DB itself is small).
--
-- p_payload shape:
--   { "tables": [ { "name": "profiles", "rows": [ {...}, ... ] }, ... ],
--     "sequences": [ { "seq_name": "...", "last_value": N }, ... ] }
-- Tables are restored in backup_table_order(); FK constraints are set
-- DEFERRED so intra/inter-table order and self-references never block the load.
-- ===========================================================================
create or replace function public.restore_tables(p_payload jsonb, p_mode public.restore_mode default 'full_replace')
returns table (out_table text, out_restored bigint, out_expected bigint)
language plpgsql security definer set search_path = public as $$
declare
  r_order   record;
  v_tab     jsonb;
  v_name    text;
  v_rows    jsonb;
  v_cols    text;
  v_count   bigint;
  v_expected bigint;
  v_seq     jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_mode <> 'full_replace' then
    raise exception 'only full_replace is supported in v1' using errcode = '0A000';
  end if;

  -- Defer every deferrable FK for the duration of this transaction so we can
  -- truncate + reload in any order without transient violations.
  set constraints all deferred;

  -- 1) TRUNCATE all backup tables in REVERSE FK order (children first).
  for r_order in
    select bt.table_name from public.backup_table_order() bt order by bt.ord desc
  loop
    execute format('truncate table public.%I cascade', r_order.table_name);
  end loop;

  -- 2) INSERT each table's rows (parents first).
  for r_order in
    select bt.table_name from public.backup_table_order() bt order by bt.ord asc
  loop
    v_name := r_order.table_name;
    v_rows := null;
    for v_tab in select * from jsonb_array_elements(p_payload -> 'tables') loop
      if v_tab ->> 'name' = v_name then
        v_rows := v_tab -> 'rows';
        exit;
      end if;
    end loop;

    v_expected := coalesce(jsonb_array_length(v_rows), 0);

    if v_rows is not null and jsonb_array_length(v_rows) > 0 then
      -- Column list from the destination table (so extra keys in the backup are
      -- ignored and missing ones take their default). GENERATED columns (e.g.
      -- the search_vec tsvector, migration 0068) are EXCLUDED — Postgres rejects
      -- an explicit insert into them, and they recompute themselves anyway.
      select string_agg(quote_ident(c.column_name), ', ')
        into v_cols
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_name
        and c.is_generated = 'NEVER';

      execute format(
        'insert into public.%1$I (%2$s)
           select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)',
        v_name, v_cols
      ) using v_rows;
    end if;

    execute format('select count(*) from public.%I', v_name) into v_count;

    out_table := v_name;
    out_restored := v_count;
    out_expected := v_expected;
    return next;
  end loop;

  -- 3) Realign sequences.
  if p_payload ? 'sequences' then
    for v_seq in select * from jsonb_array_elements(p_payload -> 'sequences') loop
      begin
        perform setval(
          ('public.' || quote_ident(v_seq ->> 'seq_name'))::regclass,
          greatest((v_seq ->> 'last_value')::bigint, 1),
          true
        );
      exception when others then
        -- a sequence in the backup that no longer exists — skip, non-fatal
        null;
      end;
    end loop;
  end if;

  -- Any exception above aborts the whole function's transaction → nothing is
  -- committed → the live DB is untouched (the §9 "no partial restore" rule).
end; $$;

grant execute on function public.restore_tables(jsonb, public.restore_mode) to authenticated;

-- ===========================================================================
-- backup_log writers — SECURITY DEFINER so the client can append/close its own
-- audit rows without a direct-write policy. actor is always auth.uid().
-- ===========================================================================
create or replace function public.backup_log_start(
  p_operation public.backup_op_type,
  p_file_name text default null,
  p_restore_mode public.restore_mode default null,
  p_restore_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select display_name into v_name from public.profiles where id = auth.uid();
  insert into public.backup_log (
    operation_type, actor_id, actor_name, status, file_name, restore_mode, restore_id
  ) values (
    p_operation, auth.uid(), v_name, 'running', p_file_name, p_restore_mode, p_restore_id
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.backup_log_update(
  p_id uuid,
  p_status public.backup_op_status default null,
  p_size_bytes bigint default null,
  p_table_counts jsonb default null,
  p_media_count int default null,
  p_media_bytes bigint default null,
  p_backup_format_version text default null,
  p_schema_version text default null,
  p_app_version text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_finished boolean default false
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.backup_log set
    status                = coalesce(p_status, status),
    size_bytes            = coalesce(p_size_bytes, size_bytes),
    table_counts          = coalesce(p_table_counts, table_counts),
    media_count           = coalesce(p_media_count, media_count),
    media_bytes           = coalesce(p_media_bytes, media_bytes),
    backup_format_version = coalesce(p_backup_format_version, backup_format_version),
    schema_version        = coalesce(p_schema_version, schema_version),
    app_version           = coalesce(p_app_version, app_version),
    error_code            = coalesce(p_error_code, error_code),
    error_message         = coalesce(p_error_message, error_message),
    finished_at           = case when p_finished then now() else finished_at end
  where id = p_id and actor_id = auth.uid();
end; $$;

grant execute on function public.backup_log_start(public.backup_op_type, text, public.restore_mode, uuid) to authenticated;
grant execute on function public.backup_log_update(
  uuid, public.backup_op_status, bigint, jsonb, int, bigint, text, text, text, text, text, boolean
) to authenticated;
