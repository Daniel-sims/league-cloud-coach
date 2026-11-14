-- Pairs uploaded recordings with games: the companion sends the match id when it
-- pushes a game, and the web app shows that recording beside the match in Home.
-- Returns only the caller's own { matchId: recordingId } map (newest recording wins).
create function public.list_match_recordings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  return coalesce((
    select jsonb_object_agg(x.riot_match_id, x.id)
    from (
      select distinct on (r.riot_match_id) r.riot_match_id, r.id
      from public.recordings r
      where r.owner_id = v_owner and r.riot_match_id is not null
      order by r.riot_match_id, r.created_at desc
    ) x
  ), '{}'::jsonb);
end; $$;
revoke all on function public.list_match_recordings() from public, anon;
grant execute on function public.list_match_recordings() to authenticated;
