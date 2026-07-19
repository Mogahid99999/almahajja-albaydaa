-- =============================================================================
-- 0103_backup_schema_fingerprint.sql
-- Backup & Restore — schema fingerprint for the manifest (extension of 0102).
--
-- The backup export is already SCHEMA-DRIVEN (0102: backup_table_order discovers
-- tables from pg_class/pg_constraint, export_table derives writable columns,
-- restore_tables excludes generated columns). This migration adds a
-- machine-readable SCHEMA FINGERPRINT so a backup records the exact table +
-- column shape it was taken against — used to reason about compatibility
-- (compatible / after_migration / not_supported) beyond the coarse
-- schema_version number, and to make "a newer app has extra tables/columns"
-- provably non-breaking.
--
-- backup_schema_fingerprint() returns, for every exportable table (same set +
-- order as backup_table_order, so it tracks new tables automatically):
--   { table, columns: [{ name, type, generated }] }
-- The client hashes this into the manifest and also stores it verbatim, so a
-- restore can diff backup-shape vs current-shape without guessing.
--
-- Idempotent. Append-only (0102 stays untouched).
-- =============================================================================

create or replace function public.backup_schema_fingerprint()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb := '[]'::jsonb;
  r_tbl record;
  v_cols jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Same table set + FK-safe order as the export, so the fingerprint always
  -- matches what actually gets backed up — including any newly added table.
  for r_tbl in
    select bt.ord, bt.table_name from public.backup_table_order() bt order by bt.ord
  loop
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'name', c.column_name,
                 'type', c.data_type,
                 -- writable = not a generated column (matches restore's insert set)
                 'generated', (c.is_generated <> 'NEVER')
               )
               order by c.ordinal_position
             ),
             '[]'::jsonb
           )
      into v_cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = r_tbl.table_name;

    v_result := v_result || jsonb_build_object(
      'table', r_tbl.table_name,
      'columns', v_cols
    );
  end loop;

  return v_result;
end; $$;

grant execute on function public.backup_schema_fingerprint() to authenticated;
