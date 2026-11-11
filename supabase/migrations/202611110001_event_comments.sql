-- Explicit event references keep discussions attached without changing old notes.
alter table public.recording_comments add column event_ref jsonb
  check (event_ref is null or (jsonb_typeof(event_ref) = 'object' and octet_length(event_ref::text) <= 1000));

create function coach_private.validate_comment_event(p_recording uuid, p_event jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_event is null or jsonb_typeof(p_event) is distinct from 'object'
    or octet_length(p_event::text) > 1000
    or jsonb_typeof(p_event->'id') is distinct from 'string'
    or jsonb_typeof(p_event->'matchId') is distinct from 'string'
    or jsonb_typeof(p_event->'label') is distinct from 'string'
    or jsonb_typeof(p_event->'gameMs') is distinct from 'number' then
    raise exception 'Choose a timeline event' using errcode = '22023';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_event) k)
       <> array['gameMs','id','label','matchId']
    or p_event->>'id' !~ '^(death|kill|fight|ultimate|objective|recall|matchup)-[0-9-]{1,80}$'
    or p_event->>'matchId' !~ '^[A-Z0-9]+_[0-9]+$'
    or length(btrim(p_event->>'label')) not between 1 and 200
    or p_event->>'gameMs' !~ '^[0-9]{1,8}$' then
    raise exception 'Choose a timeline event' using errcode = '22023';
  end if;
  if (p_event->>'gameMs')::bigint > 14400000
    or not exists(select 1 from public.recording_timelines
      where recording_id = p_recording and match_id = p_event->>'matchId') then
    raise exception 'That event is not on the attached game' using errcode = '22023';
  end if;
end;
$$;
revoke all on function coach_private.validate_comment_event(uuid, jsonb) from public, anon, authenticated;

create or replace function coach_private.review_json(p_recording uuid, p_owner boolean, p_viewer_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'matchId', t.match_id,
    'review', t.review,
    'syncedAt', t.synced_at,
    'anchor', case when r.game_time_anchor_seconds is null then null else jsonb_build_object(
      'gameTimeSeconds', r.game_time_anchor_seconds,
      'videoOffsetSeconds', r.video_offset_anchor_seconds) end,
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'videoMs', c.video_ms, 'kind', c.kind, 'body', c.body,
        'role', c.author_role, 'author', c.author_name, 'event', c.event_ref,
        'mine', case when p_owner then c.author_role = 'owner'
                     else p_viewer_hash is not null and c.author_key_hash = p_viewer_hash end,
        'createdAt', c.created_at, 'updatedAt', c.updated_at)
      order by c.video_ms, c.created_at)
      from public.recording_comments c where c.recording_id = r.id), '[]'::jsonb))
  from public.recordings r left join public.recording_timelines t on t.recording_id = r.id
  where r.id = p_recording;
$$;

create function public.add_recording_event_comment(p_id uuid, p_video_ms integer, p_kind text, p_body text, p_event jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.owned_recording(p_id); v_comment uuid;
begin
  -- Serialize against match replacement and reuse existing ownership/room checks.
  perform 1 from public.recordings where id = v_recording for update;
  perform coach_private.validate_comment_event(v_recording, p_event);
  v_comment := public.add_recording_comment(v_recording, p_video_ms, p_kind, p_body);
  update public.recording_comments set event_ref = p_event where id = v_comment;
  return v_comment;
end;
$$;
create function public.add_shared_event_comment(p_token text, p_author_key text, p_author_name text,
  p_video_ms integer, p_kind text, p_body text, p_event jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token); v_comment uuid;
begin
  if v_recording is null then raise exception 'Watch link unavailable' using errcode = '42501'; end if;
  perform 1 from public.recordings where id = v_recording for update;
  perform coach_private.validate_comment_event(v_recording, p_event);
  v_comment := public.add_shared_comment(p_token, p_author_key, p_author_name, p_video_ms, p_kind, p_body);
  update public.recording_comments set event_ref = p_event where id = v_comment;
  return v_comment;
end;
$$;
revoke all on function public.add_recording_event_comment(uuid, integer, text, text, jsonb),
  public.add_shared_event_comment(text, text, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.add_recording_event_comment(uuid, integer, text, text, jsonb) to authenticated;
grant execute on function public.add_shared_event_comment(text, text, text, integer, text, text, jsonb) to anon, authenticated;
