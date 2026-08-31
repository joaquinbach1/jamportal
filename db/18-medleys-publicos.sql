-- ============================================================
-- JAM PORTAL — los medleys, también por el link
-- ------------------------------------------------------------
-- `estado_publico()` devuelve UNA jam, que es lo correcto: el
-- link no tiene por qué mostrar el resto. Pero los medleys viven
-- adentro del setlist de las otras jams, así que quien entra por
-- el link abría la pastilla de Medleys y la veía vacía.
--
-- Esto los devuelve aparte, ya deduplicados y sin decir de qué
-- jam salió cada uno: títulos y qué temas tienen, que es lo que
-- hace falta para volver a armarlos. El repertorio ya se lo
-- estamos mostrando entero, así que no agrega nada nuevo — solo
-- dice qué temas suelen ir juntos.
--
-- Va en una función aparte y no adentro de estado_publico() para
-- no volver a copiar sus 90 líneas cada vez que se le suma un
-- campo, que es como se llegó a tener tres copias del mismo SQL
-- desparramadas entre db/03, db/14 y db/15.
-- ============================================================

create or replace function medleys_publicos(t text) returns jsonb
language sql stable security definer set search_path = public as $fn$
select case when jam_del_token(t) is null then null else (
  with med as (
    select i.id,
           coalesce(nullif(btrim(i.titulo), ''), 'Medley') as titulo,
           -- la firma es qué temas tiene y en qué orden: dos medleys con los
           -- mismos temas son el mismo, se llamen como se llamen
           (select string_agg(h.song_id, '|' order by h.orden)
              from setlist_item h where h.parent_id = i.id) as firma,
           (select jsonb_agg(jsonb_build_object(
                     'songId', h.song_id,
                     'cantantes', cantantes_de(h.id)) order by h.orden)
              from setlist_item h where h.parent_id = i.id) as songs
    from setlist_item i
    where i.tipo = 'medley'
  ),
  juntos as (
    select firma,
           min(titulo) as titulo,
           count(*)    as veces,
           (array_agg(songs order by id))[1] as songs
    from   med
    where  firma is not null
    group  by firma
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave',  firma,
           'titulo', titulo,
           'veces',  veces,
           'songs',  songs
         ) order by veces desc, titulo), '[]'::jsonb)
  from juntos
) end
$fn$;

revoke all on function medleys_publicos(text) from public, anon;
grant execute on function medleys_publicos(text) to anon, authenticated;
