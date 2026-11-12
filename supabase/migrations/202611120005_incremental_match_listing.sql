-- Listing the whole history in one value (11 MB for ~900 games) ran after every
-- sync page and could hit the 8 s statement timeout. Clients now pass the ids
-- they already hold and page through the rest. A null limit keeps the old
-- "everything" behaviour for clients that have not updated yet.
drop function public.list_league_matches(uuid);
create function public.list_league_matches(
  p_profile uuid,
  p_known text[] default '{}',
  p_limit integer default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  if not exists(select 1 from public.league_profiles where id = p_profile and owner_id = v_owner) then
    raise exception 'Profile unavailable' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(page.match order by page.game_creation desc)
    from (
      select m.match, m.game_creation
      from public.league_matches m
      where m.profile_id = p_profile
        and not (m.match_id = any(coalesce(p_known, '{}')))
      order by m.game_creation desc
      limit greatest(1, least(coalesce(p_limit, 100000), 100000))
    ) page
  ), '[]'::jsonb);
end; $$;
revoke all on function public.list_league_matches(uuid, text[], integer) from public, anon;
grant execute on function public.list_league_matches(uuid, text[], integer) to authenticated;
