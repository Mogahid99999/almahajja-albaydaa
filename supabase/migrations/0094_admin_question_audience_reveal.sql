-- =============================================================================
-- 0094_admin_question_audience_reveal.sql
-- المَحجّة البَيْضَاء — items 7 & 8: admin controls over question visibility.
--
--   * set_question_audience(question_id, audience) — ADMIN flips a question
--     between 'sheikh' (للشيخ فقط) and 'public' (للعامة). A public question is
--     still only shown to students once ANSWERED (existing publish rule), so
--     this never leaks an unanswered private question. Admin-only (is_admin),
--     stricter than set_question_hidden's is_moderator gate — changing who can
--     see a question is an administrative decision, not a sheikh one.
--
--   * reveal_question_author(question_id) — ADMIN-only, returns the real
--     display name behind an anonymous question FOR REVIEW. Full anonymity
--     (0077/0088) means the name is masked everywhere, including the admin
--     inbox; this returns it on demand WITHOUT changing the row, so the
--     question stays anonymous to students and the sheikh. Returns null when
--     the asker left no name or the question isn't anonymous.
--
-- The author name is NOT stored on questions — it is resolved from asker_id →
-- profiles.display_name (mirrors how get_question_inbox masks it).
--
-- Append-only migration — 0001–0093 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- set_question_audience — admin flip private ↔ public.
-- ---------------------------------------------------------------------------
create or replace function public.set_question_audience(
  p_question_id uuid,
  p_audience    text
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  if p_audience not in ('public', 'sheikh') then
    raise exception 'قيمة غير صالحة';
  end if;

  update public.questions
     set audience = p_audience
   where id = p_question_id;

  if not found then
    raise exception 'السؤال غير موجود';
  end if;
end;
$$;
revoke all on function public.set_question_audience(uuid, text) from public, anon;
grant execute on function public.set_question_audience(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reveal_question_author — admin-only name lookup (review, no row change).
-- ---------------------------------------------------------------------------
create or replace function public.reveal_question_author(p_question_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_asker   uuid;
  v_anon    boolean;
  v_name    text;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;

  select asker_id, is_anonymous into v_asker, v_anon
    from public.questions where id = p_question_id;
  if not found then
    raise exception 'السؤال غير موجود';
  end if;

  -- Non-anonymous questions already show the name; nothing to reveal.
  if not coalesce(v_anon, false) or v_asker is null then
    return null;
  end if;

  select nullif(btrim(display_name), '') into v_name
    from public.profiles where id = v_asker;
  return v_name;  -- null when the asker left no name
end;
$$;
revoke all on function public.reveal_question_author(uuid) from public, anon;
grant execute on function public.reveal_question_author(uuid) to authenticated;
