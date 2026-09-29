-- ============================================================
-- JAM PORTAL — quién sumó cada tema a la lista
-- ------------------------------------------------------------
-- Dos columnas en el ítem del setlist: el mail de quien lo puso
-- y cuándo. Es de ESTA jam, como todo lo demás del ítem: si el
-- mismo tema entra en otra, lo sumó quien lo haya sumado ahí.
--
-- El mail y no la persona: es lo que la app sabe de quien está
-- entrando —el mismo que ya usa la tabla `nota`— y no obliga a
-- que cada miembro tenga una fila en `persona`.
--
-- Se llena una sola vez, cuando el ítem nace. guardar_jam borra
-- e inserta todos los ítems de la jam en cada guardado, así que
-- el valor viaja de ida y de vuelta con la jam: quien edita
-- después no se lo lleva puesto.
--
-- Los temas que ya estaban quedan sin firma, y está bien: nadie
-- sabe quién los puso y adivinarlo sería peor que no decirlo.
--
-- Es idempotente: correrlo dos veces no rompe nada.
--
-- Después de esto, las funciones que las mueven:
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/03-app-estado.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/06-concurrencia.sql
-- ============================================================

alter table setlist_item
  add column if not exists agregado_por text not null default '',
  add column if not exists agregado_el  timestamptz;
