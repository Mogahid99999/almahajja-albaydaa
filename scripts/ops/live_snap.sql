select
  to_char(now() at time zone 'Asia/Riyadh', 'HH24:MI:SS') t,
  (select json_agg(json_build_object('id', left(s.id::text, 8), 'title', s.title, 'status', s.status,
      'started', to_char(s.started_at at time zone 'Asia/Riyadh', 'HH24:MI'), 'peak', s.peak_listeners,
      'present', (select count(*) from live_participants p where p.session_id = s.id and p.present),
      'joined', (select count(*) from live_participants p where p.session_id = s.id)))
     from live_sessions s where s.status in ('live', 'green')) live,
  (select count(*) from push_queue where sent_at is null and (send_after is null or send_after <= now())) q_due,
  (select count(*) from push_queue where sent_at is null and send_after > now()) q_later,
  (select count(*) from push_outbox where sent_at is null) outbox,
  (select count(*) from push_governor_log where at > now() - interval '10 minutes') gov10m,
  (select json_build_object('at', to_char(at at time zone 'Asia/Riyadh', 'HH24:MI:SS'), 'active', active, 'budget', budget, 'due', due)
     from push_governor_log order by at desc limit 1) gov_last,
  (select json_object_agg(u, n) from (select coalesce(usename, '-') || ':' || coalesce(state, '-') u, count(*) n
     from pg_stat_activity where backend_type = 'client backend' group by 1) x) conns,
  (select count(*) from net._http_response where created > now() - interval '5 minutes' and (status_code is distinct from 200 or timed_out)) http_bad5m,
  (select count(*) from net._http_response where created > now() - interval '5 minutes') http_all5m,
  (select count(*) from profiles where last_opened_at > now() - interval '10 minutes') opened10m
