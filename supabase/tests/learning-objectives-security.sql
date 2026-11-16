-- Run only against the disposable test database, after all migrations.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.owner_memberships(user_id,enabled) values('11111111-1111-4111-8111-111111111111',true),('22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if has_table_privilege('anon','public.learning_objectives','select') or has_table_privilege('authenticated','public.learning_objectives','select')
    or has_table_privilege('authenticated','public.learning_objectives','insert') or has_table_privilege('authenticated','public.learning_objectives','update')
    or has_table_privilege('anon','public.objective_players','select') or has_table_privilege('authenticated','public.objective_players','select')
    or has_table_privilege('authenticated','public.learning_objectives_legacy','select') then
    raise exception 'Direct learning objectives access'; end if;
  if has_function_privilege('anon','public.get_learning_objectives()','execute')
    or has_function_privilege('anon','public.change_learning_objective(text,uuid,text,text,text,bigint)','execute')
    or has_function_privilege('anon','public.set_objectives_player_name(text)','execute') then raise exception 'Anonymous owner objectives RPC'; end if;
  if has_function_privilege('authenticated','coach_private.change_objective(uuid,text,text,uuid,text,text,text,bigint)','execute')
    then raise exception 'Private objectives helper exposed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.add_recording('Objectives','dQw4w9WgXcQ',null) as recording \gset
select public.create_recording_share(:'recording') as open_link \gset
select public.create_guest_link(:'recording','Coach Sam') as sam_link \gset
select set_config('test.recording', :'recording', true);
do $$ declare v jsonb; a uuid; b uuid; c uuid; begin
  v := public.get_learning_objectives();
  if jsonb_array_length(v->'objectives') <> 0 or v->'playerName' <> 'null'::jsonb then raise exception 'Empty objectives not blank'; end if;
  v := public.change_learning_objective('create',null,'post_game','  R usage  ','Was the R necessary?');
  v := public.change_learning_objective('create',null,'post_game','Transitions','');
  v := public.change_learning_objective('create',null,'in_game','Track the jungler','');
  if jsonb_array_length(v->'objectives') <> 3 then raise exception 'Objectives not created'; end if;
  select (o->>'id')::uuid into a from jsonb_array_elements(v->'objectives') o where o->>'title' = 'R usage';
  select (o->>'id')::uuid into b from jsonb_array_elements(v->'objectives') o where o->>'title' = 'Transitions';
  if a is null then raise exception 'Title not trimmed'; end if;
  -- Order within a phase moves by swapping neighbours.
  v := public.change_learning_objective('up',b);
  if (select o->>'title' from jsonb_array_elements(v->'objectives') o where o->>'phase' = 'post_game' limit 1) <> 'Transitions' then
    raise exception 'Move up did not reorder'; end if;
  v := public.change_learning_objective('up',b);
  if (select o->>'title' from jsonb_array_elements(v->'objectives') o where o->>'phase' = 'post_game' limit 1) <> 'Transitions' then
    raise exception 'Move past the top changed order'; end if;
  -- Edits are revision-checked.
  v := public.change_learning_objective('update',a,'post_game','R usage (patience)','Signs not to R',1);
  begin perform public.change_learning_objective('update',a,'post_game','stale','',1); raise exception 'Stale edit accepted';
    exception when serialization_failure then null; end;
  begin perform public.change_learning_objective('create',null,'during','x',''); raise exception 'Bad phase accepted';
    exception when invalid_parameter_value then null; end;
  begin perform public.change_learning_objective('create',null,'in_game','  ',''); raise exception 'Blank title accepted';
    exception when invalid_parameter_value then null; end;
  begin perform public.change_learning_objective('create',null,'in_game','x',repeat('y',4001)); raise exception 'Oversized details accepted';
    exception when invalid_parameter_value then null; end;
  begin perform public.change_learning_objective('rename',a); raise exception 'Unknown action accepted';
    exception when invalid_parameter_value then null; end;
  v := public.change_learning_objective('archive',b);
  if (select o->>'archivedAt' from jsonb_array_elements(v->'objectives') o where (o->>'id')::uuid = b) is null then raise exception 'Archive failed'; end if;
  v := public.change_learning_objective('restore',b);
  if (select o->>'archivedAt' from jsonb_array_elements(v->'objectives') o where (o->>'id')::uuid = b) is not null then raise exception 'Restore failed'; end if;
  v := public.set_objectives_player_name('  Daniel ');
  if v->>'playerName' <> 'Daniel' then raise exception 'Player name not saved'; end if;
  begin perform public.set_objectives_player_name(repeat('n',41)); raise exception 'Long name accepted';
    exception when invalid_parameter_value then null; end;
end $$;
-- Another owner sees and changes none of it.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if jsonb_array_length(public.get_learning_objectives()->'objectives') <> 0 then raise exception 'Cross-owner read leak'; end if;
end $$;
reset role;
select id as theirs from public.learning_objectives where title = 'R usage (patience)' \gset
set local role authenticated;
select set_config('test.theirs', :'theirs', true);
do $$ begin
  begin perform public.change_learning_objective('update',current_setting('test.theirs')::uuid,'post_game','overwrite','',2);
    raise exception 'Cross-owner edit'; exception when serialization_failure then null; end;
  begin perform public.change_learning_objective('archive',current_setting('test.theirs')::uuid);
    raise exception 'Cross-owner archive'; exception when serialization_failure then null; end;
  perform public.change_learning_objective('delete',current_setting('test.theirs')::uuid);
  begin perform public.change_learning_objective('up',current_setting('test.theirs')::uuid);
    raise exception 'Cross-owner move'; exception when serialization_failure then null; end;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.learning_objectives where title = 'R usage (patience)') then raise exception 'Cross-owner delete'; end if;
end $$;
-- Non-members get nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  begin perform public.get_learning_objectives(); raise exception 'Non-member read'; exception when insufficient_privilege then null; end;
  begin perform public.change_learning_objective('create',null,'in_game','x',''); raise exception 'Non-member write'; exception when insufficient_privilege then null; end;
end $$;
-- Watch-link holders read the owner's list and change it under their name.
set local role anon;
select guest_key as sam_key from public.resolve_recording_share(:'sam_link') \gset
select set_config('test.open', :'open_link', true);
select set_config('test.sam', :'sam_link', true);
select set_config('test.samkey', :'sam_key', true);
do $$ declare v jsonb; k text := repeat('a',64); a uuid; begin
  v := public.get_shared_objectives(current_setting('test.open'));
  if v->>'playerName' <> 'Daniel' or jsonb_array_length(v->'objectives') <> 3 then raise exception 'Coach cannot read objectives'; end if;
  if v::text ~ '1111' then raise exception 'Owner identity leaked'; end if;
  v := public.change_shared_objective(current_setting('test.open'),k,'  Coach Kim ','create',null,'in_game','Ward river','');
  if (select o->>'editedBy' from jsonb_array_elements(v->'objectives') o where o->>'title' = 'Ward river') <> 'Coach Kim'
    or (select o->>'editedRole' from jsonb_array_elements(v->'objectives') o where o->>'title' = 'Ward river') <> 'coach' then
    raise exception 'Coach change not attributed'; end if;
  v := public.change_shared_objective(current_setting('test.open'),k,'','create',null,'in_game','No name','');
  if (select o->>'editedBy' from jsonb_array_elements(v->'objectives') o where o->>'title' = 'No name') <> 'Coach' then
    raise exception 'Nameless coach not attributed'; end if;
  -- A named guest's name comes from their link, not the browser.
  select (o->>'id')::uuid into a from jsonb_array_elements(v->'objectives') o where o->>'title' = 'No name';
  v := public.change_shared_objective(current_setting('test.sam'),current_setting('test.samkey'),'Imposter','update',a,'post_game','Renamed','',1);
  if (select o->>'editedBy' from jsonb_array_elements(v->'objectives') o where (o->>'id')::uuid = a) <> 'Coach Sam' then
    raise exception 'Guest name chosen by browser'; end if;
  v := public.change_shared_objective(current_setting('test.sam'),current_setting('test.samkey'),null,'delete',a);
  if exists(select 1 from jsonb_array_elements(v->'objectives') o where (o->>'id')::uuid = a) then raise exception 'Coach delete failed'; end if;
  if public.get_shared_objectives(repeat('b',64)) is not null then raise exception 'Invalid link read objectives'; end if;
  begin perform public.change_shared_objective(repeat('b',64),k,'x','create',null,'in_game','x',''); raise exception 'Invalid link wrote';
    exception when insufficient_privilege then null; end;
  begin perform public.change_shared_objective(current_setting('test.open'),'bad','x','create',null,'in_game','x',''); raise exception 'Bad key accepted';
    exception when invalid_parameter_value then null; end;
end $$;
-- Revoking the link ends both reads and writes.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.revoke_recording_share(:'recording');
set local role anon;
do $$ begin
  if public.get_shared_objectives(current_setting('test.open')) is not null then raise exception 'Revoked link read objectives'; end if;
  begin perform public.change_shared_objective(current_setting('test.open'),repeat('a',64),'x','create',null,'in_game','x','');
    raise exception 'Revoked link wrote'; exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: learning objectives are owner-isolated, link-scoped, attributed and revision-checked'
