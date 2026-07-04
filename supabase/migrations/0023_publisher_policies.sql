-- =============================================================================
-- 0023_publisher_policies.sql
-- المَحجّة البَيْضَاء — V5 (Features 5 & 6).
--
-- (A) is_content_manager() = role in ('admin','publisher'), and move every
--     CONTENT write policy (sections, sheikhs, lectures, quizzes,
--     quiz_questions, quiz_options, attachments, and the lectures/attachments
--     storage buckets) from is_admin() → is_content_manager(). The lectures
--     and quizzes SELECT policies also widen so a publisher can see DRAFTS
--     (their core job). Everything that touches USER data (profiles,
--     quiz_attempts, the results RPCs) and SETTINGS stays is_admin() ONLY.
--
-- (B) set_app_config(key,value) — a SECURITY DEFINER setter (is_admin() only),
--     the single write path for the world-readable app_config table (0021),
--     and seed the editable «عن المنصة» + Telegram keys with the current copy
--     so nothing changes visually until an admin edits them.
--
-- Append-only — 0001–0022 are never edited; policies are re-created via
-- drop-if-exists/create. Idempotent. Depends on 'publisher' from 0022.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (A) Content-manager gate + widened content policies
-- ---------------------------------------------------------------------------
create or replace function public.is_content_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'publisher')
  );
$$;

grant execute on function public.is_content_manager() to authenticated;

-- sections
drop policy if exists sections_admin_write on public.sections;
create policy sections_admin_write on public.sections
  for all to authenticated
  using (public.is_content_manager()) with check (public.is_content_manager());

-- sheikhs
drop policy if exists sheikhs_admin_write on public.sheikhs;
create policy sheikhs_admin_write on public.sheikhs
  for all to authenticated
  using (public.is_content_manager()) with check (public.is_content_manager());

-- lectures: publishers see drafts (select) and write.
drop policy if exists lectures_select on public.lectures;
create policy lectures_select on public.lectures
  for select to authenticated
  using (status = 'published' or public.is_content_manager());

drop policy if exists lectures_admin_write on public.lectures;
create policy lectures_admin_write on public.lectures
  for all to authenticated
  using (public.is_content_manager()) with check (public.is_content_manager());

-- attachments
drop policy if exists attachments_admin_write on public.attachments;
create policy attachments_admin_write on public.attachments
  for all to authenticated
  using (public.is_content_manager()) with check (public.is_content_manager());

-- quizzes: publishers see drafts (select) and write.
drop policy if exists quizzes_select on public.quizzes;
create policy quizzes_select on public.quizzes
  for select to authenticated
  using (status = 'published' or public.is_content_manager());

drop policy if exists quizzes_admin_write on public.quizzes;
create policy quizzes_admin_write on public.quizzes
  for all to authenticated
  using (public.is_content_manager()) with check (public.is_content_manager());

-- quiz_questions / quiz_options: content staff read+write (is_correct is only
-- ever exposed to content managers; students still go through the DEFINER RPCs).
drop policy if exists quiz_questions_admin_all on public.quiz_questions;
create policy quiz_questions_admin_all on public.quiz_questions
  for all to authenticated
  using (public.is_content_manager()) with check (public.is_content_manager());

drop policy if exists quiz_options_admin_all on public.quiz_options;
create policy quiz_options_admin_all on public.quiz_options
  for all to authenticated
  using (public.is_content_manager()) with check (public.is_content_manager());

-- lectures storage bucket (audio) — content staff upload/replace.
drop policy if exists lectures_objects_admin_write on storage.objects;
create policy lectures_objects_admin_write on storage.objects
  for all to authenticated
  using  (bucket_id = 'lectures' and public.is_content_manager())
  with check (bucket_id = 'lectures' and public.is_content_manager());

-- attachments storage bucket — content staff upload/replace.
drop policy if exists attachments_objects_admin_write on storage.objects;
create policy attachments_objects_admin_write on storage.objects
  for all to authenticated
  using  (bucket_id = 'attachments' and public.is_content_manager())
  with check (bucket_id = 'attachments' and public.is_content_manager());

-- ---------------------------------------------------------------------------
-- (B) app_config setter (admin only) + editable About / Telegram seed
-- ---------------------------------------------------------------------------
create or replace function public.set_app_config(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.app_config (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();
end; $$;

grant execute on function public.set_app_config(text, text) to authenticated;

-- Seed with the exact hard-coded copy currently in app/(student)/about.tsx, so
-- the page is byte-identical until an admin edits it. `do nothing` on conflict
-- preserves any edits already made. Telegram URL empty → the button stays hidden.
insert into public.app_config (key, value) values
  ('about_intro',
   '«هذه المنصة تهدف إلى تنظيم دروس العلم الشرعي وتيسير الوصول إليها، وجمع التسجيلات المتفرقة في مكان واحد مرتب يعين الطالب على المتابعة والمراجعة.»'),
  ('about_dua',
   '«نسأل الله أن يجعل هذا العمل خالصًا لوجهه الكريم، وأن ينفع به طلاب العلم.»'),
  ('about_thanks',
   '«لا تنسوا من ساهم في هذا العمل من دعائكم: المشايخ، ومن جمع المادة، ومن راجعها، ومن طوّر المنصة، ومن نشرها وساهم فيها.»'),
  ('about_closing',
   '«نفع الله بكم، وبارك في علمكم ووقتكم.»'),
  ('telegram_intro',
   'تُبثّ الدروس مباشرة على قناتنا في تلجرام، فتابِع الحلقة أولًا بأول.'),
  ('telegram_url', ''),
  ('telegram_label', 'فتح قناة تلجرام')
on conflict (key) do nothing;
