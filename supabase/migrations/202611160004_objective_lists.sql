-- Learning objectives become a list the player and coach keep together:
-- review -> objectives -> next review -> objectives. Each objective is either
-- for in game (while playing) or post game (when reviewing). The owner manages
-- them from the app; anyone holding a valid watch link for one of the owner's
-- recordings reads them and can change them, so a coach sets the next
-- objectives as they complete a review. Changes are attributed, never anonymous.
--
-- The old single markdown page is kept unreadable as learning_objectives_legacy.
drop function public.get_learning_objectives();
drop function public.save_learning_objectives(bigint, text);
alter table public.learning_objectives rename to learning_objectives_legacy;
alter table public.learning_objectives_legacy rename constraint learning_objectives_pkey to learning_objectives_legacy_pkey;

-- One row per owner: the name coaches see ("Daniel's learning objectives") and
-- the lock that serialises changes to that owner's list.
create table public.objective_players (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  player_name text check (player_name is null or length(btrim(player_name)) between 1 and 40)
);
alter table public.objective_players enable row level security;
revoke all on public.objective_players from public, anon, authenticated;

create table public.learning_objectives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.objective_players(owner_id) on delete cascade,
  phase text not null check (phase in ('in_game','post_game')),
  title text not null check (length(btrim(title)) between 1 and 200),
  details text not null default '' check (length(details) <= 4000),
  position integer not null,
  revision bigint not null default 1 check (revision > 0),
  archived_at timestamptz,
  edited_role text not null check (edited_role in ('owner','coach')),
  edited_by text check (edited_by is null or length(btrim(edited_by)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((edited_role = 'owner') = (edited_by is null))
);
create index learning_objectives_owner_idx on public.learning_objectives(owner_id, phase, position);
alter table public.learning_objectives enable row level security;
revoke all on public.learning_objectives from public, anon, authenticated;

-- Display data only: no owner identity or author keys.
create function coach_private.objectives_json(p_owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'playerName', (select p.player_name from public.objective_players p where p.owner_id = p_owner),
    'objectives', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'phase', o.phase, 'title', o.title, 'details', o.details, 'revision', o.revision,
        'archivedAt', o.archived_at, 'editedRole', o.edited_role, 'editedBy', o.edited_by,
        'createdAt', o.created_at, 'updatedAt', o.updated_at)
      order by o.archived_at desc nulls first, o.phase, o.position, o.created_at)
      from public.learning_objectives o where o.owner_id = p_owner), '[]'::jsonb));
$$;
revoke all on function coach_private.objectives_json(uuid) from public, anon, authenticated;

create function coach_private.change_objective(p_owner uuid, p_author text, p_action text, p_id uuid,
  p_phase text, p_title text, p_details text, p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := case when p_author is null then 'owner' else 'coach' end;
  v_row public.learning_objectives;
  v_next public.learning_objectives;
  v_details text := btrim(coalesce(p_details, ''));
  v_stale constant text := 'This objective changed or was removed. Reload the objectives to see the latest.';
begin
  if p_action is null or p_action not in ('create','update','archive','restore','delete','up','down') then
    raise exception 'Unknown objective change' using errcode = '22023';
  end if;
  if p_action in ('create','update') and (p_phase is null or p_phase not in ('in_game','post_game')
      or p_title is null or length(btrim(p_title)) not between 1 and 200 or length(v_details) > 4000) then
    raise exception 'Give the objective a title (up to 200 characters) and details up to 4,000 characters'
      using errcode = '22023';
  end if;
  if p_action <> 'create' and p_id is null then
    raise exception 'Choose an objective' using errcode = '22023';
  end if;

  -- One writer per owner list at a time: positions and the limit stay consistent.
  insert into public.objective_players(owner_id) values (p_owner) on conflict (owner_id) do nothing;
  perform 1 from public.objective_players where owner_id = p_owner for update;

  if p_action = 'create' then
    if (select count(*) from public.learning_objectives where owner_id = p_owner) >= 100 then
      raise exception 'You have 100 objectives. Delete some past ones first.' using errcode = '54000';
    end if;
    insert into public.learning_objectives(owner_id, phase, title, details, position, edited_role, edited_by)
      values (p_owner, p_phase, btrim(p_title), v_details,
        coalesce((select max(position) from public.learning_objectives
          where owner_id = p_owner and phase = p_phase and archived_at is null), 0) + 1,
        v_role, p_author);
    return coach_private.objectives_json(p_owner);
  end if;

  select * into v_row from public.learning_objectives where id = p_id and owner_id = p_owner for update;
  if not found then
    if p_action = 'delete' then return coach_private.objectives_json(p_owner); end if;
    raise exception '%', v_stale using errcode = '40001';
  end if;

  if p_action = 'update' then
    if p_revision is null or v_row.revision <> p_revision then
      raise exception '%', v_stale using errcode = '40001';
    end if;
    update public.learning_objectives set phase = p_phase, title = btrim(p_title), details = v_details,
      position = case when p_phase = v_row.phase then position else
        coalesce((select max(o.position) from public.learning_objectives o
          where o.owner_id = p_owner and o.phase = p_phase and o.archived_at is null), 0) + 1 end,
      revision = revision + 1, edited_role = v_role, edited_by = p_author, updated_at = now()
      where id = v_row.id;
  elsif p_action in ('archive','restore') then
    update public.learning_objectives set
      archived_at = case when p_action = 'archive' then coalesce(archived_at, now()) end,
      position = case when p_action = 'archive' or archived_at is null then position else
        coalesce((select max(o.position) from public.learning_objectives o
          where o.owner_id = p_owner and o.phase = v_row.phase and o.archived_at is null), 0) + 1 end,
      revision = revision + 1, edited_role = v_role, edited_by = p_author, updated_at = now()
      where id = v_row.id;
  elsif p_action = 'delete' then
    delete from public.learning_objectives where id = v_row.id;
  else
    -- Swap with the neighbouring current objective in the same phase.
    select * into v_next from public.learning_objectives o
      where o.owner_id = p_owner and o.phase = v_row.phase and o.archived_at is null and o.id <> v_row.id
        and v_row.archived_at is null
        and case when p_action = 'up' then o.position < v_row.position else o.position > v_row.position end
      order by case when p_action = 'up' then -o.position else o.position end
      limit 1 for update;
    if found then
      update public.learning_objectives set position = v_next.position where id = v_row.id;
      update public.learning_objectives set position = v_row.position where id = v_next.id;
    end if;
  end if;
  return coach_private.objectives_json(p_owner);
end;
$$;
revoke all on function coach_private.change_objective(uuid,text,text,uuid,text,text,text,bigint)
  from public, anon, authenticated;

-- Owner.
create function public.get_learning_objectives() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coach_private.objectives_json(coach_private.require_owner());
$$;
create function public.change_learning_objective(p_action text, p_id uuid default null,
  p_phase text default null, p_title text default null, p_details text default null,
  p_revision bigint default null) returns jsonb
language sql security definer set search_path = '' as $$
  select coach_private.change_objective(coach_private.require_owner(), null, p_action, p_id,
    p_phase, p_title, p_details, p_revision);
$$;
create function public.set_objectives_player_name(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner(); v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if length(v_name) > 40 then
    raise exception 'Use a name up to 40 characters' using errcode = '22023';
  end if;
  insert into public.objective_players(owner_id, player_name) values (v_owner, v_name)
    on conflict (owner_id) do update set player_name = excluded.player_name;
  return coach_private.objectives_json(v_owner);
end;
$$;

-- Watch-link holders: the recording's owner list, while the link is valid.
create function public.get_shared_objectives(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coach_private.objectives_json(r.owner_id) from public.recordings r
    where r.id = coach_private.shared_recording(p_token);
$$;
create function public.change_shared_objective(p_token text, p_author_key text, p_author_name text,
  p_action text, p_id uuid default null, p_phase text default null, p_title text default null,
  p_details text default null, p_revision bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_recording uuid := coach_private.shared_recording(p_token);
  v_hash text := coach_private.author_hash(p_author_key);
  v_author text;
begin
  if v_recording is null then raise exception 'Watch link unavailable' using errcode = '42501'; end if;
  -- A named guest's name is set by the owner, never by the browser.
  select g.name into v_author from public.recording_guests g
    where g.recording_id = v_recording and g.key_hash = v_hash;
  if v_author is null then
    v_author := coalesce(nullif(left(btrim(coalesce(p_author_name, '')), 60), ''), 'Coach');
  end if;
  return coach_private.change_objective((select owner_id from public.recordings where id = v_recording),
    v_author, p_action, p_id, p_phase, p_title, p_details, p_revision);
end;
$$;

revoke all on function public.get_learning_objectives(),
  public.change_learning_objective(text,uuid,text,text,text,bigint),
  public.set_objectives_player_name(text), public.get_shared_objectives(text),
  public.change_shared_objective(text,text,text,text,uuid,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.get_learning_objectives(),
  public.change_learning_objective(text,uuid,text,text,text,bigint),
  public.set_objectives_player_name(text) to authenticated;
grant execute on function public.get_shared_objectives(text),
  public.change_shared_objective(text,text,text,text,uuid,text,text,text,bigint) to anon, authenticated;
