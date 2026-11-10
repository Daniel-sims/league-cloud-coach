-- Match history belongs to an enabled owner, never to an anonymous watch link.
create table public.league_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('euw1','eun1','na1','kr')),
  puuid text not null check (length(puuid) between 1 and 200),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  synced_at timestamptz,
  history_cursor integer not null default 0 check(history_cursor >= 0),
  sync_until timestamptz,
  unique(owner_id, platform, puuid)
);
create table public.league_matches (
  profile_id uuid not null references public.league_profiles(id) on delete cascade,
  match_id text not null,
  game_creation bigint not null,
  match jsonb not null check (jsonb_typeof(match) = 'object'),
  primary key(profile_id, match_id)
);
create index league_matches_recent on public.league_matches(profile_id, game_creation desc);
alter table public.league_profiles enable row level security;
alter table public.league_matches enable row level security;
revoke all on public.league_profiles, public.league_matches from public, anon, authenticated;

create function public.list_league_profiles() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  return coalesce((select jsonb_agg(p.profile || jsonb_build_object('id',p.id,'platform',p.platform,'puuid',p.puuid,'syncedAt',p.synced_at,'historyCursor',p.history_cursor) order by p.profile->>'gameName')
    from public.league_profiles p where p.owner_id = v_owner), '[]'::jsonb);
end; $$;
create function public.list_league_matches(p_profile uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  if not exists(select 1 from public.league_profiles where id = p_profile and owner_id = v_owner) then
    raise exception 'Profile unavailable' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(m.match order by m.game_creation desc) from public.league_matches m where m.profile_id = p_profile), '[]'::jsonb);
end; $$;

-- Only the verified Riot backend can write API-derived identity and statistics.
grant select, insert, update, delete on public.league_profiles, public.league_matches to service_role;
revoke all on function public.list_league_profiles(), public.list_league_matches(uuid) from public, anon;
grant execute on function public.list_league_profiles(), public.list_league_matches(uuid) to authenticated;

-- One sync at a time per profile, with crash recovery. No client-supplied owner.
create function public.claim_league_sync(p_profile uuid, p_owner uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.league_profiles set sync_until = now() + interval '90 seconds'
  where id = p_profile and owner_id = p_owner and (sync_until is null or sync_until < now())
    and exists(select 1 from public.owner_memberships where user_id = p_owner and enabled);
  return found;
end; $$;
revoke all on function public.claim_league_sync(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_league_sync(uuid,uuid) to service_role;

create function public.complete_league_sync(p_profile uuid, p_owner uuid, p_cursor integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.league_profiles set synced_at = now(), history_cursor = greatest(history_cursor,p_cursor)
  where id = p_profile and owner_id = p_owner;
end; $$;
revoke all on function public.complete_league_sync(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.complete_league_sync(uuid,uuid,integer) to service_role;

-- All edge instances share a conservative request schedule for the Riot key.
create table coach_private.riot_budget (id boolean primary key default true check(id), next_at timestamptz not null);
insert into coach_private.riot_budget values(true, now());
create function public.reserve_riot_request() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_next timestamptz; v_wait integer;
begin
  select next_at into v_next from coach_private.riot_budget where id for update;
  v_wait := greatest(0, ceil(extract(epoch from (v_next - clock_timestamp())) * 1000)::integer);
  if v_wait > 10000 then return -1; end if;
  update coach_private.riot_budget set next_at = greatest(next_at, clock_timestamp()) + interval '1400 milliseconds' where id;
  return v_wait;
end; $$;
revoke all on function public.reserve_riot_request() from public, anon, authenticated;
grant execute on function public.reserve_riot_request() to service_role;
