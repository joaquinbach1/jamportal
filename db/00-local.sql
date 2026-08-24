-- ============================================================
-- JAM PORTAL — andamio para probar en local
-- ------------------------------------------------------------
-- SOLO para un Postgres de escritorio. En Supabase NO se corre:
-- allá los roles `anon` / `authenticated` y el esquema `auth` ya
-- existen, y este archivo los pisaría.
--
-- Sirve para una cosa concreta: poder probar db/05-permisos.sql
-- antes de subirlo, en vez de descubrir en producción que la
-- policy dejaba entrar a quien no debía.
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"email":"alguien@ejemplo.com"}';
-- ============================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;

-- Imita a auth.jwt() de Supabase: devuelve los claims que se hayan
-- puesto en la sesión con `set local request.jwt.claims`.
create or replace function auth.jwt() returns jsonb
language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$fn$;

grant usage on schema public, auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
