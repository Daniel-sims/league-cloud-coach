-- Disposable database only; image fixtures exercise byte validation, not decoding.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id) select id from auth.users;
do $$ begin
  if has_function_privilege('anon', 'coach_private.capture_recording(uuid,text)', 'execute') then raise exception 'Private helper exposed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.add_recording('Drawing review', 'dQw4w9WgXcQ', null) as recording \gset
select public.create_recording_share(:'recording') as token \gset
select set_config('test.recording', :'recording', true);
select set_config('test.token', :'token', true);
select set_config('test.image', 'data:image/jpeg;base64,/9j//9k=', true);
select public.add_recording_capture(12345, current_setting('test.image'), ' Rotate here ', :'recording') as capture \gset
select set_config('test.capture', :'capture', true);

do $$ declare v jsonb; begin
  if has_table_privilege('anon', 'public.recording_captures', 'select') or has_table_privilege('authenticated', 'public.recording_captures', 'insert') then raise exception 'Direct capture access'; end if;
  v := public.list_recording_captures(current_setting('test.recording')::uuid);
  if v->0->>'body' <> 'Rotate here' or (v->0->>'videoMs')::int <> 12345 or not (v->0->>'mine')::boolean then raise exception 'Wrong capture metadata'; end if;
  if v::text like '%base64%' or v::text like '%11111111-1111-4111-8111-111111111111%' then raise exception 'Image/identity in listing'; end if;
  if public.get_recording_capture(current_setting('test.capture')::uuid) <> current_setting('test.image') then raise exception 'Image did not round trip'; end if;
  begin perform public.add_recording_capture(-1, current_setting('test.image'), '', current_setting('test.recording')::uuid); raise exception 'Bad time saved'; exception when check_violation then null; end;
  begin perform public.add_recording_capture(1, 'data:image/svg+xml;base64,PHN2Zz4=', '', current_setting('test.recording')::uuid); raise exception 'SVG saved'; exception when invalid_parameter_value then null; end;
  begin perform public.add_recording_capture(1, 'data:image/jpeg;base64,YWJjZA==', '', current_setting('test.recording')::uuid); raise exception 'Invalid JPEG saved'; exception when invalid_parameter_value then null; end;
  begin perform public.add_recording_capture(1, 'data:image/jpeg;base64,' || repeat('A', 350000), '', current_setting('test.recording')::uuid); raise exception 'Oversize saved'; exception when invalid_parameter_value then null; end;
end $$;

-- Another owner cannot read metadata/image, write, or delete this recording's captures.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.add_recording('Other game', '9bZkp7q19f0', null) as other_recording \gset
select set_config('test.other_recording', :'other_recording', true);
do $$ begin
  begin perform public.list_recording_captures(current_setting('test.recording')::uuid); raise exception 'Cross-owner list'; exception when insufficient_privilege then null; end;
  begin perform public.get_recording_capture(current_setting('test.capture')::uuid); raise exception 'Cross-owner image'; exception when insufficient_privilege then null; end;
  begin perform public.add_recording_capture(1, current_setting('test.image'), '', current_setting('test.recording')::uuid); raise exception 'Cross-owner add'; exception when insufficient_privilege then null; end;
  begin perform public.delete_recording_capture(current_setting('test.capture')::uuid); raise exception 'Cross-owner delete'; exception when insufficient_privilege then null; end;
end $$;

set local role anon;
select public.add_recording_capture(23456, current_setting('test.image'), 'Coach drawing', null, current_setting('test.token'), repeat('c', 64), ' Coach ') as coach_capture \gset
select set_config('test.coach_capture', :'coach_capture', true);
do $$ declare v jsonb; begin
  v := public.list_recording_captures(null, current_setting('test.token'), repeat('c',64));
  if jsonb_array_length(v) <> 2 or (v->0->>'mine')::boolean or not (v->1->>'mine')::boolean or v->1->>'author' <> 'Coach' then raise exception 'Wrong guest ownership'; end if;
  if v::text like '%author_key_hash%' then raise exception 'Author hash leaked'; end if;
  if (public.list_recording_captures(null, current_setting('test.token'), repeat('d',64))->1->>'mine')::boolean then raise exception 'Wrong browser owns capture'; end if;
  if public.get_recording_capture(current_setting('test.capture')::uuid, current_setting('test.token')) <> current_setting('test.image') then raise exception 'Guest image failed'; end if;
  begin perform public.delete_recording_capture(current_setting('test.capture')::uuid, current_setting('test.token'), repeat('c',64)); raise exception 'Coach deleted owner capture'; exception when insufficient_privilege then null; end;
  begin perform public.delete_recording_capture(current_setting('test.coach_capture')::uuid, current_setting('test.token'), repeat('d',64)); raise exception 'Other browser deleted'; exception when insufficient_privilege then null; end;
  begin perform public.list_recording_captures(current_setting('test.other_recording')::uuid, current_setting('test.token')); raise exception 'Cross-recording capability'; exception when insufficient_privilege then null; end;
  begin perform public.get_recording_capture(current_setting('test.capture')::uuid); raise exception 'Anon without token'; exception when insufficient_privilege then null; end;
  begin perform public.get_recording_capture(current_setting('test.capture')::uuid, repeat('0',64)); raise exception 'Invalid token image'; exception when insufficient_privilege then null; end;
  begin perform public.add_recording_capture(1, current_setting('test.image'), '', null, current_setting('test.token'), 'weak', 'Coach'); raise exception 'Weak key saved'; exception when invalid_parameter_value then null; end;
  begin perform public.add_recording_capture(1, current_setting('test.image'), '', null, current_setting('test.token'), repeat('c',64), ''); raise exception 'Blank name saved'; exception when check_violation then null; end;
  perform public.delete_recording_capture(current_setting('test.coach_capture')::uuid, current_setting('test.token'), repeat('c',64));
end $$;

-- Owner moderation and bounded storage.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$ declare v_id uuid; begin
  v_id := public.add_recording_capture(23456, current_setting('test.image'), '', null, current_setting('test.token'), repeat('c',64), 'Coach');
  perform public.delete_recording_capture(v_id);
  for i in 2..50 loop perform public.add_recording_capture(i, current_setting('test.image'), '', current_setting('test.recording')::uuid); end loop;
  begin perform public.add_recording_capture(1, current_setting('test.image'), '', current_setting('test.recording')::uuid); raise exception 'Capture quota bypass'; exception when invalid_parameter_value then null; end;
  perform public.revoke_recording_share(current_setting('test.recording')::uuid);
end $$;
set local role anon;
do $$ begin
  begin perform public.list_recording_captures(null, current_setting('test.token')); raise exception 'Revoked list'; exception when insufficient_privilege then null; end;
  begin perform public.get_recording_capture(current_setting('test.capture')::uuid, current_setting('test.token')); raise exception 'Revoked image'; exception when insufficient_privilege then null; end;
  begin perform public.add_recording_capture(1, current_setting('test.image'), '', null, current_setting('test.token'), repeat('c',64), 'Coach'); raise exception 'Revoked add'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- An expired Stream session denies metadata, images and writes as well.
select public.add_stream_recording('11111111-1111-4111-8111-111111111111', 'Stream still', repeat('e',32), null) as stream_recording \gset
set local role authenticated;
select public.create_recording_share(:'stream_recording') as stream_token \gset
select public.add_recording_capture(12345, current_setting('test.image'), '', :'stream_recording') as stream_capture \gset
select set_config('test.stream_token', :'stream_token', true);
select set_config('test.stream_capture', :'stream_capture', true);
reset role;
update public.recording_shares set session_hash = repeat('b',64), session_expires_at = statement_timestamp() - interval '1 second' where recording_id = :'stream_recording';
set local role anon;
do $$ begin
  begin perform public.list_recording_captures(null, current_setting('test.stream_token')); raise exception 'Expired list'; exception when insufficient_privilege then null; end;
  begin perform public.get_recording_capture(current_setting('test.stream_capture')::uuid, current_setting('test.stream_token')); raise exception 'Expired image'; exception when insufficient_privilege then null; end;
  begin perform public.add_recording_capture(1, current_setting('test.image'), '', null, current_setting('test.stream_token'), repeat('c',64), 'Coach'); raise exception 'Expired write'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Disabled membership also ends guest image access.
update public.recording_shares set revoked_at = null where recording_id = current_setting('test.recording')::uuid;
update public.owner_memberships set enabled = false where user_id = '11111111-1111-4111-8111-111111111111';
set local role anon;
do $$ begin
  begin perform public.get_recording_capture(current_setting('test.capture')::uuid, current_setting('test.token')); raise exception 'Disabled owner image'; exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: capture ownership, guest authorship, JPEG validation, quota, moderation and revoked/disabled access'
