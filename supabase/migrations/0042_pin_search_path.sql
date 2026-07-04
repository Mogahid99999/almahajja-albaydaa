-- =============================================================================
-- 0042_pin_search_path.sql
-- المَحجّة البَيْضَاء — Security S4: pin search_path on set_updated_at.
--
-- Found by the Supabase security advisor (function_search_path_mutable):
-- every other function in 0001-0041 sets `search_path = public` explicitly,
-- but the original 0001 definition of set_updated_at (a plain updated_at
-- trigger, no dynamic SQL, no user input) missed it. Low risk in practice,
-- but pinning it closes the gap and matches the pattern everywhere else.
--
-- Append-only migration — 0001–0041 are never edited. Idempotent.
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
