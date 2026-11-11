-- Running notes are private drafts; completion publishes a separate snapshot.
create table public.recording_review_notes (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  author_role text not null check (author_role in ('owner','coach')),
  author_name text check (author_name is null or length(btrim(author_name)) between 1 and 60),
  author_key_hash text check (author_key_hash is null or author_key_hash ~ '^[a-f0-9]{64}$'),
  draft_body text not null default '' check (length(draft_body) <= 20000),
  published_body text check (published_body is null or length(btrim(published_body)) between 1 and 20000),
  revision bigint not null default 1 check (revision > 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((author_role = 'owner') = (author_key_hash is null)),
  check (author_role = 'owner' or author_name is not null),
  check ((published_body is null) = (completed_at is null))
);
create unique index recording_review_notes_owner on public.recording_review_notes(recording_id) where author_role = 'owner';
create unique index recording_review_notes_coach on public.recording_review_notes(recording_id,author_key_hash) where author_role = 'coach';
alter table public.recording_review_notes enable row level security;
revoke all on public.recording_review_notes from public, anon, authenticated;

create function coach_private.notes_json(p_recording uuid,p_owner boolean,p_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'draft', (select jsonb_build_object('body',n.draft_body,'version',n.revision,'author',n.author_name)
      from public.recording_review_notes n where n.recording_id = p_recording
        and ((p_owner and n.author_role = 'owner') or (not p_owner and n.author_key_hash = p_hash))),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
      'id',n.id,'body',n.published_body,'role',n.author_role,'author',n.author_name,'completedAt',n.completed_at,
      'mine', (p_owner and n.author_role = 'owner') or (not p_owner and coalesce(n.author_key_hash = p_hash,false)))
      order by n.completed_at desc,n.id)
      from public.recording_review_notes n where n.recording_id = p_recording and n.published_body is not null),'[]'::jsonb));
$$;
revoke all on function coach_private.notes_json(uuid,boolean,text) from public,anon,authenticated;

create function public.get_recording_notes(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coach_private.notes_json(coach_private.owned_recording(p_id),true,null);
$$;
create function public.get_shared_notes(p_token text,p_author_key text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token);
begin
  if v_recording is null then return null; end if;
  return coach_private.notes_json(v_recording,false,
    case when p_author_key is not null then coach_private.author_hash(p_author_key) end);
end;
$$;

create function coach_private.save_notes(p_recording uuid,p_owner boolean,p_hash text,p_name text,
  p_body text,p_version bigint,p_complete boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_note public.recording_review_notes; v_role text := case when p_owner then 'owner' else 'coach' end;
begin
  if p_body is null or length(p_body) > 20000 or p_version is null or p_version < 0 or p_complete is null
    or (p_complete and length(btrim(p_body)) = 0)
    or (not p_owner and (p_name is null or length(btrim(p_name)) not between 1 and 60)) then
    raise exception 'Enter your notes and name before completing the review' using errcode = '22023';
  end if;
  perform 1 from public.recordings where id = p_recording for update;
  select * into v_note from public.recording_review_notes n where n.recording_id = p_recording
    and n.author_role = v_role and (p_owner or n.author_key_hash = p_hash) for update;
  if found then
    if v_note.revision <> p_version then
      raise exception 'These notes changed in another tab. Copy your draft, then load the latest saved notes.' using errcode = '40001';
    end if;
    update public.recording_review_notes set draft_body = p_body,author_name = case when p_owner then null else btrim(p_name) end,
      revision = revision + 1,updated_at = now(),
      published_body = case when p_complete then btrim(p_body) else published_body end,
      completed_at = case when p_complete then now() else completed_at end where id = v_note.id;
  else
    if p_version <> 0 then
      raise exception 'These notes changed in another tab. Copy your draft, then load the latest saved notes.' using errcode = '40001';
    end if;
    if not p_owner and (select count(*) from public.recording_review_notes where recording_id = p_recording and author_role = 'coach') >= 49 then
      raise exception 'This recording has reached its review limit' using errcode = '54000';
    end if;
    insert into public.recording_review_notes(recording_id,author_role,author_name,author_key_hash,draft_body,published_body,completed_at)
      values(p_recording,v_role,case when p_owner then null else btrim(p_name) end,p_hash,p_body,
        case when p_complete then btrim(p_body) end,case when p_complete then now() end);
  end if;
  return coach_private.notes_json(p_recording,p_owner,p_hash);
end;
$$;
revoke all on function coach_private.save_notes(uuid,boolean,text,text,text,bigint,boolean) from public,anon,authenticated;
create function public.save_recording_notes(p_id uuid,p_body text,p_version bigint,p_complete boolean default false)
returns jsonb language sql security definer set search_path = '' as $$
  select coach_private.save_notes(coach_private.owned_recording(p_id),true,null,null,p_body,p_version,p_complete);
$$;
create function public.save_shared_notes(p_token text,p_author_key text,p_author_name text,p_body text,p_version bigint,p_complete boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token);
begin
  if v_recording is null then raise exception 'Watch link unavailable' using errcode = '42501'; end if;
  return coach_private.save_notes(v_recording,false,coach_private.author_hash(p_author_key),p_author_name,p_body,p_version,p_complete);
end;
$$;
revoke all on function public.get_recording_notes(uuid),public.get_shared_notes(text,text),
  public.save_recording_notes(uuid,text,bigint,boolean),public.save_shared_notes(text,text,text,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.get_recording_notes(uuid),public.save_recording_notes(uuid,text,bigint,boolean) to authenticated;
grant execute on function public.get_shared_notes(text,text),public.save_shared_notes(text,text,text,text,bigint,boolean) to anon,authenticated;
