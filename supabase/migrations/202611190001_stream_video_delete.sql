-- Deleting a Stream recording also deletes the Cloudflare video, but only when
-- no other owner's library still points at it. Service-only: the stream
-- function asks before it deletes, and clients never learn about other owners.
create function public.stream_video_shared(p_owner uuid, p_video text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.recordings r
    where r.provider = 'stream' and r.stream_video_id = p_video and r.owner_id <> p_owner
  );
$$;
revoke all on function public.stream_video_shared(uuid, text) from public, anon, authenticated;
grant execute on function public.stream_video_shared(uuid, text) to service_role;
