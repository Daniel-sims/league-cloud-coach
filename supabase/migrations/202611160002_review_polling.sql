-- Live review polling. The review page asks for the review every few seconds so
-- the player and coach see each other's comments, but the stored match payload
-- (items, frames, kills; ~45 KB) almost never changes. These variants return a
-- `reviewVersion` fingerprint and leave the payload out (`reviewUnchanged`)
-- when the caller already holds that version. Access rules are exactly those of
-- get_recording_review and get_shared_review, which stay for existing clients.
create function coach_private.review_since(p_review jsonb, p_version text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_version text;
begin
  if p_review is null then return null; end if;
  v_version := case when p_review->'review' is null or jsonb_typeof(p_review->'review') = 'null'
    then null else md5((p_review->'review')::text) end;
  if v_version is not null and v_version = p_version then
    return (p_review - 'review') || jsonb_build_object('reviewVersion', v_version, 'reviewUnchanged', true);
  end if;
  return p_review || jsonb_build_object('reviewVersion', v_version);
end;
$$;
revoke all on function coach_private.review_since(jsonb, text) from public, anon, authenticated;

create function public.get_recording_review_since(p_id uuid, p_review_version text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coach_private.review_since(
    coach_private.review_json(coach_private.owned_recording(p_id), true, null), p_review_version);
end;
$$;

-- Invalid, revoked or expired links return null, like get_shared_review.
create function public.get_shared_review_since(p_token text, p_author_key text default null,
  p_review_version text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_recording uuid := coach_private.shared_recording(p_token);
begin
  if v_recording is null then return null; end if;
  return coach_private.review_since(coach_private.review_json(v_recording, false,
    case when p_author_key ~ '^[a-f0-9]{64}$' then coach_private.author_hash(p_author_key) end),
    p_review_version);
end;
$$;

revoke all on function public.get_recording_review_since(uuid, text),
  public.get_shared_review_since(text, text, text) from public, anon, authenticated;
grant execute on function public.get_recording_review_since(uuid, text) to authenticated;
grant execute on function public.get_shared_review_since(text, text, text) to anon, authenticated;
