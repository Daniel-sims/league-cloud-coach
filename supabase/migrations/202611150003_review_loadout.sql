-- Review board: each participant's summoner spells and runes (keystone and
-- secondary tree) travel with the review, as the in-game scoreboard shows them.
-- Spell and rune ids are game data, not identities; puuids and Riot IDs stay out.

-- Same matching rules as before (ten participants, every champion lining up by
-- participant ID); now also adds spells [summoner1Id, summoner2Id] and runes
-- [keystone, secondary tree] when the stored summary has them.
create or replace function coach_private.with_final_items(p_review jsonb, p_match jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_part jsonb; v_slot jsonb; v_out jsonb := '[]'; v_id int; v_pair jsonb;
begin
  if p_review is null or p_match is null
    or jsonb_typeof(p_review->'participants') is distinct from 'array'
    or jsonb_typeof(p_match->'participants') is distinct from 'array'
    or jsonb_array_length(p_match->'participants') <> 10 then
    return p_review;
  end if;
  for v_part in select * from jsonb_array_elements(p_review->'participants') loop
    if jsonb_typeof(v_part) <> 'object' or coalesce(v_part->>'id', '') !~ '^([1-9]|10)$' then return p_review; end if;
    v_id := (v_part->>'id')::int;
    v_slot := p_match->'participants'->(v_id - 1);
    if v_slot->'championId' is distinct from v_part->'championId' then return p_review; end if;
    if not v_part ? 'finalItems' and (select bool_and(jsonb_typeof(v_slot->k) = 'number')
        from unnest(array['item0','item1','item2','item3','item4','item5','item6']) k) then
      v_part := v_part || jsonb_build_object('finalItems', jsonb_build_array(v_slot->'item0', v_slot->'item1',
        v_slot->'item2', v_slot->'item3', v_slot->'item4', v_slot->'item5', v_slot->'item6'));
    end if;
    v_pair := jsonb_build_array(v_slot->'summoner1Id', v_slot->'summoner2Id');
    if not v_part ? 'spells' and coalesce((select bool_and(jsonb_typeof(x) = 'number' and (x::text)::numeric >= 1)
        from jsonb_array_elements(v_pair) x), false) then
      v_part := v_part || jsonb_build_object('spells', v_pair);
    end if;
    v_pair := jsonb_build_array(v_slot#>'{perks,styles,0,selections,0,perk}', v_slot#>'{perks,styles,1,style}');
    if not v_part ? 'runes' and coalesce((select bool_and(jsonb_typeof(x) = 'number' and (x::text)::numeric >= 1)
        from jsonb_array_elements(v_pair) x), false) then
      v_part := v_part || jsonb_build_object('runes', v_pair);
    end if;
    v_out := v_out || jsonb_build_array(v_part);
  end loop;
  return jsonb_set(p_review, '{participants}', v_out);
end; $$;
revoke all on function coach_private.with_final_items(jsonb, jsonb) from public, anon, authenticated;

-- Recording reviews also pick runes up from the owner's own synced match.
create or replace function coach_private.recording_timeline_final_items() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(new.review->'participants') = 'array' then
    if exists(select 1 from jsonb_array_elements(new.review->'participants') p
        where jsonb_typeof(p) <> 'object' or not p ? 'finalItems' or not p ? 'runes') then
      new.review := coach_private.with_final_items(new.review, (
        select m.match from public.recordings r
          join public.league_profiles lp on lp.owner_id = r.owner_id
          join public.league_matches m on m.profile_id = lp.id and m.match_id = new.match_id
        where r.id = new.recording_id limit 1));
    end if;
  end if;
  return new;
end; $$;
revoke all on function coach_private.recording_timeline_final_items() from public, anon, authenticated;

-- Backfill what is already stored.
update public.league_matches set review = coach_private.with_final_items(review, match) where review is not null;
update public.recording_timelines set review = review;
