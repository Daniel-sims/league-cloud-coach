-- Run only against the disposable test database, after all migrations.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id,enabled) select id,true from auth.users;
do $$ begin
  if has_function_privilege('anon','coach_private.with_final_items(jsonb,jsonb)','execute')
    or has_function_privilege('authenticated','coach_private.with_final_items(jsonb,jsonb)','execute')
    or has_function_privilege('authenticated','coach_private.recording_timeline_final_items()','execute') then
    raise exception 'Final-item helpers are callable by clients'; end if;
end $$;
-- A ten-player summary: participant n plays champion 100+n and ends with item 3000+n.
select set_config('test.match', (select jsonb_build_object('id','EUW1_7','participants', jsonb_agg(jsonb_build_object(
  'puuid','p'||n,'championId',100+n,'item0',3000+n,'item1',0,'item2',0,'item3',0,'item4',0,'item5',0,'item6',3364) order by n))
  from generate_series(1,10) n)::text, true);
insert into public.league_profiles(id,owner_id,platform,puuid,profile)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','euw1','me','{}');
insert into public.league_matches(profile_id,match_id,game_creation,match)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','EUW1_7',1,current_setting('test.match')::jsonb);
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.add_recording('Mine','dQw4w9WgXcQ',null) as mine \gset
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select public.add_recording('Theirs','dQw4w9WgXcQ',null) as theirs \gset
reset role;
do $$ declare v jsonb; begin
  v := coach_private.with_final_items('{"participants":[{"id":3,"championId":103},{"id":8,"championId":108}]}', current_setting('test.match')::jsonb);
  if v->'participants'->0->'finalItems' <> '[3003,0,0,0,0,0,3364]' or v->'participants'->1->'finalItems' <> '[3008,0,0,0,0,0,3364]' then
    raise exception 'Final items not added: %', v; end if;
  v := coach_private.with_final_items('{"participants":[{"id":3,"championId":999}]}', current_setting('test.match')::jsonb);
  if v->'participants'->0 ? 'finalItems' then raise exception 'Mismatched champions were enriched'; end if;
  if coach_private.with_final_items('{"version":1}', current_setting('test.match')::jsonb) <> '{"version":1}' then raise exception 'Bare review changed'; end if;
  if coach_private.with_final_items('{"participants":[{"id":3,"championId":103}]}', null) ? 'finalItems' then raise exception 'Null match'; end if;
end $$;
insert into public.recording_timelines(recording_id,match_id,review)
values (:'mine','EUW1_7','{"participants":[{"id":5,"championId":105}]}'),
       (:'theirs','EUW1_7','{"participants":[{"id":5,"championId":105}]}');
do $$ begin
  if (select review->'participants'->0->'finalItems' from public.recording_timelines t join public.recordings r on r.id = t.recording_id where r.title = 'Mine')
    is distinct from '[3005,0,0,0,0,0,3364]' then raise exception 'Owner recording not enriched'; end if;
  -- Another owner's synced matches are never read for this owner's recording.
  if (select review->'participants'->0 ? 'finalItems' from public.recording_timelines t join public.recordings r on r.id = t.recording_id where r.title = 'Theirs') then
    raise exception 'Cross-owner match data used'; end if;
end $$;
insert into public.recording_timelines(recording_id,match_id,review) values (:'mine','EUW1_7','{"version":1}')
  on conflict (recording_id) do update set review = excluded.review;
rollback;
\echo 'PASS: final items join reviews only from the owner''s own matching game'
