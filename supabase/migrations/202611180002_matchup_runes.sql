-- A rune page per matchup note, in Riot's own page shape:
-- { primaryStyleId, subStyleId, selectedPerkIds[9] } with 0 for an empty slot.
-- Only the shape is checked here; which runes fit which slot is the client's job.

alter table public.matchup_notes
  add column runes jsonb check (runes is null or (jsonb_typeof(runes) = 'object' and length(runes::text) <= 400));

create function coach_private.valid_rune_page(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p = 'null'::jsonb or (
    jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p)) = 3
    and jsonb_typeof(p->'primaryStyleId') = 'number' and (p->>'primaryStyleId') ~ '^\d{1,5}$'
    and jsonb_typeof(p->'subStyleId') = 'number' and (p->>'subStyleId') ~ '^\d{1,5}$'
    and jsonb_typeof(p->'selectedPerkIds') = 'array' and jsonb_array_length(p->'selectedPerkIds') = 9
    and not exists (
      select 1 from jsonb_array_elements(p->'selectedPerkIds') v
      where jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^\d{1,5}$'));
$$;
revoke all on function coach_private.valid_rune_page(jsonb) from public, anon, authenticated;

create or replace function coach_private.matchup_json(m public.matchup_notes) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('championId',m.champion_id,'opponentId',m.opponent_id,
    'difficulty',m.difficulty,'plan',m.plan,'threats',m.threats,'tips',m.tips,'build',m.build,
    'notes',m.notes,'runes',m.runes,'revision',m.revision,'updatedAt',m.updated_at);
$$;

-- Same as before, plus runes. A note sent without a runes key (an older open
-- tab) leaves the stored page alone rather than clearing it.
create or replace function public.save_matchup(p_champion integer, p_opponent integer, p_revision bigint, p_note jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coach_private.require_owner(); v_row public.matchup_notes; v_item jsonb; v_list text;
  v_has_runes boolean; v_runes jsonb;
begin
  if p_champion is null or p_opponent is null or p_champion not between 1 and 100000
    or p_opponent not between 1 and 100000 or p_revision is null or p_revision < 0
    or p_note is null or jsonb_typeof(p_note) <> 'object'
    or coalesce(jsonb_typeof(p_note->'plan'), '') <> 'string' or length(p_note->>'plan') > 300
    or coalesce(jsonb_typeof(p_note->'build'), '') <> 'string' or length(p_note->>'build') > 1000
    or coalesce(jsonb_typeof(p_note->'notes'), '') <> 'string' or length(p_note->>'notes') > 20000
    or not (coalesce(p_note->'difficulty', 'null'::jsonb) = 'null'::jsonb
      or coalesce(p_note->>'difficulty', '') in ('easy','even','hard')) then
    raise exception 'Matchup note is too large or malformed' using errcode = '22023';
  end if;
  v_has_runes := p_note ? 'runes';
  v_runes := case when v_has_runes and p_note->'runes' <> 'null'::jsonb then p_note->'runes' end;
  if v_has_runes and not coach_private.valid_rune_page(p_note->'runes') then
    raise exception 'Rune page is malformed' using errcode = '22023';
  end if;
  foreach v_list in array array['threats','tips'] loop
    if coalesce(jsonb_typeof(p_note->v_list), '') <> 'array' or jsonb_array_length(p_note->v_list) > 20 then
      raise exception 'Matchup note is too large or malformed' using errcode = '22023';
    end if;
    for v_item in select * from jsonb_array_elements(p_note->v_list) loop
      if jsonb_typeof(v_item) <> 'string' or length(v_item #>> '{}') > 300 then
        raise exception 'Matchup point is malformed' using errcode = '22023';
      end if;
    end loop;
  end loop;
  select * into v_row from public.matchup_notes
    where owner_id = v_owner and champion_id = p_champion and opponent_id = p_opponent for update;
  if (found and v_row.revision <> p_revision) or (not found and p_revision <> 0) then
    raise exception 'These notes changed in another tab. Reload to see the latest.' using errcode = '40001';
  end if;
  if not found then
    if (select count(*) from public.matchup_notes where owner_id = v_owner) >= 2000 then
      raise exception 'Matchup limit reached' using errcode = '54000';
    end if;
    insert into public.matchup_notes(owner_id,champion_id,opponent_id,difficulty,plan,threats,tips,build,notes,runes)
      values(v_owner,p_champion,p_opponent,p_note->>'difficulty',p_note->>'plan',p_note->'threats',
        p_note->'tips',p_note->>'build',p_note->>'notes',v_runes)
      returning * into v_row;
  else
    update public.matchup_notes set difficulty = p_note->>'difficulty', plan = p_note->>'plan',
      threats = p_note->'threats', tips = p_note->'tips', build = p_note->>'build', notes = p_note->>'notes',
      runes = case when v_has_runes then v_runes else runes end,
      revision = revision + 1, updated_at = now()
      where owner_id = v_owner and champion_id = p_champion and opponent_id = p_opponent
      returning * into v_row;
  end if;
  return coach_private.matchup_json(v_row);
end; $$;
