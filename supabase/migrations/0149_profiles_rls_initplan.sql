-- =============================================================================
-- 0149_profiles_rls_initplan.sql
-- المَحجّة البَيْضَاء — PERF: the profiles RLS policies called is_admin() once
-- PER ROW.
--
-- Every SECURITY INVOKER read of the caller's own profile — the
-- `(select gender from public.profiles where id = auth.uid())` inside
-- get_home_page, get_section_page, lecture_visible_to_viewer, … — ran as a
-- Seq Scan over ALL profiles, because RLS evaluates the policy qual
--   (id = auth.uid()) OR is_admin()      -- profiles_select
--   OR is_admin()                        -- profiles_admin_write (ALL)
-- before the query's own non-leakproof `id = auth.uid()`, so is_admin() (an
-- index lookup into profiles) ran for each of the 11k rows. Measured on prod
-- 2026-10-02 (EXPLAIN ANALYZE as a real student): 534 ms, 66,675 buffer hits,
-- 11,057 rows removed — linear in the user count. It made
-- lecture_visible_to_viewer ~370–790 ms and get_home_page ~1.1 s
-- (pg_stat_statements: ~85 h of DB time since June), which on the 0.5 GB
-- instance turned every push-driven app-open wave into swap thrashing.
--
-- Fix: the standard Supabase initPlan form — `(select auth.uid())` and
-- `(select public.is_admin())` are evaluated ONCE per statement. Same
-- semantics, same roles (ALTER POLICY keeps them). The same EXPLAIN with the
-- initPlan form: 0.06 ms.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or (select public.is_admin()));

alter policy profiles_admin_write on public.profiles
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
