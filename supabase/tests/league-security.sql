-- Run only against the disposable test database, after all migrations.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.owner_memberships(user_id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.league_profiles(id,owner_id,platform,puuid,profile) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','euw1','first','{"gameName":"First"}'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','na1','second','{"gameName":"Second"}');
insert into public.league_matches(profile_id,match_id,game_creation,match) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','EUW1_1',100,'{"id":"EUW1_1"}');
do $$ begin
  if has_table_privilege('anon','public.league_profiles','select') or has_table_privilege('authenticated','public.league_profiles','select') then raise exception 'Profile direct-read leak'; end if;
  if has_table_privilege('anon','public.league_matches','select') or has_table_privilege('authenticated','public.league_matches','insert') then raise exception 'Match access leak'; end if;
  if has_function_privilege('anon','public.list_league_profiles()','execute') or has_function_privilege('anon','public.list_league_matches(uuid)','execute') then raise exception 'Anonymous RPC leak'; end if;
  if has_function_privilege('authenticated','public.claim_league_sync(uuid,uuid)','execute') or has_function_privilege('authenticated','public.reserve_riot_request()','execute') or has_function_privilege('authenticated','public.complete_league_sync(uuid,uuid,integer)','execute') then raise exception 'Service RPC leak'; end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare profiles jsonb; matches jsonb; begin
  profiles := public.list_league_profiles();
  if jsonb_array_length(profiles) <> 1 or profiles->0->>'gameName' <> 'First' then raise exception 'Profile isolation failed'; end if;
  matches := public.list_league_matches('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if jsonb_array_length(matches) <> 1 then raise exception 'Own matches unavailable'; end if;
  begin perform public.list_league_matches('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); raise exception 'Cross-owner read succeeded'; exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  begin perform public.list_league_profiles(); raise exception 'Non-member read succeeded'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$ begin
  if not public.claim_league_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111') then raise exception 'Sync claim failed'; end if;
  if public.claim_league_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111') then raise exception 'Concurrent sync permitted'; end if;
  if public.claim_league_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222') then raise exception 'Cross-owner sync permitted'; end if;
  perform public.complete_league_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',20);
  perform public.complete_league_sync('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',5);
  if (select history_cursor from public.league_profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 20 then raise exception 'Cursor regressed'; end if;
end; $$;
update public.owner_memberships set enabled = false where user_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  begin perform public.list_league_profiles(); raise exception 'Disabled member read succeeded'; exception when insufficient_privilege then null; end;
end; $$;
rollback;
