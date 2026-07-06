-- =============================================================================
-- 0052_blocked_words.sql
-- المَحجّة البَيْضَاء — Item 5: offensive-word filter (questions, benefits,
-- report reasons). REJECTS a submission outright (no silent masking).
--
-- blocked_words is intentionally locked down to nothing: RLS enabled, ZERO
-- policies, ZERO grants to `authenticated`. Postgres exempts a table's OWNER
-- from its own RLS by default (no FORCE ROW LEVEL SECURITY set), so the
-- SECURITY DEFINER contains_blocked_word() below (owned by the migration
-- role) can still read every row, while there is no privilege path for any
-- client role to select/insert/update it directly — this is deliberately
-- migration-only; there is NO admin UI for this list.
--
-- contains_blocked_word() is diacritic-insensitive (strips Arabic tashkeel +
-- the tatweel/kashida stretch char) and whole-word (\m / \M = Postgres regex
-- word-start / word-end anchors), case-insensitive via `~*`. Letter-swap
-- evasion (ة/ه, ا/أ/إ/آ, ى/ي) is handled by seeding EXPLICIT spelling
-- variants below as separate rows, not by runtime letter normalization —
-- normalizing e.g. all ة→ه app-wide risks false positives on unrelated words.
--
-- SEED LIST — a genuine first draft for a real moderation feature (rejecting
-- abusive submissions before a sheikh/the public ever sees them), grouped by
-- category for human review. Deliberately EXCLUDES common words that also
-- have legitimate meanings on an Islamic lecture platform even though they
-- can double as insults in casual speech — كلب/حمار (fiqh: keeping/eating
-- animals), عبد (name prefix: عبدالله، عبدالرحمن...), كافر (normal theological
-- term), زانية/زاني/بغي (normal fiqh terms for hadd rulings), شاذ (also
-- "outlier opinion", القول الشاذ). The human owner should review every row
-- below and add/remove as needed — this is explicitly a draft.
--
-- Append-only — 0001–0051 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.blocked_words (
  id         uuid primary key default gen_random_uuid(),
  word       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.blocked_words enable row level security;
-- No policies, no grants — see header comment. Direct client access is
-- impossible; only the owner-run DEFINER function below ever reads this.

-- ---------------------------------------------------------------------------
-- Seed — categorized, commented, for human review/edit.
-- ---------------------------------------------------------------------------

-- ألفاظ بذيئة عامة / سباب (profanity / general vulgar insults)
insert into public.blocked_words (word) values
  ('حقير'),
  ('خرا'),
  ('خراء'),
  ('تبا لك'),
  ('ابن الكلب'),
  ('يا ابن الكلب'),
  ('وسخ'),
  ('قذر'),
  ('حثالة'),
  ('زبالة'),
  ('أحمق'),
  ('احمق'),          -- بديل إملائي: ا/أ
  ('غبي'),
  ('غبى')            -- بديل إملائي: ي/ى
on conflict (word) do nothing;

-- ألفاظ جنسية وفاحشة (sexual / obscene terms)
insert into public.blocked_words (word) values
  ('كس'),
  ('كسم'),
  ('كسمك'),
  ('يا كسمك'),
  ('طيز'),
  ('زب'),
  ('منيك'),
  ('منيوك'),
  ('نيك'),
  ('ينيك'),
  ('شرموطة'),
  ('شرموطه'),        -- بديل إملائي: ة/ه
  ('شراميط'),
  ('قحبة'),
  ('قحبه'),          -- بديل إملائي: ة/ه
  ('عاهرة'),
  ('عاهره'),         -- بديل إملائي: ة/ه
  ('عرص'),
  ('قواد'),
  ('ديوث')
on conflict (word) do nothing;

-- سب الذات الإلهية والدين (religious insults / blasphemy — incl. sectarian
-- slurs, relevant on an Islamic Q&A platform where sectarian flame-wars are a
-- real moderation problem)
insert into public.blocked_words (word) values
  ('لعن الله الدين'),
  ('يلعن دينك'),
  ('تفو على الدين'),
  ('رافضي'),
  ('رافضة'),
  ('ناصبي')
on conflict (word) do nothing;

-- شتائم تحقيرية/عرقية (slurs — ethnic / identity-based)
insert into public.blocked_words (word) values
  ('زنجي'),
  ('زنجى'),          -- بديل إملائي: ي/ى
  ('خول'),
  ('خولات'),
  ('لوطي')
on conflict (word) do nothing;

-- ---------------------------------------------------------------------------
-- contains_blocked_word — SECURITY DEFINER so it can read blocked_words
-- despite the table having zero client grants (see header).
-- ---------------------------------------------------------------------------
create or replace function public.contains_blocked_word(p_text text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_clean text;
begin
  if p_text is null or btrim(p_text) = '' then
    return false;
  end if;
  -- Strip Arabic diacritics (tashkeel U+064B-U+0655, superscript alef U+0670)
  -- and the tatweel/kashida stretch char (U+0640, often inserted to dodge
  -- filters, e.g. "كـــلمة"), then whole-word (\m/\M), case-insensitive (~*)
  -- match against every row.
  v_clean := regexp_replace(p_text, '[ـً-ٰٕ]', '', 'g');
  return exists (
    select 1
      from public.blocked_words w
     where v_clean ~* ('\m' || w.word || '\M')
  );
end;
$$;
grant execute on function public.contains_blocked_word(text) to authenticated;
