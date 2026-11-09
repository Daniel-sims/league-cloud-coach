-- Remember completed imports even after library removal. Reconciliation may
-- recover missing uploads, but must never undo an owner's deliberate removal.
create table public.stream_imports (
  owner_id uuid not null references auth.users(id) on delete cascade,
  stream_video_id text not null check (stream_video_id ~ '^[a-f0-9]{32}$'),
  imported_at timestamptz not null default now(),
  primary key(owner_id, stream_video_id)
);
alter table public.stream_imports enable row level security;
revoke all on public.stream_imports from public, anon, authenticated;
insert into public.stream_imports(owner_id, stream_video_id)
  select owner_id, stream_video_id from public.recordings where provider = 'stream';
create function coach_private.remember_stream_import() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider = 'stream' then
    insert into public.stream_imports(owner_id, stream_video_id)
      values(new.owner_id, new.stream_video_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function coach_private.remember_stream_import() from public, anon, authenticated;
create trigger remember_stream_import after insert on public.recordings
  for each row execute function coach_private.remember_stream_import();
create function public.list_stream_imports(p_owner uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(stream_video_id), array[]::text[]) from public.stream_imports where owner_id = p_owner;
$$;
revoke all on function public.list_stream_imports(uuid) from public, anon, authenticated;
grant execute on function public.list_stream_imports(uuid) to service_role;
