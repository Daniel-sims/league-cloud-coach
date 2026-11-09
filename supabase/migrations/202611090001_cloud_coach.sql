-- Video bytes stay on YouTube. This database holds private library metadata.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.owner_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  provider text not null default 'youtube' check (provider = 'youtube'),
  youtube_video_id text not null check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  recorded_on date,
  riot_match_id text,
  game_time_anchor_seconds double precision,
  video_offset_anchor_seconds double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, youtube_video_id),
  check ((game_time_anchor_seconds is null) = (video_offset_anchor_seconds is null))
);
create index recordings_owner_created_idx on public.recordings(owner_id, created_at desc);

create table public.recording_shares (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index recording_shares_recording_idx on public.recording_shares(recording_id);
create unique index recording_shares_one_active_idx on public.recording_shares(recording_id) where revoked_at is null;

alter table public.owner_memberships enable row level security;
alter table public.recordings enable row level security;
alter table public.recording_shares enable row level security;

-- Authenticated users may check their own membership, never modify it.
revoke all on public.owner_memberships, public.recordings, public.recording_shares from anon, authenticated;
grant select on public.owner_memberships, public.recordings to authenticated;
create policy membership_read_self on public.owner_memberships for select to authenticated using (user_id = (select auth.uid()));

create function public.is_library_owner() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.owner_memberships m where m.user_id = (select auth.uid()) and m.enabled);
$$;
revoke all on function public.is_library_owner() from public;
grant execute on function public.is_library_owner() to authenticated;

create policy recording_read_own on public.recordings for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_library_owner()));

-- Private helper. Functions below use SECURITY DEFINER to expose narrow
-- operations without granting clients direct write access to any table.
create schema if not exists coach_private;
revoke all on schema coach_private from public, anon, authenticated;
create function coach_private.require_owner() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists(select 1 from public.owner_memberships where user_id = v_user and enabled) then
    raise exception 'Library owner access required' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function coach_private.require_owner() from public, anon, authenticated;

create function public.list_recordings()
returns table(id uuid, title text, youtube_video_id text, recorded_on date, created_at timestamptz, has_share boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  return query select r.id, r.title, r.youtube_video_id, r.recorded_on, r.created_at,
    exists(select 1 from public.recording_shares s where s.recording_id = r.id and s.revoked_at is null)
    from public.recordings r where r.owner_id = v_user order by r.created_at desc;
end;
$$;

create function public.add_recording(p_title text, p_video_id text, p_recorded_on date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner(); v_id uuid;
begin
  insert into public.recordings(owner_id, title, youtube_video_id, recorded_on)
    values(v_user, btrim(p_title), p_video_id, p_recorded_on) returning id into v_id;
  return v_id;
end;
$$;

create function public.rename_recording(p_id uuid, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  update public.recordings set title = btrim(p_title), updated_at = now() where id = p_id and owner_id = v_user;
  if not found then raise exception 'Recording unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.remove_recording(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  delete from public.recordings where id = p_id and owner_id = v_user;
  if not found then raise exception 'Recording unavailable' using errcode = '42501'; end if;
end;
$$;

-- Creating a new link deliberately rotates any existing link. Lock the parent
-- so simultaneous requests cannot leave more than one active share.
create function public.create_recording_share(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner(); v_token text;
begin
  perform 1 from public.recordings where id = p_id and owner_id = v_user for update;
  if not found then raise exception 'Recording unavailable' using errcode = '42501'; end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.recording_shares set revoked_at = now() where recording_id = p_id and revoked_at is null;
  insert into public.recording_shares(recording_id, token_hash) values(p_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;

create function public.revoke_recording_share(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  perform 1 from public.recordings where id = p_id and owner_id = v_user for update;
  if not found then raise exception 'Recording unavailable' using errcode = '42501'; end if;
  update public.recording_shares set revoked_at = now() where recording_id = p_id and revoked_at is null;
end;
$$;

-- Anonymous capability lookup, intentionally available without login.
-- Returning only these fields prevents library enumeration / identity exposure.
create function public.resolve_recording_share(p_token text)
returns table(title text, youtube_video_id text, recorded_on date)
language sql stable security definer set search_path = '' as $$
  select r.title, r.youtube_video_id, r.recorded_on
  from public.recording_shares s join public.recordings r on r.id = s.recording_id
  join public.owner_memberships m on m.user_id = r.owner_id and m.enabled
  where p_token ~ '^[a-f0-9]{64}$'
    and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null;
$$;

revoke all on function public.list_recordings(), public.add_recording(text,text,date), public.rename_recording(uuid,text), public.remove_recording(uuid), public.create_recording_share(uuid), public.revoke_recording_share(uuid), public.resolve_recording_share(text) from public, anon, authenticated;
grant execute on function public.list_recordings(), public.add_recording(text,text,date), public.rename_recording(uuid,text), public.remove_recording(uuid), public.create_recording_share(uuid), public.revoke_recording_share(uuid) to authenticated;
grant execute on function public.resolve_recording_share(text) to anon, authenticated;
