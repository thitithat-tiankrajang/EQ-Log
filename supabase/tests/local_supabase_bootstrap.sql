-- Minimal Supabase compatibility surface for local PostgreSQL migration tests.
-- Never run this file against a Supabase project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Supabase-managed projects grant new public-schema functions explicitly to
-- API roles. Reproduce that ACL so local migration tests catch REVOKE clauses
-- that remove PUBLIC but accidentally leave anon/service_role grants behind.
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create publication supabase_realtime;
