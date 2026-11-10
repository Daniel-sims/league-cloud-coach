begin;
do $$ begin
  if has_table_privilege('anon','public.riot_credentials','select') or has_table_privilege('authenticated','public.riot_credentials','select') then raise exception 'Token read leak'; end if;
  if has_table_privilege('authenticated','public.riot_credentials','insert') or has_table_privilege('authenticated','public.riot_credentials','update') or has_table_privilege('authenticated','public.riot_credentials','delete') then raise exception 'Unverified token write'; end if;
  if not has_table_privilege('service_role','public.riot_credentials','select') or not has_table_privilege('service_role','public.riot_credentials','insert') then raise exception 'Backend token access missing'; end if;
end; $$;
rollback;
