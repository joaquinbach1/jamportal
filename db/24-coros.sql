-- ============================================================
-- JAM PORTAL — si el tema lleva coros
-- ------------------------------------------------------------
-- Como los vientos: es del tema y no de la jam — los arreglos
-- de coros se ensayan una vez y quedan. Se marca en la ficha
-- del tema y se ve en la lista del celular con el 🎸 prendido.
--
-- Mismo movimiento que db/13: la columna acá, y las funciones
-- que la mueven en sus archivos de siempre. Ojo con el aviso del
-- header de db/04 si se re-corre entero (permisos y db/06).
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/24-coros.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/03-app-estado.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/04-escritura.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/06-concurrencia.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/15-link-publico.sql
-- ============================================================

alter table song add column if not exists coros boolean not null default false;
