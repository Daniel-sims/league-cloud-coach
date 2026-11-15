-- Learning objectives: one private markdown page per owner, read before games to prime what to focus on.
create table public.learning_objectives (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  body text not null default '' check (length(body) <= 50000),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.learning_objectives enable row level security;
revoke all on public.learning_objectives from public, anon, authenticated;

-- Revision 0 means nothing has been saved yet.
create function public.get_learning_objectives() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner(); v_row public.learning_objectives;
begin
  select * into v_row from public.learning_objectives where owner_id = v_owner;
  if not found then return jsonb_build_object('body','','revision',0,'updatedAt',null); end if;
  return jsonb_build_object('body',v_row.body,'revision',v_row.revision,'updatedAt',v_row.updated_at);
end; $$;

create function public.save_learning_objectives(p_revision bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner(); v_row public.learning_objectives;
begin
  if p_body is null or length(p_body) > 50000 or p_revision is null or p_revision < 0 then
    raise exception 'Learning objectives are too long or malformed' using errcode = '22023';
  end if;
  if p_revision = 0 then
    insert into public.learning_objectives(owner_id, body) values (v_owner, p_body)
      on conflict (owner_id) do nothing returning * into v_row;
  else
    update public.learning_objectives set body = p_body, revision = revision + 1, updated_at = now()
      where owner_id = v_owner and revision = p_revision returning * into v_row;
  end if;
  if v_row.owner_id is null then
    raise exception 'Your learning objectives changed in another tab. Reload to see the latest.' using errcode = '40001';
  end if;
  return jsonb_build_object('body',v_row.body,'revision',v_row.revision,'updatedAt',v_row.updated_at);
end; $$;

revoke all on function public.get_learning_objectives(), public.save_learning_objectives(bigint,text) from public, anon;
grant execute on function public.get_learning_objectives(), public.save_learning_objectives(bigint,text) to authenticated;
