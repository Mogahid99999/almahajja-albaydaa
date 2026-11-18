-- =============================================================================
-- 0180: email the student their certificate once it is rendered.
--
-- The certificate service (vps/certs) claims rendered certificates, builds the email (image
-- inline, PDF attached, durable signed download/share links) and hands it to the Edge Function
-- send-certificate-email, which holds the Resend key. Everything here is service_role only.
--
-- Switch: app_config.certificate_email_enabled = 'true' (off by default).
-- Certificates issued before this migration are 'skipped': nobody gets a late email.
-- Statuses: pending → sending → sent | failed (retried with backoff, 5 attempts) | skipped
-- (no email address on the account, or the certificate stopped being valid before sending).
-- =============================================================================

-- Existing rows take 'skipped' from the column default; new rows default to 'pending'.
alter table public.certificates
  add column if not exists email_status text not null default 'skipped',
  add column if not exists email_attempts smallint not null default 0,
  add column if not exists email_claimed_at timestamptz,
  add column if not exists emailed_at timestamptz,
  add column if not exists email_error text;
alter table public.certificates alter column email_status set default 'pending';
alter table public.certificates drop constraint if exists certificates_email_status_check;
alter table public.certificates add constraint certificates_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

create index if not exists certificates_email_queue_idx
  on public.certificates (issued_at) where email_status in ('pending', 'sending', 'failed');

insert into public.app_config (key, value) values ('certificate_email_enabled', 'false')
on conflict (key) do nothing;

create or replace function public.claim_certificate_emails(p_limit int default 5)
returns table (id text, email text, snapshot jsonb, issue_date_text text, issued_at timestamptz,
               pdf_key text, preview_key text)
language plpgsql volatile security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  if coalesce((select value from public.app_config where key = 'certificate_email_enabled'), '') <> 'true' then
    return;
  end if;

  -- Nothing to send, ever: no usable address, or no longer valid.
  update public.certificates c
     set email_status = 'skipped',
         email_error = case when c.status <> 'valid' then 'not valid' else 'no email' end
   where c.email_status in ('pending', 'failed')
     and (c.pdf_key is not null or c.status <> 'valid')
     and (c.status <> 'valid'
          or not exists (select 1 from auth.users u
                          where u.id = c.user_id and not u.is_anonymous
                            and coalesce(u.email, '') like '%_@_%'));

  return query
  update public.certificates c
     set email_status = 'sending', email_claimed_at = now(), email_attempts = c.email_attempts + 1
    from auth.users u
   where u.id = c.user_id
     and c.id in (
       select x.id from public.certificates x
        where x.status = 'valid' and x.pdf_key is not null and x.email_attempts < 5
          and (x.email_status = 'pending'
               or (x.email_status = 'failed' and x.email_claimed_at < now() - interval '10 minutes' * x.email_attempts)
               -- a worker that died mid-send; Resend's idempotency key stops a double send
               or (x.email_status = 'sending' and x.email_claimed_at < now() - interval '10 minutes'))
        order by x.issued_at
        limit greatest(p_limit, 1)
        for update skip locked)
  returning c.id, u.email::text, c.snapshot, c.issue_date_text, c.issued_at, c.pdf_key, c.preview_key;
end $$;
revoke all on function public.claim_certificate_emails(int) from public, anon, authenticated;
grant execute on function public.claim_certificate_emails(int) to service_role;

create or replace function public.complete_certificate_email(p_id text, p_error text default null)
returns void
language sql volatile security definer set search_path = public as $$
  update public.certificates
     set email_status = case when p_error is null then 'sent' else 'failed' end,
         emailed_at   = case when p_error is null then now() else emailed_at end,
         email_error  = left(p_error, 500)
   where id = p_id and email_status = 'sending';
$$;
revoke all on function public.complete_certificate_email(text, text) from public, anon, authenticated;
grant execute on function public.complete_certificate_email(text, text) to service_role;

-- For the email's durable links (/d/{id}, /s/{id}): the service checks the link signature first,
-- then serves only a valid certificate, so revoking still closes the links.
create or replace function public.certificate_email_files(p_id text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pdf_key', pdf_key, 'preview_key', preview_key, 'title', snapshot ->> 'title')
    from public.certificates
   where id = upper(trim(p_id)) and status = 'valid' and pdf_key is not null;
$$;
revoke all on function public.certificate_email_files(text) from public, anon, authenticated;
grant execute on function public.certificate_email_files(text) to service_role;
