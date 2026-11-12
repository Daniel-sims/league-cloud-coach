-- Writers lock the recording row; rotation and revocation now take the same
-- lock so an in-flight guest write cannot land under a key that was just retired.
create or replace function coach_private.rotate_guest_key(p_guest uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text; v_recording uuid; v_key text := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash text := encode(extensions.digest(v_key, 'sha256'), 'hex');
begin
  select recording_id into v_recording from public.recording_guests where id = p_guest;
  if not found then return; end if;
  perform 1 from public.recordings where id = v_recording for update;
  select key_hash into v_old from public.recording_guests where id = p_guest for update;
  if not found then return; end if;
  update public.recording_guests set author_key = v_key, key_hash = v_hash where id = p_guest;
  update public.recording_comments set author_key_hash = v_hash where recording_id = v_recording and author_key_hash = v_old;
  update public.recording_review_notes set author_key_hash = v_hash where recording_id = v_recording and author_key_hash = v_old;
  update public.recording_captures set author_key_hash = v_hash where recording_id = v_recording and author_key_hash = v_old;
end;
$$;
create or replace function public.revoke_guest_link(p_id uuid, p_guest uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform coach_private.owned_recording(p_id);
  perform 1 from public.recordings where id = p_id for update;
  update public.recording_shares set revoked_at = now() where recording_id = p_id and guest_id = p_guest and revoked_at is null;
  if exists(select 1 from public.recording_guests where id = p_guest and recording_id = p_id) then
    perform coach_private.rotate_guest_key(p_guest);
  end if;
end;
$$;
