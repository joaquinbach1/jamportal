-- ============================================================
-- JAM PORTAL — un acceso para otro dev
-- ------------------------------------------------------------
-- Compartir el rol `postgres` es más de lo que hace falta: puede
-- leer `auth.users`, o sea los mails y los hashes de contraseña de
-- toda la banda, y borrar el proyecto entero.
--
-- Este rol alcanza para trabajar en la app —leer y escribir las
-- tablas, correr migraciones, probar las funciones— y no llega a
-- las cuentas de nadie.
--
-- El rol nace SIN poder entrar, y la contraseña no está acá a
-- propósito: este repo es público. Para habilitarlo:
--
--     alter role jamportal_dev login password 'la-que-elijas';
--
-- Para suspenderlo un rato (sigue existiendo, con todos sus permisos):
--
--     alter role jamportal_dev nologin;
--
-- Ojo: cambiar la contraseña no basta para cortar el acceso en el
-- acto — el pooler de Supabase cachea la anterior un rato. `nologin`
-- sí corta enseguida.
--
-- Y para sacárselo del todo:
--
--     drop owned by jamportal_dev; drop role jamportal_dev;
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'jamportal_dev') then
    -- Nace sin poder entrar: se habilita aparte, con contraseña.
    create role jamportal_dev nologin;
  end if;
end $$;

-- Las policies apuntan al rol `authenticated` con es_miembro(). Un rol
-- de servicio no matchea ninguna, así que sin esto vería cero filas en
-- todas las tablas y parecería que la base está vacía.
alter role jamportal_dev bypassrls;

grant connect on database postgres to jamportal_dev;
grant usage, create on schema public to jamportal_dev;

grant all on all tables    in schema public to jamportal_dev;
grant all on all sequences in schema public to jamportal_dev;
grant execute on all functions in schema public to jamportal_dev;

-- Y lo mismo para lo que se cree de acá en adelante, así no hay que
-- volver a correr esto después de cada migración.
alter default privileges in schema public
  grant all on tables to jamportal_dev;
alter default privileges in schema public
  grant all on sequences to jamportal_dev;
alter default privileges in schema public
  grant execute on functions to jamportal_dev;

-- ── lo que NO puede tocar ───────────────────────────────────
-- Las cuentas son de las personas, no del proyecto. Un dev no
-- necesita verlas para trabajar en el repertorio.
--
-- Estos revoke tiran WARNINGs de "no privileges could be revoked":
-- es lo esperado, significa que el rol nunca los tuvo. Están igual
-- porque dejar la intención escrita vale más que el ruido.
revoke all on schema auth from jamportal_dev;
revoke all on all tables in schema auth from jamportal_dev;
revoke all on schema storage from jamportal_dev;
revoke all on schema vault   from jamportal_dev;

-- Tampoco necesita crear más roles ni repartir accesos.
alter role jamportal_dev nocreaterole nocreatedb noreplication;
