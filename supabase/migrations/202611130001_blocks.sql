-- Blocks: a short run of games the owner reflects on, carrying learnings into the next block.
create table public.play_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (length(title) <= 80),
  carry_in jsonb not null default '[]' check (jsonb_typeof(carry_in) = 'array'),
  games jsonb not null default '[]' check (jsonb_typeof(games) = 'array' and jsonb_array_length(games) <= 30),
  carry_forward jsonb not null default '[]' check (jsonb_typeof(carry_forward) = 'array' and jsonb_array_length(carry_forward) <= 30),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index play_blocks_owner on public.play_blocks(owner_id, created_at desc);
alter table public.play_blocks enable row level security;
revoke all on public.play_blocks from public, anon, authenticated;

create function coach_private.block_json(b public.play_blocks) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',b.id,'title',b.title,'carryIn',b.carry_in,'games',b.games,
    'carryForward',b.carry_forward,'revision',b.revision,'createdAt',b.created_at,'updatedAt',b.updated_at);
$$;
revoke all on function coach_private.block_json(public.play_blocks) from public, anon, authenticated;

create function public.list_blocks() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  return coalesce((select jsonb_agg(coach_private.block_json(b) order by b.created_at desc)
    from public.play_blocks b where b.owner_id = v_owner), '[]'::jsonb);
end; $$;

-- A new block starts with the most recent block's carry-forward points, copied so history stays true.
create function public.create_block(p_title text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner(); v_row public.play_blocks;
begin
  if p_title is null or length(p_title) > 80 then raise exception 'Block title is too long' using errcode = '22023'; end if;
  if (select count(*) from public.play_blocks where owner_id = v_owner) >= 500 then
    raise exception 'Block limit reached' using errcode = '54000';
  end if;
  insert into public.play_blocks(owner_id,title,carry_in)
    values(v_owner,btrim(p_title),coalesce((select b.carry_forward from public.play_blocks b
      where b.owner_id = v_owner and jsonb_array_length(b.carry_forward) > 0
      order by b.created_at desc limit 1),'[]'::jsonb))
    returning * into v_row;
  return coach_private.block_json(v_row);
end; $$;

create function public.save_block(p_id uuid, p_revision bigint, p_title text, p_games jsonb, p_carry_forward jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner(); v_row public.play_blocks; v_item jsonb;
begin
  if p_title is null or length(p_title) > 80 or p_games is null or jsonb_typeof(p_games) <> 'array'
    or jsonb_array_length(p_games) > 30 or p_carry_forward is null or jsonb_typeof(p_carry_forward) <> 'array'
    or jsonb_array_length(p_carry_forward) > 30 then
    raise exception 'Block is too large or malformed' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_games) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'id') <> 'string' or length(v_item->>'id') not between 1 and 64
      or jsonb_typeof(v_item->'title') <> 'string' or length(v_item->>'title') > 80
      or jsonb_typeof(v_item->'notes') <> 'string' or length(v_item->>'notes') > 20000 then
      raise exception 'Game entry is malformed' using errcode = '22023';
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(p_carry_forward) loop
    if jsonb_typeof(v_item) <> 'string' or length(v_item #>> '{}') > 300 then
      raise exception 'Carry-forward point is malformed' using errcode = '22023';
    end if;
  end loop;
  select * into v_row from public.play_blocks where id = p_id and owner_id = v_owner for update;
  if not found then raise exception 'Block unavailable' using errcode = '42501'; end if;
  if v_row.revision <> p_revision then
    raise exception 'This block changed in another tab. Reload to see the latest.' using errcode = '40001';
  end if;
  update public.play_blocks set title = btrim(p_title), games = p_games, carry_forward = p_carry_forward,
    revision = revision + 1, updated_at = now() where id = p_id returning * into v_row;
  return coach_private.block_json(v_row);
end; $$;

create function public.delete_block(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner();
begin
  delete from public.play_blocks where id = p_id and owner_id = v_owner;
end; $$;

revoke all on function public.list_blocks(), public.create_block(text),
  public.save_block(uuid,bigint,text,jsonb,jsonb), public.delete_block(uuid) from public, anon;
grant execute on function public.list_blocks(), public.create_block(text),
  public.save_block(uuid,bigint,text,jsonb,jsonb), public.delete_block(uuid) to authenticated;
