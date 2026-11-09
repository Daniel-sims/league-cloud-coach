-- Stream is additive: existing YouTube recordings and shares retain their behavior.
alter table public.recordings drop constraint recordings_provider_check;
alter table public.recordings alter column youtube_video_id drop not null;
alter table public.recordings add column stream_video_id text;
alter table public.recordings add constraint recordings_provider_check check (
  (provider = 'youtube' and youtube_video_id is not null and stream_video_id is null) or
  (provider = 'stream' and youtube_video_id is null and stream_video_id ~ '^[a-f0-9]{32}$' and stream_video_id is not null)
);
create unique index recordings_owner_stream_idx on public.recordings(owner_id, stream_video_id) where provider = 'stream';
alter table public.recording_shares add column start_before timestamptz not null default (now() + interval '7 days');
alter table public.recording_shares add column session_hash text;
alter table public.recording_shares add column session_expires_at timestamptz;
alter table public.recording_shares add constraint share_session_pair check ((session_hash is null) = (session_expires_at is null));

-- Provider metadata is safe for owners, but playback tokens are never persisted.
drop function public.list_recordings();
create function public.list_recordings()
returns table(id uuid, title text, youtube_video_id text, recorded_on date, created_at timestamptz, has_share boolean, provider text, stream_video_id text)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  return query select r.id, r.title, r.youtube_video_id, r.recorded_on, r.created_at,
    exists(select 1 from public.recording_shares s where s.recording_id = r.id and s.revoked_at is null
      and (r.provider = 'youtube' or coalesce(s.session_expires_at, s.start_before) > statement_timestamp())),
    r.provider, r.stream_video_id from public.recordings r where r.owner_id = v_user order by r.created_at desc;
end;
$$;
revoke all on function public.list_recordings() from public, anon, authenticated;
grant execute on function public.list_recordings() to authenticated;

-- Only the backend may add a Stream ID, after verifying the Cloudflare account,
-- ready state, and requireSignedURLs. Owner identity comes from verified Auth.
create function public.add_stream_recording(p_owner uuid, p_title text, p_video_id text, p_recorded_on date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.owner_memberships where user_id = p_owner and enabled) then
    raise exception 'Library owner access required' using errcode = '42501';
  end if;
  insert into public.recordings(owner_id, title, provider, stream_video_id, recorded_on)
    values(p_owner, btrim(p_title), 'stream', p_video_id, p_recorded_on) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_stream_recording(uuid,text,text,date) from public, anon, authenticated;
grant execute on function public.add_stream_recording(uuid,text,text,date) to service_role;

-- Lookup never starts the clock (link scanners and previews must not claim it).
drop function public.resolve_recording_share(text);
create function public.resolve_recording_share(p_token text)
returns table(title text, youtube_video_id text, recorded_on date, provider text, stream_video_id text, session_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.title, r.youtube_video_id, r.recorded_on, r.provider, r.stream_video_id, s.session_expires_at
  from public.recording_shares s join public.recordings r on r.id = s.recording_id
  join public.owner_memberships m on m.user_id = r.owner_id and m.enabled
  where p_token ~ '^[a-f0-9]{64}$' and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and (r.provider = 'youtube' or coalesce(s.session_expires_at, s.start_before) > statement_timestamp());
$$;
revoke all on function public.resolve_recording_share(text) from public, anon, authenticated;
grant execute on function public.resolve_recording_share(text) to anon, authenticated;

-- Row locking makes first claim atomic; a different browser cannot take over.
-- Renewals never move the deadline. Only a new owner-generated share resets it.
create function public.authorize_stream_share(p_token text, p_session text, p_start boolean default false)
returns table(stream_video_id text, session_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_share public.recording_shares; v_video text;
begin
  if p_token is null or p_session is null or p_token !~ '^[a-f0-9]{64}$' or p_session !~ '^[a-f0-9]{64}$' then return; end if;
  select s.* into v_share from public.recording_shares s
    join public.recordings r on r.id = s.recording_id
    join public.owner_memberships m on m.user_id = r.owner_id and m.enabled
    where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and s.revoked_at is null and r.provider = 'stream' for update of s;
  if not found then return; end if;
  if v_share.session_hash is null then
    if not p_start or v_share.start_before <= statement_timestamp() then return; end if;
    update public.recording_shares set
      session_hash = encode(extensions.digest(p_session, 'sha256'), 'hex'),
      session_expires_at = statement_timestamp() + interval '2 hours'
      where id = v_share.id returning * into v_share;
  end if;
  if v_share.session_hash <> encode(extensions.digest(p_session, 'sha256'), 'hex')
    or v_share.session_expires_at <= statement_timestamp() then return; end if;
  select r.stream_video_id into v_video from public.recordings r where r.id = v_share.recording_id;
  return query select v_video, v_share.session_expires_at;
end;
$$;
revoke all on function public.authorize_stream_share(text,text,boolean) from public, anon, authenticated;
grant execute on function public.authorize_stream_share(text,text,boolean) to service_role;
