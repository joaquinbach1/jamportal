-- ============================================================
-- JAM PORTAL — cuánto dura cada tema, y su link de Spotify
-- ------------------------------------------------------------
-- Dos columnas nuevas en `song`. La duración es lo que permite
-- estimar a qué hora termina la jam: sumando los temas, un 20%
-- entre uno y otro, y los minutos de cada break.
--
-- Después de correr esto hay que volver a correr 03 y 04, que
-- son `create or replace` y ya nombran las columnas nuevas:
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/13-duracion-spotify.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/03-app-estado.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/04-escritura.sql
-- ============================================================

-- Segundos. Sale de iTunes cuando se da de alta el tema, y para el
-- repertorio viejo lo completa scripts/traer-duraciones.py. Puede
-- quedar en null sin romper nada: la app usa 4 minutos de promedio.
alter table song add column if not exists duracion_sec smallint;

do $$
begin
  alter table song add constraint song_duracion_ck
    check (duracion_sec between 20 and 1800);
exception when duplicate_object then null;
end $$;

-- Link fijo a Spotify. Vacío es lo normal y lo esperado: la app arma
-- sola un link de búsqueda con título y artista, que en el celular abre
-- la app de Spotify. Esto es para el caso en que esa búsqueda cae en el
-- vivo, el remix o el cover equivocado y alguien quiere fijar el bueno.
alter table song add column if not exists spotify_url text not null default '';
