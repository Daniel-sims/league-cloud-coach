-- Incremental match history. The browser keeps each profile's games and used to
-- send every id it held (900+) with each request, then download the whole
-- history again daily (~10 MB) to catch backfilled fields. Each saved game now
-- records when its match data last changed, and clients ask only for games
-- changed after a cursor. Rows are written one short statement at a time, so a
-- client that rewinds its cursor a minute never misses a late commit.
alter table public.league_matches
  add column updated_at timestamptz not null default clock_timestamp();

create function coach_private.touch_league_match() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.match is distinct from old.match then new.updated_at := clock_timestamp(); end if;
  return new;
end;
$$;
revoke all on function coach_private.touch_league_match() from public, anon, authenticated;
create trigger league_matches_touch before update on public.league_matches
  for each row execute function coach_private.touch_league_match();

create index league_matches_changes on public.league_matches(profile_id, updated_at, match_id);

-- Pages through the owner's games in change order after (p_after, p_after_id).
-- Returns { matches, cursor: { at, id } | null }; cursor is the last row returned.
create function public.list_league_match_changes(
  p_profile uuid,
  p_after timestamptz default null,
  p_after_id text default null,
  p_limit integer default 200
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  if not exists(select 1 from public.league_profiles where id = p_profile and owner_id = v_owner) then
    raise exception 'Profile unavailable' using errcode = '42501';
  end if;
  return (
    with page as (
      select m.match, m.updated_at, m.match_id
      from public.league_matches m
      where m.profile_id = p_profile
        and (p_after is null or (m.updated_at, m.match_id) > (p_after, coalesce(p_after_id, '')))
      order by m.updated_at, m.match_id
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ), last as (
      select updated_at, match_id from page order by updated_at desc, match_id desc limit 1
    )
    select jsonb_build_object(
      'matches', coalesce((select jsonb_agg(page.match order by page.updated_at, page.match_id) from page), '[]'::jsonb),
      'cursor', (select jsonb_build_object('at', last.updated_at, 'id', last.match_id) from last))
  );
end; $$;
revoke all on function public.list_league_match_changes(uuid, timestamptz, text, integer) from public, anon;
grant execute on function public.list_league_match_changes(uuid, timestamptz, text, integer) to authenticated;
