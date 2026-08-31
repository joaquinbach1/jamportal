-- ============================================================
-- JAM PORTAL — ponerle nombre a los medleys que no tienen
-- ------------------------------------------------------------
-- Siete de los 51 medleys se llaman "Medley" a secas, que es lo
-- que la app pone por defecto al crear uno. En una lista de 49
-- eso son siete filas idénticas, y lo único que las distingue
-- son los temas de adentro.
--
-- La regla, en orden:
--
--   1. Si todos los temas son del mismo artista, ese es el
--      nombre:  "Medley The Rolling Stones".
--   2. Si no, los dos primeros títulos:
--      "Medley: Black Hole Sun / Zombie", y un "+2" al final si
--      quedaron más afuera.
--
-- Solo toca los genéricos. "Medley Cristian", "Funk Medley 🎷15
-- min / 121" y compañía se quedan como están: alguien les puso
-- ese nombre a propósito y dice más que cualquier cosa que
-- podamos derivar de los temas.
--
-- Es idempotente: correrlo dos veces no cambia nada la segunda,
-- porque después del primer paso ya no quedan genéricos.
-- ============================================================

-- El nombre que le tocaría a un medley según lo que tiene adentro.
create or replace function nombre_de_medley(p_item uuid) returns text
language sql stable as $fn$
with temas as (
  select s.titulo, s.artista
  from   setlist_item h join song s on s.id = h.song_id
  where  h.parent_id = p_item
  order  by h.orden
),
uno as (
  -- ¿es todo del mismo artista? Se ignoran los que quedaron sin artista
  -- cargado, que no aportan nada a la pregunta.
  select case when count(distinct artista) = 1 then min(artista) end as artista
  from temas where coalesce(artista, '') <> ''
)
select case
  when (select artista from uno) is not null
    then 'Medley ' || (select artista from uno)
  else 'Medley: ' || (select string_agg(t.titulo, ' / ') from (select titulo from temas limit 2) t)
       || case when (select count(*) from temas) > 2
               then ' +' || ((select count(*) from temas) - 2)::text else '' end
end
$fn$;

-- Antes de tocar nada, la copia: `titulo` no tiene historial propio y el
-- trigger de respaldos mira `jam.version`, que un UPDATE directo no mueve.
create table if not exists medley_titulo_previo (
  item_id uuid primary key,
  titulo  text not null,
  creada  timestamptz not null default now()
);

insert into medley_titulo_previo (item_id, titulo)
select i.id, coalesce(i.titulo, '')
from   setlist_item i
where  i.tipo = 'medley'
   and (btrim(coalesce(i.titulo, '')) ~* '^medley\.?$' or btrim(coalesce(i.titulo, '')) = '')
on conflict (item_id) do nothing;

update setlist_item i
   set titulo = nombre_de_medley(i.id)
 where i.tipo = 'medley'
   and (btrim(coalesce(i.titulo, '')) ~* '^medley\.?$' or btrim(coalesce(i.titulo, '')) = '')
   and nombre_de_medley(i.id) is not null;

-- Que la app se entere de que cambió algo.
select subir_revision();
