-- 0165 — «الطلاب حسب الدول 🌍» (admin dashboard) + country filter on إدارة المستخدمين.
--
-- There is NO stored country column: registration's country picker (+249 SD, +966 SA …) is
-- prepended to the phone and the whole E.164 digit string lands in auth.users.phone
-- (src/api/auth.ts normalizePhone). So the country = the calling code at the start of the
-- stored phone, resolved here by ONE function used by both the counts and the list filter.
--
-- Egyptian national numbers: normalizePhone keeps a >9-digit local number as typed, so Egyptian
-- mobiles (010/011/012/015 → 10 digits starting 10/11/12/15) were stored WITHOUT «20» (709 of
-- 3,718 student phones on prod, 2026-11-08). As E.164 they would read as +1; owner decision
-- 2026-11-08: count them as Egypt. Any other phone without a recognisable calling code → 'ZZ'
-- («غير محدد», CLDR's unknown region) — never a guessed country. No phone → NULL (not counted).
--
-- Functions only: no table, column, index or data change. No index: 3.7k phones, the
-- aggregate and the filtered list measured on prod before applying (see the PR / memory).
-- Rollback: drop admin_user_list(…, p_country) + admin_country_counts + phone_country, then
-- recreate admin_user_list(text,int,int,boolean,text) with the body below minus the p_country
-- line (identical otherwise), revoke from public/anon, grant to authenticated. Old admin builds
-- keep working on the new signature (p_country defaults to null), so no client is broken.

begin;

create or replace function public.phone_country(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when p_phone is null or btrim(p_phone) = '' then null
    when length(p_phone) = 10 and p_phone ~ '^1[0125]' then 'EG'      -- Egyptian national mobile
    when p_phone ~ '^1' then case when length(p_phone) = 11 then 'US' else 'ZZ' end  -- NANP
    else coalesce((
      select c.iso
        from (values
          ('7','RU'),('76','KZ'),('77','KZ'),
          ('20','EG'),('211','SS'),('212','MA'),('213','DZ'),('216','TN'),('218','LY'),('220','GM'),
          ('221','SN'),('222','MR'),('223','ML'),('224','GN'),('225','CI'),('226','BF'),('227','NE'),
          ('228','TG'),('229','BJ'),('230','MU'),('231','LR'),('232','SL'),('233','GH'),('234','NG'),
          ('235','TD'),('236','CF'),('237','CM'),('238','CV'),('239','ST'),('240','GQ'),('241','GA'),
          ('242','CG'),('243','CD'),('244','AO'),('245','GW'),('246','IO'),('248','SC'),('249','SD'),
          ('250','RW'),('251','ET'),('252','SO'),('253','DJ'),('254','KE'),('255','TZ'),('256','UG'),
          ('257','BI'),('258','MZ'),('260','ZM'),('261','MG'),('262','RE'),('263','ZW'),('264','NA'),
          ('265','MW'),('266','LS'),('267','BW'),('268','SZ'),('269','KM'),('27','ZA'),('290','SH'),
          ('291','ER'),('297','AW'),('298','FO'),('299','GL'),
          ('30','GR'),('31','NL'),('32','BE'),('33','FR'),('34','ES'),('350','GI'),('351','PT'),
          ('352','LU'),('353','IE'),('354','IS'),('355','AL'),('356','MT'),('357','CY'),('358','FI'),
          ('359','BG'),('36','HU'),('370','LT'),('371','LV'),('372','EE'),('373','MD'),('374','AM'),
          ('375','BY'),('376','AD'),('377','MC'),('378','SM'),('380','UA'),('381','RS'),('382','ME'),
          ('383','XK'),('385','HR'),('386','SI'),('387','BA'),('389','MK'),('39','IT'),('40','RO'),
          ('41','CH'),('420','CZ'),('421','SK'),('423','LI'),('43','AT'),('44','GB'),('45','DK'),
          ('46','SE'),('47','NO'),('48','PL'),('49','DE'),
          ('500','FK'),('501','BZ'),('502','GT'),('503','SV'),('504','HN'),('505','NI'),('506','CR'),
          ('507','PA'),('508','PM'),('509','HT'),('51','PE'),('52','MX'),('53','CU'),('54','AR'),
          ('55','BR'),('56','CL'),('57','CO'),('58','VE'),('590','GP'),('591','BO'),('592','GY'),
          ('593','EC'),('594','GF'),('595','PY'),('596','MQ'),('597','SR'),('598','UY'),('599','CW'),
          ('60','MY'),('61','AU'),('62','ID'),('63','PH'),('64','NZ'),('65','SG'),('66','TH'),
          ('670','TL'),('672','NF'),('673','BN'),('674','NR'),('675','PG'),('676','TO'),('677','SB'),
          ('678','VU'),('679','FJ'),('680','PW'),('681','WF'),('682','CK'),('683','NU'),('685','WS'),
          ('686','KI'),('687','NC'),('688','TV'),('689','PF'),('690','TK'),('691','FM'),('692','MH'),
          ('81','JP'),('82','KR'),('84','VN'),('850','KP'),('852','HK'),('853','MO'),('855','KH'),
          ('856','LA'),('86','CN'),('880','BD'),('886','TW'),
          ('90','TR'),('91','IN'),('92','PK'),('93','AF'),('94','LK'),('95','MM'),('960','MV'),
          ('961','LB'),('962','JO'),('963','SY'),('964','IQ'),('965','KW'),('966','SA'),('967','YE'),
          ('968','OM'),('970','PS'),('971','AE'),('972','IL'),('973','BH'),('974','QA'),('975','BT'),
          ('976','MN'),('977','NP'),('98','IR'),('992','TJ'),('993','TM'),('994','AZ'),('995','GE'),
          ('996','KG'),('998','UZ')
        ) as c(dial, iso)
       where p_phone like c.dial || '%'
       order by length(c.dial) desc
       limit 1
    ), 'ZZ')
  end
$$;

revoke all on function public.phone_country(text) from public, anon, authenticated;

-- Registered accounts with a phone, per country, largest first. Students only by default
-- (the dashboard card); the users-page filter passes false so its counts match the list.
create or replace function public.admin_country_counts(p_students_only boolean default true)
returns table(country text, users bigint)
language sql
stable
security definer
set search_path = public
as $$
  select public.phone_country(u.phone) as country, count(*)::bigint as users
    from public.profiles p
    join auth.users u on u.id = p.id
   where public.is_admin()
     and coalesce(u.is_anonymous, false) = false
     and coalesce(u.phone, '') <> ''
     and (not p_students_only or p.role::text = 'student')
   group by 1
   order by 2 desc, 1;
$$;

revoke all on function public.admin_country_counts(boolean) from public, anon;
grant execute on function public.admin_country_counts(boolean) to authenticated;

-- admin_user_list + p_country (ISO code from phone_country, 'ZZ' = unknown). Same body as the
-- live definition (prod md5 f7b15fe4… before this migration), one extra predicate.
drop function public.admin_user_list(text, integer, integer, boolean, text);

create function public.admin_user_list(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0,
  p_registered_only boolean default false,
  p_status text default null,
  p_country text default null
)
returns table(id uuid, display_name text, email text, phone text, gender text, role text,
              created_at timestamp with time zone, last_opened_at timestamp with time zone,
              last_sign_in_at timestamp with time zone, banned_until timestamp with time zone,
              status text, is_anonymous boolean, completed_lectures bigint, passed_quizzes bigint,
              current_streak integer, weekly_goal_target integer, weekly_goal_metric text,
              total_count bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select
      p.id,
      coalesce(nullif(p.display_name, ''), nullif(u.raw_user_meta_data->>'display_name','')) as display_name,
      u.email,
      u.phone,
      p.gender,
      p.role::text,
      p.created_at,
      p.last_opened_at,
      u.last_sign_in_at,
      u.banned_until,
      case
        when u.banned_until is not null and u.banned_until > now() then 'banned'
        when p.last_opened_at is null or p.last_opened_at < now() - interval '30 days' then 'inactive'
        else 'active'
      end as status,
      coalesce(u.is_anonymous, false) as is_anonymous,
      coalesce((select count(*) from public.user_lecture_progress pr
                  join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
                 where pr.user_id = p.id and pr.completed), 0) as completed_lectures,
      coalesce((select count(distinct a.quiz_id) from public.quiz_attempts a
                 where a.user_id = p.id and a.passed), 0) as passed_quizzes,
      public.streak_for_user(p.id) as current_streak,
      g.target as weekly_goal_target,
      g.metric::text as weekly_goal_metric
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.weekly_goals g on g.user_id = p.id
    where public.is_admin()
      and (
        p_search is null or btrim(p_search) = ''
        or coalesce(p.display_name,'') ilike '%' || p_search || '%'
        or coalesce(u.email,'')        ilike '%' || p_search || '%'
        or coalesce(u.phone,'')        ilike '%' || p_search || '%'
      )
      and (not p_registered_only or coalesce(u.is_anonymous, false) = false)
      and (p_country is null or public.phone_country(u.phone) = p_country)
  )
  select b.*, count(*) over () as total_count
    from base b
   where p_status is null or b.status = p_status
   order by b.created_at desc, b.id desc
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$function$;

revoke all on function public.admin_user_list(text, integer, integer, boolean, text, text) from public, anon;
grant execute on function public.admin_user_list(text, integer, integer, boolean, text, text) to authenticated;

commit;
