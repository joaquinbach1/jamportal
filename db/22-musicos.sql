-- ============================================================
-- JAM PORTAL — quién toca qué, puesto por puesto
-- ------------------------------------------------------------
-- La columna `guitarras` de db/20 guardaba dos puestos de viola.
-- Ahora guarda la banda entera —G1, G2, bajo, batería, las dos
-- teclas y el saxo—, así que pasa a llamarse `musicos`.
--
-- Es solo el nombre: adentro sigue siendo jsonb y Postgres no
-- mira lo que hay ahí, así que cambiarle la forma al contenido
-- —de [{nombre,solo},{nombre,solo}] a {g1:{...}, g2:{...}, …}—
-- no pide nada de este lado. Lo viejo lo convierte la app la
-- primera vez que abre el tema.
--
-- Es idempotente: correrlo dos veces no rompe nada.
--
-- Después de esto, las funciones que la mueven:
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/03-app-estado.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/04-escritura.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/06-concurrencia.sql
-- ============================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'setlist_item' and column_name = 'guitarras')
     and not exists (select 1 from information_schema.columns
              where table_name = 'setlist_item' and column_name = 'musicos')
  then
    alter table setlist_item rename column guitarras to musicos;
  end if;
end $$;

alter table setlist_item
  add column if not exists musicos jsonb not null default '{}'::jsonb;
