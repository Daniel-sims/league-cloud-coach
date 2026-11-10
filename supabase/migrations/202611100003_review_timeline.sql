-- Review timelines: the owner's Riot backend stores one reduced match timeline
-- per recording, so a coach with only the watch link needs no Riot token. The
-- game-clock anchor already lives on public.recordings. Timeline comments are
-- written by the owner (authenticated) or by anyone holding a valid watch link.
-- A coach proves authorship with a per-browser key; only its hash is stored.
create table public.recording_timelines (
  recording_id uuid primary key references public.recordings(id) on delete cascade,
  match_id text not null check (match_id ~ '^[A-Z0-9]+_[0-9]+$'),
  review jsonb not null check (jsonb_typeof(review) = 'object'),
  synced_at timestamptz not null default now()
);
create table public.recording_comments (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  video_ms integer not null check (video_ms between 0 and 86400000),
  kind text not null check (kind in ('comment', 'question', 'mindset')),
  body text not null check (length(btrim(body)) between 1 and 2000),
  author_role text not null check (author_role in ('owner', 'coach')),
  author_name text check (author_name is null or length(btrim(author_name)) between 1 and 60),
  author_key_hash text check (author_key_hash is null or author_key_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((author_role = 'owner') = (author_key_hash is null)),
  check (author_role = 'owner' or author_name is not null)
);
create index recording_comments_recording_idx on public.recording_comments(recording_id, video_ms);
alter table public.recording_timelines enable row level security;
alter table public.recording_comments enable row level security;
revoke all on public.recording_timelines, public.recording_comments from public, anon, authenticated;

-- The same validity rule as resolve_recording_share: what a guest can open is
-- exactly what a guest can review.
create function coach_private.shared_recording(p_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.recording_shares s
  join public.recordings r on r.id = s.recording_id
  join public.owner_memberships m on m.user_id = r.owner_id and m.enabled
  where p_token ~ '^[a-f0-9]{64}$' and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and (r.provider = 'youtube' or coalesce(s.session_expires_at, s.start_before) > statement_timestamp());
$$;
revoke all on function coach_private.shared_recording(text) from public, anon, authenticated;

create function coach_private.author_hash(p_key text) returns text
language plpgsql immutable security definer set search_path = '' as $$
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Comment author key required' using errcode = '22023';
  end if;
  return encode(extensions.digest(p_key, 'sha256'), 'hex');
end;
$$;
revoke all on function coach_private.author_hash(text) from public, anon, authenticated;

create function coach_private.owned_recording(p_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  if not exists(select 1 from public.recordings where id = p_id and owner_id = v_user) then
    raise exception 'Recording unavailable' using errcode = '42501';
  end if;
  return p_id;
end;
$$;
revoke all on function coach_private.owned_recording(uuid) from public, anon, authenticated;

-- Display data only: no owner identity, author key hashes or share data.
create function coach_private.review_json(p_recording uuid, p_owner boolean, p_viewer_hash text)
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
        'role', c.author_role, 'author', c.author_name,
        'mine', case when p_owner then c.author_role = 'owner'
                     else p_viewer_hash is not null and c.author_key_hash = p_viewer_hash end,
        'createdAt', c.created_at, 'updatedAt', c.updated_at)
      order by c.video_ms, c.created_at)
      from public.recording_comments c where c.recording_id = r.id), '[]'::jsonb))
  from public.recordings r left join public.recording_timelines t on t.recording_id = r.id
  where r.id = p_recording;
$$;
revoke all on function coach_private.review_json(uuid, boolean, text) from public, anon, authenticated;

create function public.get_recording_review(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return coach_private.review_json(coach_private.owned_recording(p_id), true, null);
end;
$$;

-- Invalid, revoked or expired links return null, like share resolution.
create function public.get_shared_review(p_token text, p_author_key text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token);
begin
  if v_recording is null then return null; end if;
  return coach_private.review_json(v_recording, false,
    case when p_author_key ~ '^[a-f0-9]{64}$' then coach_private.author_hash(p_author_key) end);
end;
$$;

create function public.set_recording_anchor(p_id uuid, p_game_time double precision, p_video_offset double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coach_private.owned_recording(p_id);
begin
  if (p_game_time is null) <> (p_video_offset is null)
    or p_game_time not between 0 and 14400 or p_video_offset not between 0 and 86400 then
    raise exception 'Enter a game time and video position' using errcode = '22023';
  end if;
  update public.recordings set game_time_anchor_seconds = p_game_time,
    video_offset_anchor_seconds = p_video_offset, updated_at = now() where id = v_id;
end;
$$;

create function public.detach_recording_timeline(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coach_private.owned_recording(p_id);
begin
  delete from public.recording_timelines where recording_id = v_id;
  update public.recordings set riot_match_id = null, updated_at = now() where id = v_id;
end;
$$;

-- Only the verified Riot backend writes API-derived timelines.
create function public.save_recording_timeline(p_owner uuid, p_recording uuid, p_match text, p_review jsonb)
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
    on conflict (recording_id) do update set match_id = excluded.match_id, review = excluded.review, synced_at = now();
  update public.recordings set riot_match_id = p_match, updated_at = now() where id = p_recording;
end;
$$;

create function coach_private.check_comment_room(p_recording uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from public.recording_comments where recording_id = p_recording) >= 1000 then
    raise exception 'This recording has reached its comment limit' using errcode = '54000';
  end if;
end;
$$;
revoke all on function coach_private.check_comment_room(uuid) from public, anon, authenticated;

create function public.add_recording_comment(p_id uuid, p_video_ms integer, p_kind text, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.owned_recording(p_id); v_comment uuid;
begin
  perform 1 from public.recordings where id = v_recording for update;
  perform coach_private.check_comment_room(v_recording);
  insert into public.recording_comments(recording_id, video_ms, kind, body, author_role)
    values(v_recording, p_video_ms, p_kind, btrim(p_body), 'owner') returning id into v_comment;
  return v_comment;
end;
$$;

-- Owners edit their own words and may remove anything on their recordings.
create function public.update_recording_comment(p_comment uuid, p_kind text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  update public.recording_comments c set kind = p_kind, body = btrim(p_body), updated_at = now()
    from public.recordings r
    where c.id = p_comment and c.author_role = 'owner' and r.id = c.recording_id and r.owner_id = v_user;
  if not found then raise exception 'Comment unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.delete_recording_comment(p_comment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  delete from public.recording_comments c using public.recordings r
    where c.id = p_comment and r.id = c.recording_id and r.owner_id = v_user;
  if not found then raise exception 'Comment unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.add_shared_comment(p_token text, p_author_key text, p_author_name text,
  p_video_ms integer, p_kind text, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token); v_comment uuid;
begin
  if v_recording is null then raise exception 'Watch link unavailable' using errcode = '42501'; end if;
  perform 1 from public.recordings where id = v_recording for update;
  perform coach_private.check_comment_room(v_recording);
  insert into public.recording_comments(recording_id, video_ms, kind, body, author_role, author_name, author_key_hash)
    values(v_recording, p_video_ms, p_kind, btrim(p_body), 'coach', btrim(p_author_name),
      coach_private.author_hash(p_author_key)) returning id into v_comment;
  return v_comment;
end;
$$;

create function public.update_shared_comment(p_token text, p_author_key text, p_comment uuid, p_kind text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token);
begin
  update public.recording_comments set kind = p_kind, body = btrim(p_body), updated_at = now()
    where id = p_comment and recording_id = v_recording and author_role = 'coach'
      and author_key_hash = coach_private.author_hash(p_author_key);
  if not found then raise exception 'Comment unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.delete_shared_comment(p_token text, p_author_key text, p_comment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token);
begin
  delete from public.recording_comments
    where id = p_comment and recording_id = v_recording and author_role = 'coach'
      and author_key_hash = coach_private.author_hash(p_author_key);
  if not found then raise exception 'Comment unavailable' using errcode = '42501'; end if;
end;
$$;

revoke all on function
  public.get_recording_review(uuid), public.get_shared_review(text, text),
  public.set_recording_anchor(uuid, double precision, double precision), public.detach_recording_timeline(uuid),
  public.save_recording_timeline(uuid, uuid, text, jsonb),
  public.add_recording_comment(uuid, integer, text, text), public.update_recording_comment(uuid, text, text),
  public.delete_recording_comment(uuid),
  public.add_shared_comment(text, text, text, integer, text, text),
  public.update_shared_comment(text, text, uuid, text, text), public.delete_shared_comment(text, text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.get_recording_review(uuid), public.set_recording_anchor(uuid, double precision, double precision),
  public.detach_recording_timeline(uuid), public.add_recording_comment(uuid, integer, text, text),
  public.update_recording_comment(uuid, text, text), public.delete_recording_comment(uuid)
  to authenticated;
grant execute on function
  public.get_shared_review(text, text), public.add_shared_comment(text, text, text, integer, text, text),
  public.update_shared_comment(text, text, uuid, text, text), public.delete_shared_comment(text, text, uuid)
  to anon, authenticated;
grant execute on function public.save_recording_timeline(uuid, uuid, text, jsonb) to service_role;
