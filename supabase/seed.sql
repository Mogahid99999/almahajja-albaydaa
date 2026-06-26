-- =============================================================================
-- seed.sql — small SAMPLE dataset for development.
--
-- Safe to delete anytime:  delete from public.sections where id like '11111111-%';
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING, so re-running is a no-op.
--
-- Demonstrates the nested tree + recursive rollups:
--   العقيدة → التوحيد → كتاب التوحيد → (٢ محاضرتان منشورتان)
-- The audio_path values are placeholders — no real audio is uploaded yet, so
-- playback won't work until files are added to the `lectures` storage bucket.
-- =============================================================================

-- Top-level subjects (matching the Home design grid)
insert into public.sections (id, title, "order", parent_id) values
  ('11111111-1111-1111-1111-000000000001', 'العقيدة', 0, null),
  ('11111111-1111-1111-1111-000000000002', 'الفقه',   1, null),
  ('11111111-1111-1111-1111-000000000003', 'التفسير', 2, null),
  ('11111111-1111-1111-1111-000000000004', 'الحديث',  3, null),
  ('11111111-1111-1111-1111-000000000005', 'السيرة',  4, null),
  ('11111111-1111-1111-1111-000000000006', 'التزكية', 5, null)
on conflict (id) do nothing;

-- One nested branch under العقيدة to show recursion
insert into public.sections (id, title, "order", parent_id, description) values
  ('11111111-1111-1111-1111-000000001001', 'التوحيد', 0,
   '11111111-1111-1111-1111-000000000001', 'باب التوحيد وأقسامه'),
  ('11111111-1111-1111-1111-000000002001', 'كتاب التوحيد', 0,
   '11111111-1111-1111-1111-000000001001', 'شرح كتاب التوحيد للإمام محمد بن عبد الوهاب')
on conflict (id) do nothing;

-- A sheikh
insert into public.sheikhs (id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'الشيخ عبد الله بن سالم')
on conflict (id) do nothing;

-- Two PUBLISHED lectures under "كتاب التوحيد"
insert into public.lectures
  (id, title, audio_path, duration_sec, "order", status, section_id, sheikh_id) values
  ('22222222-2222-2222-2222-000000000001', 'باب الأصل الأول: معرفة الله',
   'sample/lesson-1.m4a', 1815, 0, 'published',
   '11111111-1111-1111-1111-000000002001', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'),
  ('22222222-2222-2222-2222-000000000002', 'باب الأصل الثاني: معرفة دين الإسلام',
   'sample/lesson-2.m4a', 1700, 1, 'published',
   '11111111-1111-1111-1111-000000002001', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001')
on conflict (id) do nothing;
