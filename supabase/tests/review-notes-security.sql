begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id,enabled) select id,true from auth.users;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.add_recording('Running review test','dQw4w9WgXcQ',null) as recording \gset
select set_config('test.recording', :'recording',true);
select public.create_recording_share(:'recording') as token \gset
select set_config('test.token', :'token',true);
select public.save_recording_notes(:'recording','Private player draft',0,false);
do $$ declare v jsonb; begin
  v := public.get_recording_notes(current_setting('test.recording')::uuid);
  if v->'draft'->>'body' <> 'Private player draft' or jsonb_array_length(v->'reviews') <> 0 then raise exception 'Owner draft missing or published early'; end if;
  begin perform public.save_recording_notes(current_setting('test.recording')::uuid,'stale',0,false); raise exception 'Stale owner draft overwritten'; exception when serialization_failure then null; end;
  begin perform public.save_recording_notes(current_setting('test.recording')::uuid,' ',1,true); raise exception 'Empty review completed'; exception when invalid_parameter_value then null; end;
  begin perform public.save_recording_notes(current_setting('test.recording')::uuid,repeat('x',20001),1,false); raise exception 'Oversized notes saved'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  begin perform public.get_recording_notes(current_setting('test.recording')::uuid); raise exception 'Cross-owner notes read'; exception when insufficient_privilege then null; end;
  begin perform public.save_recording_notes(current_setting('test.recording')::uuid,'overwrite',1,true); raise exception 'Cross-owner notes write'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ declare v jsonb; begin
  v := public.get_shared_notes(current_setting('test.token'),repeat('c',64));
  if v->'draft' <> 'null'::jsonb or jsonb_array_length(v->'reviews') <> 0 or v::text like '%Private player%' then raise exception 'Leaked player draft'; end if;
  if has_table_privilege('anon','public.recording_review_notes','select') or has_table_privilege('authenticated','public.recording_review_notes','insert') then raise exception 'Direct notes access'; end if;
  if has_function_privilege('anon','public.save_recording_notes(uuid,text,bigint,boolean)','execute') then raise exception 'Guest owner notes access'; end if;
  begin perform public.save_shared_notes(current_setting('test.token'),repeat('c',64),' ', 'x',0,false); raise exception 'Anonymous coach name'; exception when invalid_parameter_value then null; end;
end $$;
select public.save_shared_notes(:'token',repeat('c',64),'Coach','Private coach draft',0,false);
do $$ declare v jsonb; begin
  v := public.get_shared_notes(current_setting('test.token'),repeat('d',64));
  if v->'draft' <> 'null'::jsonb or v::text like '%Private coach%' or v::text like '%author_key_hash%' then raise exception 'Leaked coach draft or author key'; end if;
  if public.get_shared_notes(current_setting('test.token'))->'draft' <> 'null'::jsonb then raise exception 'Keyless reader saw private draft'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  if (public.get_recording_notes(current_setting('test.recording')::uuid)->'draft')::text like '%Private coach%' or (public.get_recording_notes(current_setting('test.recording')::uuid)->'reviews')::text like '%Private coach%' then raise exception 'Coach draft leaked into player draft or published reviews'; end if;
end $$;
select public.save_recording_notes(:'recording','Finished player review',1,true);
set local role anon;
select public.save_shared_notes(:'token',repeat('c',64),'Coach','Finished coach review',1,true);
select public.save_shared_notes(:'token',repeat('c',64),'Coach','Private coach revision',2,false);
do $$ declare v jsonb; begin
  v := public.get_shared_notes(current_setting('test.token'),repeat('d',64));
  if jsonb_array_length(v->'reviews') <> 2 or v::text not like '%Finished coach review%' or v::text like '%Private coach revision%' then raise exception 'Published snapshot changed before completion'; end if;
  if (v->'reviews'->0->>'mine')::boolean or (v->'reviews'->1->>'mine')::boolean then raise exception 'Other coach claimed review'; end if;
  v := public.get_shared_notes(current_setting('test.token'),repeat('c',64));
  if v->'draft'->>'body' <> 'Private coach revision' then raise exception 'Own revision lost'; end if;
  begin perform public.save_shared_notes(current_setting('test.token'),repeat('c',64),'Coach','stale',2,true); raise exception 'Stale coach draft overwritten'; exception when serialization_failure then null; end;
  begin perform public.save_shared_notes(repeat('f',64),repeat('c',64),'Coach','x',0,true); raise exception 'Invalid share saved notes'; exception when insufficient_privilege then null; end;
end $$;
-- Bounded anonymous storage, while preserving the owner's own review slot.
do $$ begin
  for i in 1..48 loop perform public.save_shared_notes(current_setting('test.token'),lpad(to_hex(i),64,'0'),'Other coach','draft',0,false); end loop;
  begin perform public.save_shared_notes(current_setting('test.token'),repeat('e',64),'Overflow coach','x',0,false); raise exception 'Review quota bypass'; exception when program_limit_exceeded then null; end;
end $$;
set local role authenticated;
select public.save_recording_notes(:'recording','Player revision',2,false);
select public.revoke_recording_share(:'recording');
set local role anon;
do $$ begin
  if public.get_shared_notes(current_setting('test.token'),repeat('c',64)) is not null then raise exception 'Revoked review read'; end if;
  begin perform public.save_shared_notes(current_setting('test.token'),repeat('c',64),'Coach','x',3,true); raise exception 'Revoked review write'; exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: private drafts, published snapshots, actor isolation, conflicts, bounds, quota and revoked-link denial'
