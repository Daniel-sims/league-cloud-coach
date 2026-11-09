\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.owner_memberships(user_id) values ('11111111-1111-4111-8111-111111111111');
select public.add_stream_recording('11111111-1111-4111-8111-111111111111','Recovered video',repeat('d',32),null) as recording \gset
set local role service_role;
do $$ begin
  if not repeat('d',32) = any(public.list_stream_imports('11111111-1111-4111-8111-111111111111')) then raise exception 'Import not remembered'; end if;
  if cardinality(public.list_stream_imports('22222222-2222-4222-8222-222222222222')) <> 0 then raise exception 'Imports crossed owners'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.remove_recording(:'recording');
do $$ begin
  begin perform public.list_stream_imports(auth.uid()); raise exception 'Client enumerated imports'; exception when insufficient_privilege then null; end;
  begin delete from public.stream_imports; raise exception 'Client erased import history'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$ begin
  if not repeat('d',32) = any(public.list_stream_imports('11111111-1111-4111-8111-111111111111')) then raise exception 'Removal erased import history'; end if;
end $$;
select public.add_stream_recording('11111111-1111-4111-8111-111111111111','Explicit restore',repeat('d',32),null);
do $$ begin
  if cardinality(public.list_stream_imports('11111111-1111-4111-8111-111111111111')) <> 1 then raise exception 'Explicit restore duplicated import history'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform 1 from public.stream_imports; raise exception 'Anonymous import enumeration'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'PASS: imports remembered atomically, retained on removal, private grants, explicit restore'
