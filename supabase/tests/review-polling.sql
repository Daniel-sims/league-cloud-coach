-- Run only against the disposable test database, after all migrations.
-- Covers the versioned review polling RPCs and the library's game summary.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('51111111-1111-4111-8111-111111111111'), ('52222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id) select id from auth.users
  where id in ('51111111-1111-4111-8111-111111111111', '52222222-2222-4222-8222-222222222222');
do $$ begin
  if has_function_privilege('authenticated', 'coach_private.review_since(jsonb,text)', 'execute')
    or has_function_privilege('anon', 'coach_private.review_since(jsonb,text)', 'execute') then
    raise exception 'Private helper exposed';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '51111111-1111-4111-8111-111111111111', true);
select public.add_recording('Polled game', 'dQw4w9WgXcQ', null) as recording \gset
select set_config('test.recording', :'recording', true);
select public.create_recording_share(:'recording') as token \gset
select set_config('test.token', :'token', true);

do $$ begin
  if has_function_privilege('anon', 'public.get_recording_review_since(uuid,text)', 'execute') then
    raise exception 'Anonymous owner polling';
  end if;
  if not has_function_privilege('anon', 'public.get_shared_review_since(text,text,text)', 'execute') then
    raise exception 'Watch link cannot poll';
  end if;
end $$;

reset role;
set local role service_role;
select public.save_recording_timeline('51111111-1111-4111-8111-111111111111', :'recording'::uuid, 'EUW1_42',
  '{"version":1,"playerId":3,"queueId":420,"gameDuration":1500,"participants":[
    {"id":3,"championId":4,"championName":"TwistedFate","teamId":100,"position":"MIDDLE"},
    {"id":8,"championId":90,"championName":"Malzahar","teamId":200,"position":"MIDDLE"},
    {"id":9,"championId":99,"championName":"Lux","teamId":200,"position":"UTILITY"}]}');
reset role;

-- Owner: the payload arrives once with a version, then is left out while unchanged.
set local role authenticated;
select set_config('request.jwt.claim.sub', '51111111-1111-4111-8111-111111111111', true);
do $$ declare v jsonb; v_version text; begin
  perform public.add_recording_comment(current_setting('test.recording')::uuid, 1000, 'comment', 'First');
  v := public.get_recording_review_since(current_setting('test.recording')::uuid);
  v_version := v->>'reviewVersion';
  if v_version is null or (v->'review'->>'playerId')::int <> 3 or v ? 'reviewUnchanged' then raise exception 'First poll wrong: %', v; end if;
  v := public.get_recording_review_since(current_setting('test.recording')::uuid, v_version);
  if v ? 'review' or not (v->>'reviewUnchanged')::boolean or v->>'reviewVersion' <> v_version then raise exception 'Unchanged payload resent: %', v; end if;
  if v->'comments'->0->>'body' <> 'First' or v->>'matchId' <> 'EUW1_42' then raise exception 'Live parts missing: %', v; end if;
  v := public.get_recording_review_since(current_setting('test.recording')::uuid, repeat('0', 32));
  if v->'review' is null or v ? 'reviewUnchanged' then raise exception 'Stale version not refreshed'; end if;
  -- Same answer as the original RPC apart from the version.
  if (public.get_recording_review_since(current_setting('test.recording')::uuid) - 'reviewVersion')
    <> public.get_recording_review(current_setting('test.recording')::uuid) then raise exception 'Payload differs from get_recording_review'; end if;
end $$;

-- Library: the stored timeline names both champions without a synced match.
do $$ declare g jsonb; begin
  select l.game into g from public.list_recordings() l where l.id = current_setting('test.recording')::uuid;
  if g->>'championName' <> 'TwistedFate' or g->>'opponentChampionName' <> 'Malzahar' or (g->>'queueId')::int <> 420 or g ? 'win' then
    raise exception 'Timeline game summary wrong: %', g;
  end if;
end $$;

-- The owner's synced copy of the match adds result and score.
reset role;
insert into public.league_profiles(id, owner_id, platform, puuid, profile) values
  ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51111111-1111-4111-8111-111111111111', 'euw1', 'owner-puuid', '{}'),
  ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '52222222-2222-4222-8222-222222222222', 'euw1', 'other-puuid', '{}');
insert into public.league_matches(profile_id, match_id, game_creation, match) values
  ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'EUW1_42', 1, '{"id":"EUW1_42","queueId":420,"gameDuration":1500,"participants":[
    {"puuid":"owner-puuid","championId":4,"championName":"TwistedFate","teamId":100,"teamPosition":"MIDDLE","win":true,"kills":4,"deaths":2,"assists":5,"gameEndedInEarlySurrender":false},
    {"puuid":"enemy-puuid","championId":90,"championName":"Malzahar","teamId":200,"teamPosition":"MIDDLE","win":false,"kills":1,"deaths":4,"assists":2}]}'),
  -- Another owner's copy of the same match must never be used.
  ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'EUW1_42', 1, '{"id":"EUW1_42","participants":[
    {"puuid":"other-puuid","championId":1,"championName":"Annie","teamId":200,"teamPosition":"MIDDLE","win":false,"kills":9,"deaths":9,"assists":9}]}');
set local role authenticated;
select set_config('request.jwt.claim.sub', '51111111-1111-4111-8111-111111111111', true);
do $$ declare g jsonb; begin
  select l.game into g from public.list_recordings() l where l.id = current_setting('test.recording')::uuid;
  if g->>'championName' <> 'TwistedFate' or g->>'opponentChampionName' <> 'Malzahar'
    or not (g->>'win')::boolean or (g->>'kills')::int <> 4 or (g->>'deaths')::int <> 2 or (g->>'assists')::int <> 5 then
    raise exception 'Synced game summary wrong: %', g;
  end if;
  if g::text like '%puuid%' then raise exception 'Player identity in library: %', g; end if;
end $$;

-- Another owner sees none of it.
select set_config('request.jwt.claim.sub', '52222222-2222-4222-8222-222222222222', true);
do $$ begin
  if exists(select 1 from public.list_recordings()) then raise exception 'Cross-owner listing'; end if;
  begin perform public.get_recording_review_since(current_setting('test.recording')::uuid); raise exception 'Cross-owner poll';
  exception when insufficient_privilege then null; end;
end $$;

-- Watch link: same versioning; revocation ends it.
reset role;
set local role anon;
do $$ declare v jsonb; v_version text; begin
  if public.get_shared_review_since(repeat('0', 64)) is not null then raise exception 'Unknown link polled'; end if;
  v := public.get_shared_review_since(current_setting('test.token'), repeat('c', 64));
  v_version := v->>'reviewVersion';
  if v->'review' is null or v_version is null then raise exception 'Shared first poll wrong: %', v; end if;
  v := public.get_shared_review_since(current_setting('test.token'), repeat('c', 64), v_version);
  if v ? 'review' or not (v->>'reviewUnchanged')::boolean or jsonb_array_length(v->'comments') <> 1 then raise exception 'Shared unchanged poll wrong: %', v; end if;
  if v::text like '%51111111-1111-4111-8111-111111111111%' then raise exception 'Owner identity leaked'; end if;
  begin perform public.get_recording_review_since(current_setting('test.recording')::uuid); raise exception 'Anon owner poll';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '51111111-1111-4111-8111-111111111111', true);
select public.revoke_recording_share(:'recording'::uuid);
reset role;
set local role anon;
do $$ begin
  if public.get_shared_review_since(current_setting('test.token'), repeat('c', 64)) is not null then raise exception 'Revoked link still polls'; end if;
end $$;
rollback;
