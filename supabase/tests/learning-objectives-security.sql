-- Run only against the disposable test database, after all migrations.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.owner_memberships(user_id,enabled) values('11111111-1111-4111-8111-111111111111',true),('22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if has_table_privilege('anon','public.learning_objectives','select') or has_table_privilege('authenticated','public.learning_objectives','select')
    or has_table_privilege('authenticated','public.learning_objectives','insert') or has_table_privilege('authenticated','public.learning_objectives','update') then
    raise exception 'Direct learning objectives access'; end if;
  if has_function_privilege('anon','public.get_learning_objectives()','execute')
    or has_function_privilege('anon','public.save_learning_objectives(bigint,text)','execute') then raise exception 'Anonymous objectives RPC'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare v jsonb; begin
  v := public.get_learning_objectives();
  if (v->>'revision')::int <> 0 or v->>'body' <> '' then raise exception 'Empty objectives not blank'; end if;
  v := public.save_learning_objectives(0,'# Focus\n- Ward river at 3:00');
  if (v->>'revision')::int <> 1 then raise exception 'First save revision wrong'; end if;
  begin perform public.save_learning_objectives(0,'stale insert'); raise exception 'Second first-save accepted'; exception when serialization_failure then null; end;
  v := public.save_learning_objectives(1,'# Focus\n- Track the jungler');
  if (v->>'revision')::int <> 2 then raise exception 'Revision not bumped'; end if;
  begin perform public.save_learning_objectives(1,'stale'); raise exception 'Stale save accepted'; exception when serialization_failure then null; end;
  begin perform public.save_learning_objectives(2,repeat('x',50001)); raise exception 'Oversized body saved'; exception when invalid_parameter_value then null; end;
  begin perform public.save_learning_objectives(2,null); raise exception 'Null body saved'; exception when invalid_parameter_value then null; end;
  if public.get_learning_objectives()->>'body' <> '# Focus\n- Track the jungler' then raise exception 'Saved body not returned'; end if;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare v jsonb; begin
  if (public.get_learning_objectives()->>'revision')::int <> 0 then raise exception 'Cross-owner read leak'; end if;
  begin perform public.save_learning_objectives(2,'overwrite'); raise exception 'Cross-owner write'; exception when serialization_failure then null; end;
  v := public.save_learning_objectives(0,'Mine');
  if (v->>'revision')::int <> 1 then raise exception 'Second owner first save failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  if public.get_learning_objectives()->>'body' <> '# Focus\n- Track the jungler' then raise exception 'Cross-owner overwrite'; end if;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  begin perform public.get_learning_objectives(); raise exception 'Non-member read'; exception when insufficient_privilege then null; end;
  begin perform public.save_learning_objectives(0,'x'); raise exception 'Non-member write'; exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: learning objectives are owner-isolated, bounded and revision-checked'
