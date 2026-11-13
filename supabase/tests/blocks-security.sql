-- Run only against the disposable test database, after all migrations.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.owner_memberships(user_id,enabled) values('11111111-1111-4111-8111-111111111111',true),('22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if has_table_privilege('anon','public.play_blocks','select') or has_table_privilege('authenticated','public.play_blocks','select')
    or has_table_privilege('authenticated','public.play_blocks','insert') then raise exception 'Direct block access'; end if;
  if has_function_privilege('anon','public.list_blocks()','execute') or has_function_privilege('anon','public.save_block(uuid,bigint,text,jsonb,jsonb)','execute') then raise exception 'Anonymous block RPC'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select (public.create_block('Block one')->>'id') as first \gset
select set_config('test.first', :'first', true);
do $$ declare v jsonb; begin
  v := public.save_block(current_setting('test.first')::uuid,1,'Block one',
    '[{"id":"g1","title":"Ahri","notes":"Died to ganks"}]','["Ward river at 3:00","Back on cooldowns"]');
  if (v->>'revision')::int <> 2 then raise exception 'Revision not bumped'; end if;
  begin perform public.save_block(current_setting('test.first')::uuid,1,'x','[]','[]'); raise exception 'Stale save accepted'; exception when serialization_failure then null; end;
  begin perform public.save_block(current_setting('test.first')::uuid,2,'x','[{"id":"g","title":"t","notes":1}]','[]'); raise exception 'Malformed game saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_block(current_setting('test.first')::uuid,2,'x','[]','[5]'); raise exception 'Malformed point saved'; exception when invalid_parameter_value then null; end;
  v := public.save_block(current_setting('test.first')::uuid,2,'Block one','[{"id":"g1","title":"","notes":"","match":{"matchId":"EUW1_1"}}]','["Ward river at 3:00","Back on cooldowns"]');
  begin perform public.save_block(current_setting('test.first')::uuid,3,'x',jsonb_build_array(jsonb_build_object('id','g','title','','notes','','match',jsonb_build_object('pad',repeat('x',2000)))),'[]'); raise exception 'Oversized match saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_block(current_setting('test.first')::uuid,3,'x','[{"id":"g","title":"","notes":"","match":5}]','[]'); raise exception 'Non-object match saved'; exception when invalid_parameter_value then null; end;
  v := public.create_block('Block two');
  if v->'carryIn' <> '["Ward river at 3:00","Back on cooldowns"]'::jsonb then raise exception 'Carry-forward not carried in'; end if;
  if jsonb_array_length(public.list_blocks()) <> 2 then raise exception 'Own blocks missing'; end if;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if jsonb_array_length(public.list_blocks()) <> 0 then raise exception 'Cross-owner list leak'; end if;
  if public.create_block('Mine')->'carryIn' <> '[]'::jsonb then raise exception 'Carry-in crossed owners'; end if;
  begin perform public.save_block(current_setting('test.first')::uuid,3,'x','[]','[]'); raise exception 'Cross-owner write'; exception when insufficient_privilege then null; end;
  perform public.delete_block(current_setting('test.first')::uuid);
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  if jsonb_array_length(public.list_blocks()) <> 2 then raise exception 'Cross-owner delete'; end if;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  begin perform public.list_blocks(); raise exception 'Non-member read'; exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: blocks are owner-isolated, validated, revision-checked and carry points forward'
