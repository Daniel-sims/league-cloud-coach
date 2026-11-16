-- The library shows which game each recording is: champion, lane opponent and,
-- when the owner has that match synced, the result and score. Everything comes
-- from the caller's own rows (synced matches for their own profiles, or the
-- review timeline stored with the recording); no Riot request is made and no
-- other player's identity is returned.
drop function public.list_recordings();
create function public.list_recordings()
returns table(id uuid, title text, youtube_video_id text, recorded_on date, created_at timestamptz,
  has_share boolean, provider text, stream_video_id text, game jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  return query
  select r.id, r.title, r.youtube_video_id, r.recorded_on, r.created_at,
    exists(select 1 from public.recording_shares s where s.recording_id = r.id and s.revoked_at is null
      and (r.provider = 'youtube' or coalesce(s.session_expires_at, s.start_before) > statement_timestamp())),
    r.provider, r.stream_video_id,
    coalesce(synced.summary, stored.summary)
  from public.recordings r
  -- The owner's own synced copy of the match knows the result and score.
  left join lateral (
    select jsonb_strip_nulls(jsonb_build_object(
      'matchId', m.match_id,
      'queueId', m.match->'queueId',
      'gameDuration', m.match->'gameDuration',
      'championId', me.value->'championId',
      'championName', me.value->'championName',
      'win', me.value->'win',
      'remake', me.value->'gameEndedInEarlySurrender',
      'kills', me.value->'kills',
      'deaths', me.value->'deaths',
      'assists', me.value->'assists',
      'opponentChampionId', opp.value->'championId',
      'opponentChampionName', opp.value->'championName')) as summary
    from public.league_matches m
    join public.league_profiles p on p.id = m.profile_id and p.owner_id = v_user
    cross join lateral (
      select e.value from jsonb_array_elements(m.match->'participants') e
      where e.value->>'puuid' = p.puuid limit 1
    ) me
    left join lateral (
      select e.value from jsonb_array_elements(m.match->'participants') e
      where e.value->>'teamId' <> me.value->>'teamId'
        and coalesce(e.value->>'teamPosition', '') <> ''
        and e.value->>'teamPosition' = me.value->>'teamPosition'
      limit 1
    ) opp on true
    where r.riot_match_id is not null and m.match_id = r.riot_match_id
    limit 1
  ) synced on true
  -- Otherwise the reduced review timeline still names both champions.
  left join lateral (
    select jsonb_strip_nulls(jsonb_build_object(
      'matchId', t.match_id,
      'queueId', t.review->'queueId',
      'gameDuration', t.review->'gameDuration',
      'championId', me.value->'championId',
      'championName', me.value->'championName',
      'opponentChampionId', opp.value->'championId',
      'opponentChampionName', opp.value->'championName')) as summary
    from public.recording_timelines t
    cross join lateral (
      select e.value from jsonb_array_elements(t.review->'participants') e
      where e.value->>'id' = t.review->>'playerId' limit 1
    ) me
    left join lateral (
      select e.value from jsonb_array_elements(t.review->'participants') e
      where e.value->>'teamId' <> me.value->>'teamId'
        and coalesce(e.value->>'position', '') <> ''
        and e.value->>'position' = me.value->>'position'
      limit 1
    ) opp on true
    where t.recording_id = r.id
  ) stored on true
  where r.owner_id = v_user
  order by r.created_at desc;
end;
$$;
revoke all on function public.list_recordings() from public, anon, authenticated;
grant execute on function public.list_recordings() to authenticated;
