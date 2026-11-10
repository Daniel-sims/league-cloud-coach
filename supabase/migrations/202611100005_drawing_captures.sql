-- Small, bounded JPEG review stills. Image bytes are fetched separately from
-- timeline metadata, through the same owner/watch capability checks as comments.
-- No public image URLs or new storage service are required.
create table public.recording_captures (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  video_ms integer not null check (video_ms between 0 and 86400000),
  body text not null default '' check (length(body) <= 2000),
  image bytea not null check (octet_length(image) between 4 and 262144),
  author_role text not null check (author_role in ('owner', 'coach')),
  author_name text check (author_name is null or length(btrim(author_name)) between 1 and 60),
  author_key_hash text check (author_key_hash is null or author_key_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check ((author_role = 'owner') = (author_key_hash is null)),
  check (author_role = 'owner' or author_name is not null)
);
create index recording_captures_recording_idx on public.recording_captures(recording_id, video_ms, created_at);
alter table public.recording_captures enable row level security;
revoke all on public.recording_captures from public, anon, authenticated;

create function coach_private.capture_recording(p_recording uuid, p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_token is null then return coach_private.owned_recording(p_recording); end if;
  v_id := coach_private.shared_recording(p_token);
  if v_id is null or (p_recording is not null and p_recording <> v_id) then
    raise exception 'Recording unavailable' using errcode = '42501';
  end if;
  return v_id;
end;
$$;
revoke all on function coach_private.capture_recording(uuid,text) from public, anon, authenticated;

create function public.list_recording_captures(p_recording uuid default null, p_token text default null, p_author_key text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_recording uuid := coach_private.capture_recording(p_recording, p_token); v_hash text;
begin
  if p_token is not null and p_author_key is not null then v_hash := coach_private.author_hash(p_author_key); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'videoMs', c.video_ms, 'body', c.body, 'role', c.author_role,
    'author', c.author_name, 'createdAt', c.created_at,
    'mine', case when p_token is null then c.author_role = 'owner' else coalesce(c.author_key_hash = v_hash, false) end)
    order by c.video_ms, c.created_at) from public.recording_captures c where c.recording_id = v_recording), '[]'::jsonb);
end;
$$;

create function public.get_recording_capture(p_capture uuid, p_token text default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_recording uuid; v_allowed uuid;
begin
  select recording_id into v_recording from public.recording_captures where id = p_capture;
  if v_recording is null then raise exception 'Capture unavailable' using errcode = '42501'; end if;
  v_allowed := coach_private.capture_recording(v_recording, p_token);
  return (select 'data:image/jpeg;base64,' || replace(encode(image, 'base64'), E'\n', '')
    from public.recording_captures where id = p_capture and recording_id = v_allowed);
end;
$$;

create function public.add_recording_capture(
  p_video_ms integer, p_image text, p_body text default '', p_recording uuid default null,
  p_token text default null, p_author_key text default null, p_author_name text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.capture_recording(p_recording, p_token);
  v_image bytea; v_id uuid; v_hash text;
begin
  if p_token is not null then v_hash := coach_private.author_hash(p_author_key); end if;
  if p_image is null or length(p_image) > 349551 or p_image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'A JPEG capture of at most 256 KiB is required' using errcode = '22023';
  end if;
  v_image := decode(substr(p_image, 24), 'base64');
  if octet_length(v_image) > 262144 or substring(v_image from 1 for 3) <> decode('ffd8ff', 'hex')
    or substring(v_image from octet_length(v_image)-1 for 2) <> decode('ffd9', 'hex') then
    raise exception 'Invalid JPEG capture' using errcode = '22023';
  end if;
  -- Serialize the quota check, including concurrent owner/coach saves.
  perform 1 from public.recordings where id = v_recording for update;
  if (select count(*) from public.recording_captures where recording_id = v_recording) >= 50 then
    raise exception 'This recording has 50 captures. Delete one before adding another.' using errcode = '22023';
  end if;
  insert into public.recording_captures(recording_id, video_ms, image, body, author_role, author_name, author_key_hash)
  values (v_recording, p_video_ms, v_image, btrim(coalesce(p_body, '')),
    case when p_token is null then 'owner' else 'coach' end,
    case when p_token is null then null else nullif(btrim(p_author_name), '') end, v_hash)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_recording_capture(p_capture uuid, p_token text default null, p_author_key text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_recording uuid; v_allowed uuid; v_hash text;
begin
  select recording_id into v_recording from public.recording_captures where id = p_capture;
  if v_recording is null then raise exception 'Capture unavailable' using errcode = '42501'; end if;
  v_allowed := coach_private.capture_recording(v_recording, p_token);
  if p_token is not null then v_hash := coach_private.author_hash(p_author_key); end if;
  delete from public.recording_captures where id = p_capture and recording_id = v_allowed
    and (p_token is null or author_key_hash = v_hash);
  if not found then raise exception 'Capture unavailable' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.list_recording_captures(uuid,text,text), public.get_recording_capture(uuid,text),
  public.add_recording_capture(integer,text,text,uuid,text,text,text), public.delete_recording_capture(uuid,text,text) from public, anon, authenticated;
grant execute on function public.list_recording_captures(uuid,text,text), public.get_recording_capture(uuid,text),
  public.add_recording_capture(integer,text,text,uuid,text,text,text), public.delete_recording_capture(uuid,text,text) to anon, authenticated;
