-- Run this manually once per environment before game_archives_migration.sql.
-- It generates the secret inside PostgreSQL; no production value belongs here.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.runtime_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  constraint runtime_secrets_key_check check (key = 'room_code_secret'),
  constraint runtime_secrets_value_length_check check (length(value) >= 32)
);

alter table private.runtime_secrets enable row level security;
revoke all on table private.runtime_secrets
  from public, anon, authenticated, service_role;

insert into private.runtime_secrets (key, value)
values (
  'room_code_secret',
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
)
on conflict (key) do nothing;
