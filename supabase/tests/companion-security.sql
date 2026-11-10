-- Disposable test database only. No hosted credentials or personal data.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'), ('33333333-3333-4333-8333-333333333333');
insert into public.owner_memberships(user_id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
select set_config('test.hash', encode(extensions.digest(repeat('a',64), 'sha256'), 'hex'), true);
do $$ begin
  if has_table_privilege('anon','public.companion_devices','select') or has_table_privilege('authenticated','public.companion_devices','select')
    or has_function_privilege('anon','public.connect_companion(text)','execute')
    or has_function_privilege('authenticated','public.authorize_companion(text)','execute')
    or has_function_privilege('authenticated','public.publish_companion_review(uuid,uuid,jsonb,double precision,double precision)','execute')
    or has_function_privilege('anon','public.companion_recording(uuid,text)','execute') then raise exception 'Companion privileges leaked'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  begin perform public.connect_companion(current_setting('test.hash')); raise exception 'Nonmember connected';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.connect_companion(current_setting('test.hash'));
do $$ begin
  if (select count(*) from public.list_companions()) <> 1 then raise exception 'Connection missing'; end if;
end $$;
select public.add_recording('Synthetic review','dQw4w9WgXcQ',null) as recording \gset
select set_config('test.recording', :'recording', true);
select public.create_recording_share(:'recording') as share \gset
select set_config('test.share', :'share', true);
-- Another owner cannot steal or revoke an existing capability.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if exists(select 1 from public.list_companions()) then raise exception 'Cross-owner enumeration'; end if;
  perform public.disconnect_companion(current_setting('test.hash'));
  begin perform public.connect_companion(current_setting('test.hash')); raise exception 'Capability reassigned';
  exception when unique_violation then null; end;
end $$;
reset role;
set local role service_role;
do $$ declare v_review jsonb := '{"version":1,"matchId":"EUW1_1","ultimates":{"detectorVersion":1,"videoTimestampsMs":[10000]}}'; begin
  if public.authorize_companion(repeat('a',64)) <> '11111111-1111-4111-8111-111111111111'::uuid then raise exception 'Wrong owner'; end if;
  if public.authorize_companion(repeat('b',64)) is not null then raise exception 'Unknown capability accepted'; end if;
  perform public.publish_companion_review('11111111-1111-4111-8111-111111111111',current_setting('test.recording')::uuid,v_review,0,5);
  perform public.save_recording_timeline('11111111-1111-4111-8111-111111111111',current_setting('test.recording')::uuid,'EUW1_1','{"version":1}');
  begin perform public.publish_companion_review('22222222-2222-4222-8222-222222222222',current_setting('test.recording')::uuid,v_review,0,5); raise exception 'Cross-owner publish';
  exception when insufficient_privilege then null; end;
  begin perform public.publish_companion_review('11111111-1111-4111-8111-111111111111',current_setting('test.recording')::uuid,v_review,null,5); raise exception 'Missing anchor accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
update public.owner_memberships set enabled = false where user_id = '11111111-1111-4111-8111-111111111111';
do $$ begin if public.authorize_companion(repeat('a',64)) is not null then raise exception 'Disabled member accepted'; end if; end $$;
update public.owner_memberships set enabled = true where user_id = '11111111-1111-4111-8111-111111111111';
update public.companion_devices set expires_at = now() - interval '1 second';
do $$ begin if public.authorize_companion(repeat('a',64)) is not null then raise exception 'Expired device accepted'; end if; end $$;
update public.companion_devices set expires_at = now() + interval '1 day';
set local role anon;
do $$ declare v jsonb; begin
  v := public.get_shared_review(current_setting('test.share'));
  if v->'review'->'ultimates'->'videoTimestampsMs'->>0 <> '10000' then raise exception 'Shared markers missing'; end if;
  if v->'anchor'->>'videoOffsetSeconds' <> '5' then raise exception 'Shared anchor missing'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.disconnect_companion(current_setting('test.hash'));
reset role;
do $$ begin if public.authorize_companion(repeat('a',64)) is not null then raise exception 'Revoked device accepted'; end if; end $$;
rollback;
\echo 'companion-security PASS'
