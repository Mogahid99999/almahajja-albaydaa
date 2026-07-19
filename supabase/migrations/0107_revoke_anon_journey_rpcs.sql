-- =============================================================================
-- 0107 · Revoke anon execute on the V20 journey RPCs (security hygiene)
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, so 0104–0106
-- left `try_claim_celebration`, `get_resume_card`, and `get_badge_metrics`
-- callable by the `anon` role — unlike every other authenticated-only RPC in this
-- project (get_journey_summary, save_activity, … all show anon=false). Although
-- they are `security invoker` and return nothing for an anon caller (RLS +
-- auth.uid() is null), matching the project convention removes the surprise and
-- keeps the surface minimal.
--
-- Revoke from PUBLIC (which is what the implicit grant targets) and from anon
-- explicitly, then re-affirm the intended grant to authenticated. Append-only,
-- idempotent.
-- =============================================================================

revoke execute on function public.try_claim_celebration(text) from public, anon;
revoke execute on function public.get_resume_card()          from public, anon;
revoke execute on function public.get_badge_metrics()        from public, anon;

grant execute on function public.try_claim_celebration(text) to authenticated;
grant execute on function public.get_resume_card()          to authenticated;
grant execute on function public.get_badge_metrics()        to authenticated;
