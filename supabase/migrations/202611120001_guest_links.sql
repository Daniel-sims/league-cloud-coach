-- Named guests. The owner creates a link *for* a person ("Coach Sam"); whatever
-- that link's holder writes is attributed to that name, from any browser, and
-- replacing the link keeps the person's identity. Anyone-with-the-link shares
-- (no guest) keep working as before.
create table public.recording_guests (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  -- Bearer secret returned only to a valid link holder. It is the guest's
  -- authorship key: the same value existing comment/notes/capture RPCs hash.
  author_key text not null check (author_key ~ '^[a-f0-9]{64}$'),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create unique index recording_guests_name_idx on public.recording_guests(recording_id, lower(btrim(name)));
create unique index recording_guests_hash_idx on public.recording_guests(recording_id, key_hash);
alter table public.recording_guests enable row level security;
revoke all on public.recording_guests from public, anon, authenticated;

alter table public.recording_shares add column guest_id uuid references public.recording_guests(id) on delete cascade;
drop index public.recording_shares_one_active_idx;
create unique index recording_shares_one_open_idx on public.recording_shares(recording_id) where revoked_at is null and guest_id is null;
create unique index recording_shares_one_guest_idx on public.recording_shares(guest_id) where revoked_at is null and guest_id is not null;

-- The anyone-link controls only touch the unnamed share.
create or replace function public.create_recording_share(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner(); v_token text;
begin
  perform 1 from public.recordings where id = p_id and owner_id = v_user for update;
  if not found then raise exception 'Recording unavailable' using errcode = '42501'; end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.recording_shares set revoked_at = now() where recording_id = p_id and revoked_at is null and guest_id is null;
  insert into public.recording_shares(recording_id, token_hash) values(p_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;
create or replace function public.revoke_recording_share(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  perform 1 from public.recordings where id = p_id and owner_id = v_user for update;
  if not found then raise exception 'Recording unavailable' using errcode = '42501'; end if;
  update public.recording_shares set revoked_at = now() where recording_id = p_id and revoked_at is null and guest_id is null;
end;
$$;

-- Creating a link for an existing name rotates that guest's link and keeps
-- their authorship; a new name adds a guest.
create function public.create_guest_link(p_id uuid, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner(); v_token text; v_guest uuid; v_key text; v_name text := btrim(p_name);
begin
  if p_name is null or length(v_name) not between 1 and 40 then
    raise exception 'Enter a name for this guest' using errcode = '22023';
  end if;
  perform 1 from public.recordings where id = p_id and owner_id = v_user for update;
  if not found then raise exception 'Recording unavailable' using errcode = '42501'; end if;
  select id into v_guest from public.recording_guests where recording_id = p_id and lower(btrim(name)) = lower(v_name);
  if v_guest is null then
    if (select count(*) from public.recording_guests where recording_id = p_id) >= 20 then
      raise exception 'This recording already has 20 guests' using errcode = '54000';
    end if;
    v_key := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.recording_guests(recording_id, name, author_key, key_hash)
      values(p_id, v_name, v_key, encode(extensions.digest(v_key, 'sha256'), 'hex')) returning id into v_guest;
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.recording_shares set revoked_at = now() where guest_id = v_guest and revoked_at is null;
  insert into public.recording_shares(recording_id, guest_id, token_hash)
    values(p_id, v_guest, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;

create function public.list_recording_guests(p_id uuid)
returns table(id uuid, name text, active boolean, link_created_at timestamptz, started_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform coach_private.owned_recording(p_id);
  return query select g.id, g.name,
    s.id is not null, s.created_at, s.session_expires_at - interval '2 hours'
    from public.recording_guests g
    left join public.recording_shares s on s.guest_id = g.id and s.revoked_at is null
    where g.recording_id = p_id order by lower(g.name);
end;
$$;

create function public.revoke_guest_link(p_id uuid, p_guest uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform coach_private.owned_recording(p_id);
  update public.recording_shares set revoked_at = now() where recording_id = p_id and guest_id = p_guest and revoked_at is null;
end;
$$;

-- Removing a guest ends their link; what they wrote stays, under the name
-- stamped when they wrote it.
create function public.remove_recording_guest(p_id uuid, p_guest uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform coach_private.owned_recording(p_id);
  delete from public.recording_guests where id = p_guest and recording_id = p_id;
end;
$$;

-- A guest's name is set by the owner, never by the browser.
create function coach_private.stamp_guest_name() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.author_role = 'coach' and new.author_key_hash is not null then
    select g.name into v_name from public.recording_guests g
      where g.recording_id = new.recording_id and g.key_hash = new.author_key_hash;
    if found then new.author_name := v_name; end if;
  end if;
  return new;
end;
$$;
revoke all on function coach_private.stamp_guest_name() from public, anon, authenticated;
create trigger stamp_guest_name before insert or update on public.recording_comments
  for each row execute function coach_private.stamp_guest_name();
create trigger stamp_guest_name before insert or update on public.recording_review_notes
  for each row execute function coach_private.stamp_guest_name();
create trigger stamp_guest_name before insert or update on public.recording_captures
  for each row execute function coach_private.stamp_guest_name();

-- Resolution tells a guest who they are.
drop function public.resolve_recording_share(text);
create function public.resolve_recording_share(p_token text)
returns table(title text, youtube_video_id text, recorded_on date, provider text, stream_video_id text,
  session_expires_at timestamptz, guest_name text, guest_key text)
language sql stable security definer set search_path = '' as $$
  select r.title, r.youtube_video_id, r.recorded_on, r.provider, r.stream_video_id, s.session_expires_at,
    g.name, g.author_key
  from public.recording_shares s join public.recordings r on r.id = s.recording_id
  join public.owner_memberships m on m.user_id = r.owner_id and m.enabled
  left join public.recording_guests g on g.id = s.guest_id
  where p_token ~ '^[a-f0-9]{64}$' and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and (r.provider = 'youtube' or coalesce(s.session_expires_at, s.start_before) > statement_timestamp());
$$;

-- Key moments: the owner flags places the coach should look at.
create table public.recording_moments (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  video_ms integer not null check (video_ms between 0 and 86400000),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index recording_moments_recording_idx on public.recording_moments(recording_id, video_ms);
alter table public.recording_moments enable row level security;
revoke all on public.recording_moments from public, anon, authenticated;

create function public.add_recording_moment(p_id uuid, p_video_ms integer, p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.owned_recording(p_id); v_id uuid;
begin
  perform 1 from public.recordings where id = v_recording for update;
  if (select count(*) from public.recording_moments where recording_id = v_recording) >= 100 then
    raise exception 'This recording has 100 key moments' using errcode = '54000';
  end if;
  insert into public.recording_moments(recording_id, video_ms, note)
    values(v_recording, p_video_ms, btrim(coalesce(p_note, ''))) returning id into v_id;
  return v_id;
end;
$$;
create function public.update_recording_moment(p_moment uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  update public.recording_moments m set note = btrim(coalesce(p_note, '')) from public.recordings r
    where m.id = p_moment and r.id = m.recording_id and r.owner_id = v_user;
  if not found then raise exception 'Moment unavailable' using errcode = '42501'; end if;
end;
$$;
create function public.delete_recording_moment(p_moment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coach_private.require_owner();
begin
  delete from public.recording_moments m using public.recordings r
    where m.id = p_moment and r.id = m.recording_id and r.owner_id = v_user;
  if not found then raise exception 'Moment unavailable' using errcode = '42501'; end if;
end;
$$;

create or replace function coach_private.review_json(p_recording uuid, p_owner boolean, p_viewer_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'matchId', t.match_id,
    'review', t.review,
    'syncedAt', t.synced_at,
    'anchor', case when r.game_time_anchor_seconds is null then null else jsonb_build_object(
      'gameTimeSeconds', r.game_time_anchor_seconds,
      'videoOffsetSeconds', r.video_offset_anchor_seconds) end,
    'moments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'videoMs', k.video_ms, 'note', k.note) order by k.video_ms, k.created_at)
      from public.recording_moments k where k.recording_id = r.id), '[]'::jsonb),
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

-- The owner also reads every guest's running notes (read-only), so the review
-- can be followed live. Guests still see only their own draft.
create or replace function coach_private.notes_json(p_recording uuid,p_owner boolean,p_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'draft', (select jsonb_build_object('body',n.draft_body,'version',n.revision,'author',n.author_name)
      from public.recording_review_notes n where n.recording_id = p_recording
        and ((p_owner and n.author_role = 'owner') or (not p_owner and n.author_key_hash = p_hash))),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
      'id',n.id,'body',n.published_body,'role',n.author_role,'author',n.author_name,'completedAt',n.completed_at,
      'mine', (p_owner and n.author_role = 'owner') or (not p_owner and coalesce(n.author_key_hash = p_hash,false)))
      order by n.completed_at desc,n.id)
      from public.recording_review_notes n where n.recording_id = p_recording and n.published_body is not null),'[]'::jsonb),
    'guestDrafts', case when p_owner then coalesce((select jsonb_agg(jsonb_build_object(
      'id',n.id,'author',n.author_name,'body',n.draft_body,'updatedAt',n.updated_at)
      order by n.updated_at desc,n.id)
      from public.recording_review_notes n where n.recording_id = p_recording
        and n.author_role = 'coach' and length(btrim(n.draft_body)) > 0),'[]'::jsonb) else '[]'::jsonb end);
$$;

revoke all on function public.create_guest_link(uuid,text), public.list_recording_guests(uuid),
  public.revoke_guest_link(uuid,uuid), public.remove_recording_guest(uuid,uuid),
  public.add_recording_moment(uuid,integer,text), public.update_recording_moment(uuid,text),
  public.delete_recording_moment(uuid), public.resolve_recording_share(text) from public, anon, authenticated;
grant execute on function public.create_guest_link(uuid,text), public.list_recording_guests(uuid),
  public.revoke_guest_link(uuid,uuid), public.remove_recording_guest(uuid,uuid),
  public.add_recording_moment(uuid,integer,text), public.update_recording_moment(uuid,text),
  public.delete_recording_moment(uuid) to authenticated;
grant execute on function public.resolve_recording_share(text) to anon, authenticated;
