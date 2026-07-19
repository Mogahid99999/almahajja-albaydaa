-- =============================================================================
-- 0113 · Buddy nudges + canned encouragement (V20 · §13, §14)
--
-- §14 Encouragement: a student sends a FIXED canned phrase to a buddy, at most
--     once per 24h per buddy. No free text, no message log/thread (just a rate-
--     limit row + a delivered notification). `buddy_encouragements` enforces the
--     cap; send_encouragement inserts the notification.
--
-- §13 Nudges: dispatch_buddy_nudges() runs a few times a day (time windows via
--     the cron schedule below) and notifies students about a buddy's real
--     progress on a shared goal — buddy finished their share, you're both close,
--     two days left, both completed. Honors quiet hours (23:00–05:00 UTC+3), the
--     'buddy_activity' pref, and a per-day cap: ≤ 3 buddy notifications/day and
--     ≤ 1 per (buddy) per day (tracked in buddy_nudge_log). Also settles finished
--     goals so completion is timely.
--
-- Reuses the existing 'buddy_activity' notification type + the notifications
-- table insert pattern. Append-only, idempotent.
-- =============================================================================

-- ── §14 encouragement rate-limit ────────────────────────────────────────────
create table if not exists public.buddy_encouragements (
  id           uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id   uuid not null references auth.users (id) on delete cascade,
  phrase_key   text not null,
  sent_at      timestamptz not null default now()
);
create index if not exists buddy_encouragements_pair_idx
  on public.buddy_encouragements (from_user_id, to_user_id, sent_at desc);

alter table public.buddy_encouragements enable row level security;
-- Own SENT rows readable (for the 24h guard); inserts go through the RPC only.
drop policy if exists buddy_encouragements_own on public.buddy_encouragements;
create policy buddy_encouragements_own on public.buddy_encouragements
  for select to authenticated using (from_user_id = auth.uid());
grant select on public.buddy_encouragements to authenticated;

-- The 8 fixed phrases (source §14). Kept server-side too so send_encouragement
-- can validate the key and render the delivered notification body.
create or replace function public.encouragement_phrase(p_key text)
returns text language sql immutable set search_path = public as $$
  select case p_key
    when 'p1' then 'بارك الله في سعيك ونفعك بما تعلمت.'
    when 'p2' then 'نفعنا الله بهذه الرفقة وأعاننا على الاستمرار.'
    when 'p3' then 'نسأل الله أن يجمعنا على الخير وفي الجنة.'
    when 'p4' then 'أعانك الله على مواصلة طلب العلم.'
    when 'p5' then 'بقي القليل على هدفنا، بارك الله في همتك.'
    when 'p6' then 'هيا نواصل رحلتنا ولو بالقليل.'
    when 'p7' then 'زادك الله علماً نافعاً وعملاً صالحاً.'
    when 'p8' then 'أسأل الله أن يثبتنا وإياك على طريق العلم.'
    else null
  end;
$$;

-- Send a canned encouragement. Validates: the two are accepted buddies, the key
-- is one of the 8, and no encouragement was sent to THIS buddy in the last 24h.
create or replace function public.send_encouragement(p_to_user_id uuid, p_phrase_key text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_body   text := public.encouragement_phrase(p_phrase_key);
  v_name   text;
begin
  if v_body is null then
    raise exception 'عبارة غير معروفة';
  end if;
  if not exists (select 1 from public.buddies_of(v_me) b where b = p_to_user_id) then
    raise exception 'ليس رفيقاً مقبولاً';
  end if;
  if exists (
    select 1 from public.buddy_encouragements
     where from_user_id = v_me and to_user_id = p_to_user_id
       and sent_at > now() - interval '24 hours'
  ) then
    raise exception 'يمكنك تشجيع رفيقك مرة واحدة كل ٢٤ ساعة';
  end if;

  insert into public.buddy_encouragements (from_user_id, to_user_id, phrase_key)
    values (v_me, p_to_user_id, p_phrase_key);

  select display_name into v_name from public.profiles where id = v_me;
  insert into public.notifications (user_id, type, title, body, data)
    values (
      p_to_user_id, 'buddy_activity',
      coalesce(v_name, 'رفيقك') || ' يشجعك',
      v_body,
      jsonb_build_object('route', '/(student)/journey')
    );
end;
$$;
revoke all on function public.send_encouragement(uuid, text) from public, anon;
grant execute on function public.send_encouragement(uuid, text) to authenticated;

-- ── §13 nudge log (per-day cap) ─────────────────────────────────────────────
create table if not exists public.buddy_nudge_log (
  user_id     uuid not null references auth.users (id) on delete cascade,
  buddy_id    uuid not null,
  goal_id     uuid,
  kind        text not null,           -- 'buddy_done' | 'both_close' | 'two_days' | 'completed'
  day         date not null default current_date,
  created_at  timestamptz not null default now(),
  primary key (user_id, buddy_id, goal_id, kind, day)
);

-- Dispatcher — a few runs/day (see schedule). Sends at most one row per
-- (user, buddy) per day and ≤ 3 buddy notifications/user/day, honoring quiet
-- hours + the 'buddy_activity' pref. Settles finished goals first.
create or replace function public.dispatch_buddy_nudges()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_local_hour int := extract(hour from now() + interval '3 hours')::int;
  v_sent int := 0;
  r record;
  v_me_share int;
  v_buddy_share int;
  v_kind text;
  v_title text;
  v_today_count int;
  v_pref boolean;
begin
  -- Quiet hours 23:00–05:00 (UTC+3), same convention as the other buddy crons.
  if v_local_hour >= 23 or v_local_hour < 5 then
    return 0;
  end if;

  perform public.settle_buddy_goals();

  -- One candidate row per (recipient, goal) for active/just-completed goals.
  for r in
    select g.id as goal_id, g.metric, g.target, g.starts_on, g.ends_on, g.status,
           rec.uid as recipient, other.uid as buddy_id
      from public.buddy_goals g
      cross join lateral (values (g.a_user_id), (g.b_user_id)) as rec(uid)
      cross join lateral (values (case when rec.uid = g.a_user_id then g.b_user_id else g.a_user_id end)) as other(uid)
     where g.status in ('active', 'completed')
       and g.ends_on >= current_date - 1
  loop
    -- Respect the recipient's buddy_activity pref (missing row = default ON).
    select enabled into v_pref from public.notification_prefs
      where user_id = r.recipient and type = 'buddy_activity';
    if v_pref is not null and v_pref = false then
      continue;
    end if;

    -- Daily cap: ≤ 3 total, and ≤ 1 per (recipient, buddy) per day.
    select count(*) into v_today_count from public.buddy_nudge_log
      where user_id = r.recipient and day = current_date;
    if v_today_count >= 3 then continue; end if;
    if exists (
      select 1 from public.buddy_nudge_log
       where user_id = r.recipient and buddy_id = r.buddy_id and day = current_date
    ) then continue; end if;

    v_me_share := public.buddy_goal_share(r.recipient, r.metric, r.starts_on, least(current_date, r.ends_on));
    v_buddy_share := public.buddy_goal_share(r.buddy_id, r.metric, r.starts_on, least(current_date, r.ends_on));

    -- Pick the most relevant single nudge for this goal.
    if r.status = 'completed' then
      v_kind := 'completed';
      v_title := 'اكتمل هدف الرفقة — نسأل الله أن ينفعكما بما تعلمتما';
    elsif v_buddy_share >= r.target and v_me_share < r.target then
      v_kind := 'buddy_done';
      v_title := 'رفيقك أتمّ نصيبه من الهدف — بقي نصيبك';
    elsif v_me_share >= r.target and v_buddy_share >= r.target then
      continue; -- both done but not settled yet; next run's settle handles it
    elsif (r.ends_on - current_date) = 2 then
      v_kind := 'two_days';
      v_title := 'بقي يومان على انتهاء هدف الرفقة';
    elsif v_me_share >= (r.target * 0.7) and v_buddy_share >= (r.target * 0.7) then
      v_kind := 'both_close';
      v_title := 'اقتربتما من إكمال هدف الرفقة';
    else
      continue;
    end if;

    -- Dedup this exact nudge for the day, then send.
    begin
      insert into public.buddy_nudge_log (user_id, buddy_id, goal_id, kind, day)
        values (r.recipient, r.buddy_id, r.goal_id, v_kind, current_date);
    exception when unique_violation then
      continue;
    end;

    insert into public.notifications (user_id, type, title, body, data)
      values (r.recipient, 'buddy_activity', v_title, '',
              jsonb_build_object('route', '/(student)/journey'));
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;
revoke all on function public.dispatch_buddy_nudges() from public, anon;
-- Not granted to authenticated: cron-only (runs as the migration owner).

-- Schedule at the §13 windows (UTC+3 local): ~10:00, ~15:00, ~20:00 local
-- → 07:00, 12:00, 17:00 UTC. Each run self-limits per the caps above.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'buddy-nudges') then
    perform cron.unschedule('buddy-nudges');
  end if;
  perform cron.schedule('buddy-nudges', '0 7,12,17 * * *',
    $cron$ select public.dispatch_buddy_nudges(); $cron$);
end $$;
