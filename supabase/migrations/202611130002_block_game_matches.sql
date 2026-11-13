-- Games in a block may carry a small snapshot of the League match they were picked from.
create or replace function public.save_block(p_id uuid, p_revision bigint, p_title text, p_games jsonb, p_carry_forward jsonb)
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
      or jsonb_typeof(v_item->'notes') <> 'string' or length(v_item->>'notes') > 20000
      or (v_item ? 'match' and (jsonb_typeof(v_item->'match') <> 'object' or length((v_item->'match')::text) > 1000)) then
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

