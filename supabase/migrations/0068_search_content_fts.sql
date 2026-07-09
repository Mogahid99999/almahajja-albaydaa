-- =============================================================================
-- 0068_search_content_fts.sql
-- المَحجّة البَيْضَاء — expand بحث to every content type + full-text search.
--
-- Replaces the 0058 ilike-on-title-only search_content() with:
--   * generated tsvector columns (+ GIN indexes) on every searchable table,
--     using the 'simple' text-search config (no bundled Arabic stemming
--     dictionary in core Postgres, so 'simple' — plain tokenize/normalize,
--     no stemming — is the standard choice for non-English content).
--   * a shared prefix-tsquery helper so search-as-you-type (350ms debounce,
--     partial trailing word) still matches — websearch_to_tsquery alone does
--     not do prefix matching.
--   * six categories instead of two: sections, lectures, sheikhs,
--     attachments, lecture_benefits (فوائد), questions (أسئلة وأجوبة).
--
-- Security carried over / extended from existing conventions:
--   * lectures stay status='published' only (0058).
--   * sections + everything scoped to a section now go through
--     section_visible_to_viewer() (0049's gender-scoped visibility), the SAME
--     gate get_section_page/get_home_page already use — search_content never
--     applied this filter before, which is closed here.
--   * attachments reproduce attachments_select RLS (0002) inline: admin sees
--     all; section-owned visible iff its section is visible; lecture-owned
--     visible iff the lecture is published + visible.
--   * lecture_benefits: status='visible' only, NEVER select user_id — mirrors
--     get_lecture_benefits' (0030) anonymity boundary.
--   * questions: status='answered' and audience='public' only, NEVER select
--     asker_id/anonymous-author fields — mirrors get_public_questions' (0028)
--     anonymity boundary.
--
-- Append-only — 0001–0067 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Generated tsvector columns + GIN indexes
-- ---------------------------------------------------------------------------
alter table public.sections add column if not exists search_vec tsvector
  generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored;
create index if not exists sections_search_vec_idx on public.sections using gin (search_vec);

alter table public.lectures add column if not exists search_vec tsvector
  generated always as (to_tsvector('simple', coalesce(title, ''))) stored;
create index if not exists lectures_search_vec_idx on public.lectures using gin (search_vec);

alter table public.sheikhs add column if not exists search_vec tsvector
  generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(bio, ''))
  ) stored;
create index if not exists sheikhs_search_vec_idx on public.sheikhs using gin (search_vec);

alter table public.attachments add column if not exists search_vec tsvector
  generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored;
create index if not exists attachments_search_vec_idx on public.attachments using gin (search_vec);

alter table public.lecture_benefits add column if not exists search_vec tsvector
  generated always as (to_tsvector('simple', coalesce(body, ''))) stored;
create index if not exists lecture_benefits_search_vec_idx
  on public.lecture_benefits using gin (search_vec);

alter table public.questions add column if not exists search_vec tsvector
  generated always as (
    to_tsvector('simple', coalesce(body, '') || ' ' || coalesce(answer_body, ''))
  ) stored;
create index if not exists questions_search_vec_idx on public.questions using gin (search_vec);

-- ---------------------------------------------------------------------------
-- web_prefix_tsquery — tokenize the raw search box input and AND together a
-- ':*' prefix term per lexeme, so a partial trailing word (typed mid-word)
-- still matches. Returns null on blank input.
-- ---------------------------------------------------------------------------
create or replace function public.web_prefix_tsquery(p_search text)
returns tsquery
language sql immutable as $$
  select to_tsquery('simple', string_agg(lexeme || ':*', ' & '))
  from unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_search, '')))) as lexeme;
$$;

-- ---------------------------------------------------------------------------
-- search_content — one jsonb document, six categories, each capped at 20
-- rows and ordered by ts_rank. SECURITY INVOKER so RLS still applies on top
-- of the explicit filters below (belt + suspenders, same as 0058).
-- ---------------------------------------------------------------------------
create or replace function public.search_content(p_search text)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with q as (
    select public.web_prefix_tsquery(p_search) as query
  ),
  my_gender as (
    select gender from public.profiles where id = auth.uid()
  ),
  matched_sections as (
    select s.id, s.title, s.cover_letter, ts_rank(s.search_vec, q.query) as rank
      from public.sections s, q
     where q.query is not null
       and s.search_vec @@ q.query
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(s.id, (select gender from my_gender))
       )
     order by rank desc, s.title
     limit 20
  ),
  matched_lectures as (
    select l.id, l.title, coalesce(l.duration_sec, 0) as duration_sec,
           sh.name as sheikh_name, s.title as section_title,
           ts_rank(l.search_vec, q.query) as rank
      from public.lectures l
      cross join q
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.sections s on s.id = l.section_id
     where q.query is not null
       and l.status = 'published'
       and l.search_vec @@ q.query
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(l.section_id, (select gender from my_gender))
       )
     order by rank desc, l.title
     limit 20
  ),
  matched_sheikhs as (
    select sh.id, sh.name, ts_rank(sh.search_vec, q.query) as rank
      from public.sheikhs sh, q
     where q.query is not null
       and sh.search_vec @@ q.query
     order by rank desc, sh.name
     limit 20
  ),
  matched_attachments as (
    select a.id, a.type, a.title, a.section_id, a.lecture_id,
           s.title as section_title, l.title as lecture_title,
           ts_rank(a.search_vec, q.query) as rank
      from public.attachments a
      cross join q
      left join public.sections s on s.id = a.section_id
      left join public.lectures l on l.id = a.lecture_id
     where q.query is not null
       and a.search_vec @@ q.query
       and (
         public.is_content_manager()
         or (
           a.section_id is not null
           and public.section_visible_to_viewer(a.section_id, (select gender from my_gender))
         )
         or (
           a.lecture_id is not null
           and l.status = 'published'
           and public.section_visible_to_viewer(l.section_id, (select gender from my_gender))
         )
       )
     order by rank desc, a.title
     limit 20
  ),
  matched_benefits as (
    select b.id, b.lecture_id, l.title as lecture_title,
           left(b.body, 160) as snippet, ts_rank(b.search_vec, q.query) as rank
      from public.lecture_benefits b
      cross join q
      join public.lectures l on l.id = b.lecture_id
     where q.query is not null
       and b.status = 'visible'
       and b.search_vec @@ q.query
       and l.status = 'published'
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(l.section_id, (select gender from my_gender))
       )
     order by rank desc, b.created_at desc
     limit 20
  ),
  matched_questions as (
    select qn.id, qn.scope, qn.lecture_id, l.title as lecture_title,
           left(qn.body, 160) as body_snippet,
           left(coalesce(qn.answer_body, ''), 160) as answer_snippet,
           ts_rank(qn.search_vec, q.query) as rank
      from public.questions qn
      cross join q
      left join public.lectures l on l.id = qn.lecture_id
     where q.query is not null
       and qn.status = 'answered'
       and qn.audience = 'public'
       and qn.search_vec @@ q.query
       and (
         qn.scope = 'general'
         or (
           l.status = 'published'
           and (
             public.is_content_manager()
             or public.section_visible_to_viewer(l.section_id, (select gender from my_gender))
           )
         )
       )
     order by rank desc, qn.answered_at desc
     limit 20
  )
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', ms.id, 'title', ms.title, 'cover_letter', ms.cover_letter)
      ) from matched_sections ms
    ), '[]'::jsonb),
    'lectures', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ml.id, 'title', ml.title, 'duration_sec', ml.duration_sec,
          'sheikh_name', ml.sheikh_name, 'section_title', ml.section_title
        )
      ) from matched_lectures ml
    ), '[]'::jsonb),
    'sheikhs', coalesce((
      select jsonb_agg(jsonb_build_object('id', msh.id, 'name', msh.name))
      from matched_sheikhs msh
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ma.id, 'type', ma.type, 'title', ma.title,
          'section_id', ma.section_id, 'lecture_id', ma.lecture_id,
          'section_title', ma.section_title, 'lecture_title', ma.lecture_title
        )
      ) from matched_attachments ma
    ), '[]'::jsonb),
    'benefits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', mb.id, 'lecture_id', mb.lecture_id,
          'lecture_title', mb.lecture_title, 'snippet', mb.snippet
        )
      ) from matched_benefits mb
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', mq.id, 'scope', mq.scope, 'lecture_id', mq.lecture_id,
          'lecture_title', mq.lecture_title, 'body_snippet', mq.body_snippet,
          'answer_snippet', mq.answer_snippet
        )
      ) from matched_questions mq
    ), '[]'::jsonb)
  );
$$;

-- Execute hygiene (0039): no PUBLIC/anon; authenticated (incl. native guests) only.
revoke all on function public.web_prefix_tsquery(text) from public, anon;
grant execute on function public.web_prefix_tsquery(text) to authenticated;

revoke all on function public.search_content(text) from public, anon;
grant execute on function public.search_content(text) to authenticated;
