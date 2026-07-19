-- =============================================================================
-- 0104 · Achievement celebrations — dedup state (V20 · §15)
--
-- The unified Achievement Celebration Modal must show any one achievement AT MOST
-- ONCE per user, ever, across all their devices (source §15 "لا يظهر الإنجاز نفسه
-- أكثر من مرة وتُحفظ حالته في قاعدة البيانات"). This migration adds the server-side
-- claim so the dedup can't be defeated by two devices racing or a reinstall.
--
--   * public.celebrated(user_id, event_key)     — one row per celebrated event.
--   * public.try_claim_celebration(p_key text)  — atomically claims a key; returns
--     true exactly once (the first caller), false on every later call. The client
--     enqueues the modal ONLY when this returns true.
--
-- `event_key` is an app-defined stable string, unique per achievement instance:
--   'badge:completed_25' · 'week:2026-W29' · 'series:<uuid>' · 'streak:30' · …
-- Rules for what each key means live in TypeScript (src/constants/badges.ts etc.),
-- exactly like the badge catalog — this table only records "already celebrated".
--
-- Mirrors the once-per-week claim pattern of try_claim_goal_congrats (0013):
-- security invoker, own rows only, insert-on-conflict-do-nothing + `found`.
-- Append-only, idempotent. Never edit an applied migration.
-- =============================================================================

-- --- dedup state -------------------------------------------------------------
create table if not exists public.celebrated (
  user_id      uuid not null references auth.users (id) on delete cascade,
  event_key    text not null,
  celebrated_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

alter table public.celebrated enable row level security;

-- Own rows only — a student can read/insert their own celebration receipts, never
-- another user's. No update/delete is granted: a celebration receipt is permanent
-- (that's the whole point — it must never fire twice).
drop policy if exists celebrated_own on public.celebrated;
create policy celebrated_own on public.celebrated
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert on public.celebrated to authenticated;

-- --- atomic claim ------------------------------------------------------------
-- True only the FIRST time a given (user, event_key) is claimed; false forever
-- after. `security invoker` + the own-rows policy keep it scoped to the caller.
-- The insert-on-conflict-do-nothing + `found` makes the claim atomic even if two
-- devices call concurrently: exactly one insert wins, so exactly one `true`.
create or replace function public.try_claim_celebration(p_key text)
returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  if p_key is null or length(trim(p_key)) = 0 then
    return false;
  end if;
  insert into public.celebrated (user_id, event_key)
    values (auth.uid(), p_key)
    on conflict (user_id, event_key) do nothing;
  return found;
end;
$$;

grant execute on function public.try_claim_celebration(text) to authenticated;
