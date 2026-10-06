-- ============================================================
-- JAM PORTAL — no barrer un tema recién creado
-- ------------------------------------------------------------
-- guardar_catalogo borra los temas que el catálogo que recibe no
-- tiene: así se propagan las bajas que hace la app. Tiene una
-- protección —no toca los que cuelgan de algún setlist— pero hay
-- un hueco donde esa protección todavía no existe.
--
-- El hueco: la app guarda primero el catálogo y después la jam,
-- en dos llamadas. Entre las dos, el tema recién creado existe y
-- no está en ninguna lista. Si en esos milisegundos otro
-- navegador guarda su catálogo —que es de antes y no lo tiene—,
-- el tema se borra. Y cuando llega el guardar_jam del primero,
-- falla entero por la clave foránea: no se guarda nada de lo que
-- esa persona había editado.
--
-- Es exactamente el caso de «agregué un tema que no estaba en
-- DBSongs y después desapareció de la lista».
--
-- La baja por ausencia no puede distinguir «este no lo tengo
-- porque lo borré» de «no lo tengo porque es más nuevo que mi
-- copia». Así que no se barre lo recién tocado: cinco minutos
-- alcanzan de sobra para un hueco de milisegundos, y no demoran
-- una baja de verdad —un tema que alguien borra hace rato que no
-- se toca, así que se barre igual en el primer guardado.
--
-- Es idempotente: es un create or replace del archivo de siempre.
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/29-no-barrer-recien-creados.sql
-- ============================================================

create or replace function barrido_seguro() returns interval
language sql immutable as $fn$ select interval '5 minutes' $fn$;

comment on function barrido_seguro() is
  'Cuánto tiempo queda protegido un tema recién creado o editado de la '
  'limpieza por ausencia de guardar_catalogo. Ver db/29.';
