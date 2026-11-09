-- Run as an administrator against a disposable database after the migration.
-- Everything, including synthetic users, is rolled back. A failure exits psql.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.owner_memberships(user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Owner can manage a library and generate a capability.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.add_recording('Owner one game', 'aB3_dE-fG09', '2026-11-09') as first_id \gset
select public.create_recording_share(:'first_id') as first_token \gset
select set_config('test.first_id', :'first_id', true);
select set_config('test.first_token', :'first_token', true);
do $$ begin
  if not public.is_library_owner() then raise exception 'Owner membership not recognised'; end if;
  if (select count(*) from public.list_recordings()) <> 1 then raise exception 'Owner cannot see own library'; end if;
  if (select count(*) from public.resolve_recording_share(current_setting('test.first_token'))) <> 1 then raise exception 'Valid capability did not resolve'; end if;
  begin
    perform public.add_recording('Duplicate', 'aB3_dE-fG09');
    raise exception 'Duplicate video accepted';
  exception when unique_violation then null; end;
  begin
    perform public.add_recording('Bad ID', '<script>');
    raise exception 'Invalid video accepted';
  exception when check_violation then null; end;
  begin
    perform public.add_recording('  ', 'bB3_dE-fG09');
    raise exception 'Blank title accepted';
  exception when check_violation then null; end;
  begin
    update public.owner_memberships set enabled = false;
    raise exception 'Client changed its own membership';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.recordings(owner_id, title, youtube_video_id) values(auth.uid(), 'Bypass', 'cB3_dE-fG09');
    raise exception 'Client bypassed controlled writes';
  exception when insufficient_privilege then null; end;
end $$;

-- A second authorised owner still cannot see or change the first owner's rows.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if exists(select 1 from public.recordings) then raise exception 'Cross-owner table read'; end if;
  if exists(select 1 from public.list_recordings()) then raise exception 'Cross-owner RPC listing'; end if;
  begin
    perform public.rename_recording(current_setting('test.first_id')::uuid, 'Stolen');
    raise exception 'Cross-owner rename';
  exception when insufficient_privilege then null; end;
  begin
    perform public.remove_recording(current_setting('test.first_id')::uuid);
    raise exception 'Cross-owner removal';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_recording_share(current_setting('test.first_id')::uuid);
    raise exception 'Cross-owner share creation';
  exception when insufficient_privilege then null; end;
  begin
    perform public.revoke_recording_share(current_setting('test.first_id')::uuid);
    raise exception 'Cross-owner share revocation';
  exception when insufficient_privilege then null; end;
end $$;

-- A signed-in account without membership has no owner powers.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$ begin
  if public.is_library_owner() then raise exception 'Unauthorised membership'; end if;
  if exists(select 1 from public.recordings) then raise exception 'Unauthorised table read'; end if;
  begin
    perform public.list_recordings(); raise exception 'Unauthorised listing';
  exception when insufficient_privilege then null; end;
  begin
    perform public.add_recording('Unauthorised', 'bB3_dE-fG09'); raise exception 'Unauthorised add';
  exception when insufficient_privilege then null; end;
end $$;

-- Anonymous visitors can resolve one known capability, but cannot enumerate.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  if (select count(*) from public.resolve_recording_share(current_setting('test.first_token'))) <> 1 then raise exception 'Anonymous valid share failed'; end if;
  if exists(select 1 from public.resolve_recording_share(repeat('a',64))) then raise exception 'Unknown share resolved'; end if;
  if exists(select 1 from public.resolve_recording_share('bad')) then raise exception 'Malformed share resolved'; end if;
  begin
    perform 1 from public.recordings; raise exception 'Anonymous table enumeration';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.recording_shares; raise exception 'Anonymous token hash enumeration';
  exception when insufficient_privilege then null; end;
  begin
    perform public.list_recordings(); raise exception 'Anonymous RPC enumeration';
  exception when insufficient_privilege then null; end;
  begin
    perform public.add_recording('Anonymous', 'bB3_dE-fG09'); raise exception 'Anonymous mutation';
  exception when insufficient_privilege then null; end;
end $$;

-- Rotation invalidates old links. Renames appear on valid watch pages.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.create_recording_share(:'first_id') as new_token \gset
select set_config('test.new_token', :'new_token', true);
select public.rename_recording(:'first_id', 'Renamed game');
do $$ begin
  if exists(select 1 from public.resolve_recording_share(current_setting('test.first_token'))) then raise exception 'Old link survived rotation'; end if;
  if (select title from public.resolve_recording_share(current_setting('test.new_token'))) <> 'Renamed game' then raise exception 'Shared title did not update'; end if;
end $$;
select public.revoke_recording_share(:'first_id');
do $$ begin
  if exists(select 1 from public.resolve_recording_share(current_setting('test.new_token'))) then raise exception 'Revoked share resolved'; end if;
end $$;
select public.create_recording_share(:'first_id') as last_token \gset
select set_config('test.last_token', :'last_token', true);
reset role;
update public.owner_memberships set enabled = false where user_id = '11111111-1111-4111-8111-111111111111';
set local role anon;
do $$ begin
  if exists(select 1 from public.resolve_recording_share(current_setting('test.last_token'))) then raise exception 'Disabled owner share resolved'; end if;
end $$;
reset role;
update public.owner_memberships set enabled = true where user_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.remove_recording(:'first_id');
do $$ begin
  if exists(select 1 from public.resolve_recording_share(current_setting('test.last_token'))) then raise exception 'Removed recording still shared'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.recording_shares) then raise exception 'Share records did not cascade on removal'; end if;
end $$;
rollback;
\echo 'PASS: ownership, grants, validation, anonymous lookup, rotation, revocation, disabled membership, and deletion'
