-- Disposable fixture, rolled back. Never run bootstrap-local on a live service.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id,enabled) select id,true from auth.users;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.add_recording('Event discussion test','dQw4w9WgXcQ',null) as recording \gset
select set_config('test.recording', :'recording', true);
select public.create_recording_share(:'recording') as token \gset
select set_config('test.token', :'token', true);
select set_config('test.event','{"id":"objective-720000","matchId":"EUW1_1","gameMs":720000,"label":"Infernal Drake taken by your team"}',true);
reset role;
insert into public.recording_timelines(recording_id,match_id,review)
values (current_setting('test.recording')::uuid,'EUW1_1','{"version":1}');
set local role authenticated;
select public.add_recording_event_comment(:'recording',30000,'question','Contest dragon?',current_setting('test.event')::jsonb) as note \gset
select set_config('test.note', :'note', true);
do $$ declare v jsonb; begin
  v := public.get_recording_review(current_setting('test.recording')::uuid)->'comments'->0;
  if v->'event' <> current_setting('test.event')::jsonb or v->>'body' <> 'Contest dragon?' then raise exception 'Lost event reference'; end if;
  perform public.update_recording_comment(current_setting('test.note')::uuid,'question','Push first?');
  if public.get_recording_review(current_setting('test.recording')::uuid)->'comments'->0->'event' <> v->'event' then raise exception 'Edit detached reference'; end if;
  begin
    perform public.add_recording_event_comment(current_setting('test.recording')::uuid,30000,'comment','x','{"id":"death-1"}');
    raise exception 'Accepted incomplete reference'; exception when invalid_parameter_value then null;
  end;
  begin
    perform public.add_recording_event_comment(current_setting('test.recording')::uuid,30000,'comment','x', current_setting('test.event')::jsonb || '{"matchId":"EUW1_2"}');
    raise exception 'Accepted another game'; exception when invalid_parameter_value then null;
  end;
  begin
    perform public.add_recording_event_comment(current_setting('test.recording')::uuid,30000,'comment','x', current_setting('test.event')::jsonb || '{"identity":"private"}');
    raise exception 'Accepted extra reference fields'; exception when invalid_parameter_value then null;
  end;
  begin
    perform public.add_recording_event_comment(current_setting('test.recording')::uuid,30000,'comment','x', current_setting('test.event')::jsonb || '{"gameMs":-1}');
    raise exception 'Accepted invalid event time'; exception when invalid_parameter_value then null;
  end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  begin perform public.add_recording_event_comment(current_setting('test.recording')::uuid,30000,'comment','x',current_setting('test.event')::jsonb);
    raise exception 'Cross-owner event comment'; exception when insufficient_privilege then null;
  end;
end $$;
set local role anon;
select public.add_shared_event_comment(:'token',repeat('c',64),'Coach',30000,'comment','Push together.',current_setting('test.event')::jsonb) as coach_note \gset
select set_config('test.coach_note', :'coach_note', true);
do $$ declare v jsonb; begin
  v := public.get_shared_review(current_setting('test.token'),repeat('c',64));
  if v->'comments'->1->'event' <> current_setting('test.event')::jsonb or not (v->'comments'->1->>'mine')::boolean then raise exception 'Coach event unreadable'; end if;
  if v::text like '%author_key_hash%' then raise exception 'Leaked author identity'; end if;
  if has_function_privilege('anon','public.add_recording_event_comment(uuid,integer,text,text,jsonb)','execute') then raise exception 'Guest owner RPC'; end if;
  if has_table_privilege('anon','public.recording_comments','select') or has_table_privilege('authenticated','public.recording_comments','insert') then raise exception 'Direct comments access'; end if;
  begin perform public.update_shared_comment(current_setting('test.token'),repeat('d',64),current_setting('test.coach_note')::uuid,'comment','overwrite');
    raise exception 'Other coach edited event comment'; exception when insufficient_privilege then null;
  end;
  begin perform public.add_shared_event_comment(repeat('f',64),repeat('c',64),'Coach',30000,'comment','x',current_setting('test.event')::jsonb);
    raise exception 'Invalid link event comment'; exception when insufficient_privilege then null;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  begin perform public.update_recording_comment(current_setting('test.coach_note')::uuid,'comment','rewrite');
    raise exception 'Owner rewrote coach event comment'; exception when insufficient_privilege then null;
  end;
  perform public.delete_recording_comment(current_setting('test.coach_note')::uuid);
  perform public.revoke_recording_share(current_setting('test.recording')::uuid);
end $$;
set local role anon;
do $$ begin
  if public.get_shared_review(current_setting('test.token')) is not null then raise exception 'Revoked event review'; end if;
  begin perform public.add_shared_event_comment(current_setting('test.token'),repeat('c',64),'Coach',30000,'comment','x',current_setting('test.event')::jsonb);
    raise exception 'Revoked link event comment'; exception when insufficient_privilege then null;
  end;
end $$;
rollback;
\echo 'PASS: event references, ownership, author keys, validation and revoked-link denial'
