-- A device token belongs to the account that registered it last. Signing in
-- from a guest session used to leave the guest's row behind, so every fan-out
-- push reached that device twice. Enforced here so builds already in users'
-- hands are covered on their next registration.

-- Rows are operational and rebuilt by the app; keep the newest per token.
delete from public.push_tokens p
using public.push_tokens newer
where newer.token = p.token
  and (newer.updated_at, newer.user_id) > (p.updated_at, p.user_id);

create index if not exists push_tokens_token_idx on public.push_tokens (token);

create or replace function public.push_token_single_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_tokens
  where token = new.token and user_id <> new.user_id;
  return new;
end;
$$;

revoke all on function public.push_token_single_owner() from public, anon, authenticated;

drop trigger if exists push_tokens_single_owner on public.push_tokens;
create trigger push_tokens_single_owner
  before insert or update of token, user_id on public.push_tokens
  for each row execute function public.push_token_single_owner();
