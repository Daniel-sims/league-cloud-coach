-- Matchups: the owner's notes on playing one champion into a lane opponent, read
-- before a game, plus compact lane-difference curves for the Stats tab.

create table public.matchup_notes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  champion_id integer not null check (champion_id between 1 and 100000),
  opponent_id integer not null check (opponent_id between 1 and 100000),
  difficulty text check (difficulty in ('easy', 'even', 'hard')),
  plan text not null default '' check (length(plan) <= 300),
  threats jsonb not null default '[]' check (jsonb_typeof(threats) = 'array' and jsonb_array_length(threats) <= 20),
  tips jsonb not null default '[]' check (jsonb_typeof(tips) = 'array' and jsonb_array_length(tips) <= 20),
  build text not null default '' check (length(build) <= 1000),
  notes text not null default '' check (length(notes) <= 20000),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, champion_id, opponent_id)
);
alter table public.matchup_notes enable row level security;
revoke all on public.matchup_notes from public, anon, authenticated;

create function coach_private.matchup_json(m public.matchup_notes) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('championId',m.champion_id,'opponentId',m.opponent_id,
    'difficulty',m.difficulty,'plan',m.plan,'threats',m.threats,'tips',m.tips,'build',m.build,
    'notes',m.notes,'revision',m.revision,'updatedAt',m.updated_at);
$$;
revoke all on function coach_private.matchup_json(public.matchup_notes) from public, anon, authenticated;

create function public.list_matchups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  return coalesce((select jsonb_agg(coach_private.matchup_json(m) order by m.updated_at desc)
    from public.matchup_notes m where m.owner_id = v_owner), '[]'::jsonb);
end; $$;

-- p_revision 0 creates the note; any other value must match the stored revision.
create function public.save_matchup(p_champion integer, p_opponent integer, p_revision bigint, p_note jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner(); v_row public.matchup_notes; v_item jsonb; v_list text;
begin
  if p_champion is null or p_opponent is null or p_champion not between 1 and 100000
    or p_opponent not between 1 and 100000 or p_revision is null or p_revision < 0
    or p_note is null or jsonb_typeof(p_note) <> 'object'
    or coalesce(jsonb_typeof(p_note->'plan'), '') <> 'string' or length(p_note->>'plan') > 300
    or coalesce(jsonb_typeof(p_note->'build'), '') <> 'string' or length(p_note->>'build') > 1000
    or coalesce(jsonb_typeof(p_note->'notes'), '') <> 'string' or length(p_note->>'notes') > 20000
    or not (coalesce(p_note->'difficulty', 'null'::jsonb) = 'null'::jsonb
      or coalesce(p_note->>'difficulty', '') in ('easy','even','hard')) then
    raise exception 'Matchup note is too large or malformed' using errcode = '22023';
  end if;
  foreach v_list in array array['threats','tips'] loop
    if coalesce(jsonb_typeof(p_note->v_list), '') <> 'array' or jsonb_array_length(p_note->v_list) > 20 then
      raise exception 'Matchup note is too large or malformed' using errcode = '22023';
    end if;
    for v_item in select * from jsonb_array_elements(p_note->v_list) loop
      if jsonb_typeof(v_item) <> 'string' or length(v_item #>> '{}') > 300 then
        raise exception 'Matchup point is malformed' using errcode = '22023';
      end if;
    end loop;
  end loop;
  select * into v_row from public.matchup_notes
    where owner_id = v_owner and champion_id = p_champion and opponent_id = p_opponent for update;
  if (found and v_row.revision <> p_revision) or (not found and p_revision <> 0) then
    raise exception 'These notes changed in another tab. Reload to see the latest.' using errcode = '40001';
  end if;
  if not found then
    if (select count(*) from public.matchup_notes where owner_id = v_owner) >= 2000 then
      raise exception 'Matchup limit reached' using errcode = '54000';
    end if;
    insert into public.matchup_notes(owner_id,champion_id,opponent_id,difficulty,plan,threats,tips,build,notes)
      values(v_owner,p_champion,p_opponent,p_note->>'difficulty',p_note->>'plan',p_note->'threats',
        p_note->'tips',p_note->>'build',p_note->>'notes')
      returning * into v_row;
  else
    update public.matchup_notes set difficulty = p_note->>'difficulty', plan = p_note->>'plan',
      threats = p_note->'threats', tips = p_note->'tips', build = p_note->>'build', notes = p_note->>'notes',
      revision = revision + 1, updated_at = now()
      where owner_id = v_owner and champion_id = p_champion and opponent_id = p_opponent
      returning * into v_row;
  end if;
  return coach_private.matchup_json(v_row);
end; $$;

create function public.delete_matchup(p_champion integer, p_opponent integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  delete from public.matchup_notes
    where owner_id = v_owner and champion_id = p_champion and opponent_id = p_opponent;
end; $$;

-- Per-minute lane differences (you minus your lane opponent) from the owner's
-- stored game timelines: { matchId: [[seconds, gold, cs, xp], …] }. Games with
-- no stored timeline or no lane opponent are left out. Only derived numbers
-- leave the database, never the stored payload.
create function public.list_matchup_lanes(p_matches text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  if p_matches is null or cardinality(p_matches) > 500 then
    raise exception 'Too many games requested' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_object_agg(lane.match_id, lane.frames)
    from (
      select distinct on (m.match_id) m.match_id, (
        select jsonb_agg(jsonb_build_array(
            round((f->>'t')::numeric / 1000)::integer,
            (f->'snapshots'->me.id->>'gold')::integer - (f->'snapshots'->opp.id->>'gold')::integer,
            coalesce((f->'snapshots'->me.id->>'cs')::integer, 0) + coalesce((f->'snapshots'->me.id->>'jungleCs')::integer, 0)
              - coalesce((f->'snapshots'->opp.id->>'cs')::integer, 0) - coalesce((f->'snapshots'->opp.id->>'jungleCs')::integer, 0),
            coalesce((f->'snapshots'->me.id->>'xp')::integer, 0) - coalesce((f->'snapshots'->opp.id->>'xp')::integer, 0))
          order by fr.n)
        from jsonb_array_elements(m.review->'frames') with ordinality as fr(f, n)
        where f->'snapshots' ? me.id and f->'snapshots' ? opp.id and fr.n <= 90
      ) as frames
      from public.league_matches m
      join public.league_profiles p on p.id = m.profile_id and p.owner_id = v_owner
      cross join lateral (
        select r->>'id' as id, r->>'teamId' as team, r->>'position' as position
        from jsonb_array_elements(m.review->'participants') r
        where r->>'id' = m.review->>'playerId' limit 1
      ) me
      cross join lateral (
        select r->>'id' as id
        from jsonb_array_elements(m.review->'participants') r
        where r->>'teamId' <> me.team and me.position <> '' and r->>'position' = me.position limit 1
      ) opp
      where m.match_id = any(p_matches) and jsonb_typeof(m.review->'frames') = 'array'
      order by m.match_id
    ) lane
    where lane.frames is not null), '{}'::jsonb);
end; $$;

revoke all on function public.list_matchups(), public.save_matchup(integer,integer,bigint,jsonb),
  public.delete_matchup(integer,integer), public.list_matchup_lanes(text[]) from public, anon;
grant execute on function public.list_matchups(), public.save_matchup(integer,integer,bigint,jsonb),
  public.delete_matchup(integer,integer), public.list_matchup_lanes(text[]) to authenticated;
