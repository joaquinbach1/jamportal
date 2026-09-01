-- ============================================================
-- JAM PORTAL — el disco de cada tema, su tapa, y si lleva vientos
-- ------------------------------------------------------------
-- Sirve para ver el repertorio agrupado por álbum, con la
-- portada y cuánto de cada disco toca la banda.
--
-- La tapa se guarda como URL al servidor de Apple, no como
-- imagen: pesa nada y siempre está al día. El costo es que sin
-- internet no se ve, que para esto no molesta.
--
-- `album_id` es el id de la colección en iTunes. Con eso se le
-- puede pedir a la API la lista completa de temas del disco, y
-- así marcar cuáles tocamos y cuáles nos faltan.
--
-- Es idempotente: correrlo dos veces no rompe nada.
--
-- Mismo movimiento que db/13: las columnas acá, y las funciones
-- que las mueven viven en db/03 y db/04, que son `create or
-- replace` y ya las nombran. Este archivo llevaba copias enteras
-- de las dos, pero cada migración con su copia terminó en copias
-- desincronizadas que se pisaban entre sí al re-correrlas — ahora
-- la versión buena vive en un solo lugar. Después de esto:
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/03-app-estado.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/04-escritura.sql
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/06-concurrencia.sql
-- ============================================================

alter table song add column if not exists album    text   not null default '';
alter table song add column if not exists album_id bigint;
alter table song add column if not exists cover    text   not null default '';

-- Si el tema lleva vientos. Se marca con la trompeta en el playlist.
alter table song add column if not exists vientos  boolean not null default false;
