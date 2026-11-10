-- Keys are encrypted by the Riot edge function before they reach the database.
-- Only that verified backend can read/write ciphertext; there is no client readback.
create table public.riot_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_token text not null check(length(encrypted_token) between 40 and 2048),
  updated_at timestamptz not null default now()
);
alter table public.riot_credentials enable row level security;
revoke all on public.riot_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.riot_credentials to service_role;
