-- ============================================================
-- JAM PORTAL — qué se ensayó para esta jam
-- ------------------------------------------------------------
-- Una marca por ítem del setlist, no por tema: lo que ensayaste
-- para ESTA jam. La próxima arranca en blanco, que es como
-- funciona un ensayo. En el celular se marca desde la hoja del
-- tema y la fila queda pintada de verde.
--
-- Mismo movimiento que db/13: la columna acá, y las funciones
-- que la mueven en sus archivos de siempre (03, 06 y 15; db/04
-- también la nombra, con el aviso de su header si se re-corre
-- entero):
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/25-ensayada.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/03-app-estado.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/06-concurrencia.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/15-link-publico.sql
-- ============================================================

alter table setlist_item add column if not exists ensayada boolean not null default false;
