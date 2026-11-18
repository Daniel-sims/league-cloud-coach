-- Run only against the disposable test database, after all migrations.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.owner_memberships(user_id,enabled) values('11111111-1111-4111-8111-111111111111',true),('22222222-2222-4222-8222-222222222222',true);
insert into public.league_profiles(id,owner_id,platform,puuid,profile) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','euw1','first','{"gameName":"First"}'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','na1','second','{"gameName":"Second"}');
-- Player is participant 1 (MIDDLE, team 100); lane opponent is 6 (MIDDLE, team 200).
insert into public.league_matches(profile_id,match_id,game_creation,match,review,review_checked) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','EUW1_1',100,'{"id":"EUW1_1"}','{
  "playerId":1,
  "participants":[{"id":1,"teamId":100,"position":"MIDDLE"},{"id":2,"teamId":100,"position":"TOP"},
    {"id":6,"teamId":200,"position":"MIDDLE"},{"id":7,"teamId":200,"position":"TOP"}],
  "frames":[
    {"t":0,"snapshots":{"1":{"gold":500,"cs":0,"jungleCs":0,"xp":0},"6":{"gold":500,"cs":0,"jungleCs":0,"xp":0}}},
    {"t":60023,"snapshots":{"1":{"gold":900,"cs":8,"jungleCs":1,"xp":300},"6":{"gold":700,"cs":5,"jungleCs":0,"xp":250}}}
  ]}',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','EUW1_2',200,'{"id":"EUW1_2"}',null,false),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','NA1_1',100,'{"id":"NA1_1"}','{
  "playerId":1,"participants":[{"id":1,"teamId":100,"position":"MIDDLE"},{"id":6,"teamId":200,"position":"MIDDLE"}],
  "frames":[{"t":0,"snapshots":{"1":{"gold":1},"6":{"gold":2}}}]}',true);
do $$ begin
  if has_table_privilege('anon','public.matchup_notes','select') or has_table_privilege('authenticated','public.matchup_notes','select')
    or has_table_privilege('authenticated','public.matchup_notes','insert') then raise exception 'Direct matchup access'; end if;
  if has_function_privilege('anon','public.list_matchups()','execute')
    or has_function_privilege('anon','public.save_matchup(integer,integer,bigint,jsonb)','execute')
    or has_function_privilege('anon','public.list_matchup_lanes(text[])','execute') then raise exception 'Anonymous matchup RPC'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare v jsonb; n jsonb := '{"difficulty":"hard","plan":"Shove and roam","threats":["E stun"],"tips":["Dodge E"],"build":"","notes":""}'; begin
  v := public.save_matchup(4, 517, 0, n);
  if (v->>'revision')::int <> 1 or v->>'difficulty' <> 'hard' then raise exception 'Note not created'; end if;
  begin perform public.save_matchup(4, 517, 0, n); raise exception 'Second create accepted'; exception when serialization_failure then null; end;
  v := public.save_matchup(4, 517, 1, n || '{"difficulty":null}');
  if (v->>'revision')::int <> 2 or v->'difficulty' <> 'null'::jsonb then raise exception 'Revision not bumped'; end if;
  begin perform public.save_matchup(4, 517, 1, n); raise exception 'Stale save accepted'; exception when serialization_failure then null; end;
  begin perform public.save_matchup(4, 517, 2, n || '{"difficulty":"impossible"}'); raise exception 'Bad difficulty saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_matchup(4, 517, 2, n || '{"threats":[5]}'); raise exception 'Malformed point saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_matchup(4, 517, 2, n || jsonb_build_object('plan', repeat('x', 301))); raise exception 'Oversized plan saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_matchup(4, 517, 2, n - 'notes'); raise exception 'Missing field saved'; exception when invalid_parameter_value then null; end;
  if jsonb_array_length(public.list_matchups()) <> 1 then raise exception 'Own notes missing'; end if;
  -- Rune pages: Riot's page shape only; an older client that omits runes keeps them.
  v := public.save_matchup(4, 517, 2, n || '{"runes":{"primaryStyleId":8000,"subStyleId":8200,"selectedPerkIds":[8005,9111,9104,8299,8226,8237,5008,5008,5011]}}');
  if v->'runes'->>'primaryStyleId' <> '8000' then raise exception 'Runes not saved'; end if;
  v := public.save_matchup(4, 517, 3, n);
  if v->'runes' = 'null'::jsonb or v->'runes' is null then raise exception 'Runes dropped by a save without them'; end if;
  begin perform public.save_matchup(4, 517, 4, n || '{"runes":{"primaryStyleId":8000,"subStyleId":8200,"selectedPerkIds":[1,2,3]}}'); raise exception 'Short page saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_matchup(4, 517, 4, n || '{"runes":{"primaryStyleId":"8000","subStyleId":8200,"selectedPerkIds":[0,0,0,0,0,0,0,0,0]}}'); raise exception 'String style saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_matchup(4, 517, 4, n || '{"runes":{"primaryStyleId":8000,"subStyleId":8200,"selectedPerkIds":[0,0,0,0,0,0,0,0,-1]}}'); raise exception 'Negative perk saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_matchup(4, 517, 4, n || '{"runes":{"primaryStyleId":8000,"subStyleId":8200,"selectedPerkIds":[0,0,0,0,0,0,0,0,0],"x":"<script>"}}'); raise exception 'Extra rune key saved'; exception when invalid_parameter_value then null; end;
  v := public.save_matchup(4, 517, 4, n || '{"runes":null}');
  if v->'runes' <> 'null'::jsonb then raise exception 'Runes not cleared'; end if;
  v := public.list_matchup_lanes(array['EUW1_1','EUW1_2','NA1_1']);
  if v <> '{"EUW1_1":[[0,0,0,0],[60,200,4,50]]}'::jsonb then raise exception 'Lane diffs wrong or leaked: %', v; end if;
  if v::text like '%snapshots%' then raise exception 'Raw review leaked'; end if;
  begin perform public.list_matchup_lanes(array_fill('x'::text, array[501])); raise exception 'Unbounded lane request'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if jsonb_array_length(public.list_matchups()) <> 0 then raise exception 'Cross-owner list leak'; end if;
  if public.list_matchup_lanes(array['EUW1_1']) <> '{}'::jsonb then raise exception 'Cross-owner lane leak'; end if;
  -- The same pair is a separate note per owner; another owner can't see or move the first owner's revision.
  if (public.save_matchup(4, 517, 0, '{"difficulty":null,"plan":"","threats":[],"tips":[],"build":"","notes":""}')->>'revision')::int <> 1 then raise exception 'Owner notes collided'; end if;
  perform public.delete_matchup(4, 517);
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  if jsonb_array_length(public.list_matchups()) <> 1 or (public.list_matchups()->0->>'revision')::int <> 5 then raise exception 'Cross-owner write or delete'; end if;
  perform public.delete_matchup(4, 517);
  if jsonb_array_length(public.list_matchups()) <> 0 then raise exception 'Delete failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  begin perform public.list_matchups(); raise exception 'Non-member read'; exception when insufficient_privilege then null; end;
  begin perform public.list_matchup_lanes(array['EUW1_1']); raise exception 'Non-member lane read'; exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: matchup notes are owner-isolated, validated and revision-checked; lane diffs stay derived and owner-only'
