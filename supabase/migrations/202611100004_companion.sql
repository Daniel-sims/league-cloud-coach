-- A companion holds an upload-only capability, never a browser session or Riot key.
create table public.companion_devices (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
alter table public.companion_devices enable row level security;
revoke all on public.companion_devices from public, anon, authenticated;

create function public.connect_companion(p_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid connection code' using errcode = '22023';
  end if;
  if (select count(*) from public.companion_devices where owner_id = v_owner) >= 10 then
    raise exception 'Disconnect an old companion first' using errcode = '54000';
  end if;
  -- An existing capability cannot be moved to another account or silently renewed.
  insert into public.companion_devices(token_hash, owner_id) values(p_hash, v_owner);
end;
$$;
create function public.list_companions() returns table(code text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select token_hash, created_at, expires_at from public.companion_devices
  where owner_id = coach_private.require_owner() order by created_at desc;
$$;
create function public.disconnect_companion(p_hash text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.companion_devices where token_hash = p_hash and owner_id = coach_private.require_owner();
end;
$$;
create function public.authorize_companion(p_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.owner_id from public.companion_devices d
  join public.owner_memberships m on m.user_id = d.owner_id and m.enabled
  where p_token ~ '^[a-f0-9]{64}$' and d.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and d.expires_at > statement_timestamp();
$$;

-- One atomic publish, preserving comments and preventing cross-owner writes.
create function public.publish_companion_review(
  p_owner uuid, p_recording uuid, p_review jsonb, p_game_time double precision, p_video_offset double precision
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_game_time is null or p_video_offset is null or not (p_game_time between 0 and 14400)
    or not (p_video_offset between 0 and 86400) then
    raise exception 'Sync the recording clock before pushing' using errcode = '22023';
  end if;
  perform public.save_recording_timeline(p_owner, p_recording, p_review->>'matchId', p_review);
  update public.recordings set game_time_anchor_seconds = p_game_time,
    video_offset_anchor_seconds = p_video_offset, updated_at = now()
    where id = p_recording and owner_id = p_owner;
end;
$$;

-- Service-only lookup for a verified companion; deliberately not a directory API.
create function public.companion_recording(p_owner uuid, p_video text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.recordings where owner_id = p_owner and stream_video_id = p_video and provider = 'stream';
$$;
revoke all on function public.connect_companion(text), public.list_companions(), public.disconnect_companion(text),
  public.authorize_companion(text), public.publish_companion_review(uuid,uuid,jsonb,double precision,double precision),
  public.companion_recording(uuid,text) from public, anon, authenticated;
grant execute on function public.connect_companion(text), public.list_companions(), public.disconnect_companion(text) to authenticated;
grant execute on function public.authorize_companion(text), public.publish_companion_review(uuid,uuid,jsonb,double precision,double precision),
  public.companion_recording(uuid,text) to service_role;

-- Refreshing the same Riot timeline on the web keeps locally detected casts.
-- Attaching a different match starts a fresh review without old cast metadata.
create or replace function public.save_recording_timeline(p_owner uuid, p_recording uuid, p_match text, p_review jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.owner_memberships where user_id = p_owner and enabled)
    or not exists(select 1 from public.recordings where id = p_recording and owner_id = p_owner) then
    raise exception 'Recording unavailable' using errcode = '42501';
  end if;
  if p_review is null or octet_length(p_review::text) > 2000000 then
    raise exception 'Timeline too large' using errcode = '22023';
  end if;
  insert into public.recording_timelines(recording_id, match_id, review) values(p_recording, p_match, p_review)
    on conflict (recording_id) do update set match_id = excluded.match_id,
      review = case when public.recording_timelines.match_id = excluded.match_id
        and public.recording_timelines.review ? 'ultimates' and not (excluded.review ? 'ultimates')
        then excluded.review || jsonb_build_object('ultimates', public.recording_timelines.review->'ultimates')
        else excluded.review end, synced_at = now();
  update public.recordings set riot_match_id = p_match, updated_at = now() where id = p_recording;
end;
$$;
