\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id) select id from auth.users;
select public.add_stream_recording('11111111-1111-4111-8111-111111111111', 'Private game', repeat('d',32), null) as recording \gset
select set_config('test.recording', :'recording', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.create_recording_share(:'recording') as token \gset
select set_config('test.token', :'token', true);
do $$ begin
  begin
    perform public.add_stream_recording(auth.uid(), 'Bypass', repeat('e',32));
    raise exception 'Client bypassed provider verification';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  if (select provider from public.resolve_recording_share(current_setting('test.token'))) <> 'stream' then raise exception 'Metadata unavailable'; end if;
  begin
    perform public.authorize_stream_share(current_setting('test.token'), repeat('b',64), true);
    raise exception 'Client bypassed signing backend';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.recording_shares;
    raise exception 'Session hashes exposed';
  exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$ declare v_end timestamptz; begin
  if exists(select 1 from public.authorize_stream_share(current_setting('test.token'), repeat('b',64), false)) then raise exception 'Renew started a session'; end if;
  if exists(select 1 from public.authorize_stream_share(current_setting('test.token'), null, true)) then raise exception 'Null session accepted'; end if;
  select session_expires_at into v_end from public.authorize_stream_share(current_setting('test.token'), repeat('b',64), true);
  if v_end is null or abs(extract(epoch from (v_end - statement_timestamp())) - 7200) > 1 then raise exception 'Wrong session deadline'; end if;
  if (select session_expires_at from public.authorize_stream_share(current_setting('test.token'), repeat('b',64), true)) <> v_end then raise exception 'Restart extended session'; end if;
  if (select session_expires_at from public.authorize_stream_share(current_setting('test.token'), repeat('b',64), false)) <> v_end then raise exception 'Renew extended session'; end if;
  if exists(select 1 from public.authorize_stream_share(current_setting('test.token'), repeat('c',64), true)) then raise exception 'Second browser claimed session'; end if;
end $$;
reset role;
update public.recording_shares set session_expires_at = statement_timestamp() - interval '1 second';
set local role service_role;
do $$ begin
  if exists(select 1 from public.authorize_stream_share(current_setting('test.token'), repeat('b',64), true)) then raise exception 'Expired session restarted'; end if;
end $$;
set local role anon;
do $$ begin
  if exists(select 1 from public.resolve_recording_share(current_setting('test.token'))) then raise exception 'Expired link resolved'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if exists(select 1 from public.list_recordings()) then raise exception 'Cross-owner listing'; end if;
  begin
    perform public.create_recording_share(current_setting('test.recording')::uuid);
    raise exception 'Cross-owner replacement';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.create_recording_share(:'recording') as replacement \gset
select set_config('test.replacement', :'replacement', true);
reset role;
update public.recording_shares set start_before = statement_timestamp() - interval '1 second' where revoked_at is null;
set local role service_role;
do $$ begin
  if exists(select 1 from public.authorize_stream_share(current_setting('test.replacement'), repeat('b',64), true)) then raise exception 'Unused link never expired'; end if;
  if exists(select 1 from public.authorize_stream_share(current_setting('test.token'), repeat('b',64), false)) then raise exception 'Old share survived rotation'; end if;
end $$;
reset role;
update public.recording_shares set start_before = statement_timestamp() + interval '1 day' where revoked_at is null;
set local role service_role;
select * from public.authorize_stream_share(:'replacement', repeat('b',64), true);
reset role;
update public.owner_memberships set enabled = false where user_id = '11111111-1111-4111-8111-111111111111';
set local role service_role;
do $$ begin
  if exists(select 1 from public.authorize_stream_share(current_setting('test.replacement'), repeat('b',64), false)) then raise exception 'Disabled owner session renewed'; end if;
end $$;
reset role;
update public.owner_memberships set enabled = true;
set local role authenticated;
select public.revoke_recording_share(:'recording');
set local role service_role;
do $$ begin
  if exists(select 1 from public.authorize_stream_share(current_setting('test.replacement'), repeat('b',64), false)) then raise exception 'Revoked session renewed'; end if;
end $$;
reset role;
rollback;
\echo 'PASS: Stream capability grants, single browser claim, fixed deadline, unused expiry, rotation, revocation, disabled owner'
