-- A guest's authorship key is a bearer secret. Stopping or replacing their link
-- must also kill the key, otherwise a former guest holding any other valid link
-- could keep writing under their name. Rotation re-keys what they already wrote
-- so the person keeps ownership through their new link.
create function coach_private.rotate_guest_key(p_guest uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text; v_recording uuid; v_key text := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash text := encode(extensions.digest(v_key, 'sha256'), 'hex');
begin
  select key_hash, recording_id into v_old, v_recording from public.recording_guests where id = p_guest for update;
  if not found then return; end if;
  update public.recording_guests set author_key = v_key, key_hash = v_hash where id = p_guest;
  update public.recording_comments set author_key_hash = v_hash where recording_id = v_recording and author_key_hash = v_old;
  update public.recording_review_notes set author_key_hash = v_hash where recording_id = v_recording and author_key_hash = v_old;
  update public.recording_captures set author_key_hash = v_hash where recording_id = v_recording and author_key_hash = v_old;
end;
$$;
revoke all on function coach_private.rotate_guest_key(uuid) from public, anon, authenticated;

create or replace function public.create_guest_link(p_id uuid, p_name text)
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
  else
    perform coach_private.rotate_guest_key(v_guest);
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.recording_shares set revoked_at = now() where guest_id = v_guest and revoked_at is null;
  insert into public.recording_shares(recording_id, guest_id, token_hash)
    values(p_id, v_guest, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;

create or replace function public.revoke_guest_link(p_id uuid, p_guest uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform coach_private.owned_recording(p_id);
  update public.recording_shares set revoked_at = now() where recording_id = p_id and guest_id = p_guest and revoked_at is null;
  if exists(select 1 from public.recording_guests where id = p_guest and recording_id = p_id) then
    perform coach_private.rotate_guest_key(p_guest);
  end if;
end;
$$;
