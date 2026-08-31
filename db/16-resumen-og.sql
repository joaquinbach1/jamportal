-- ============================================================
-- JAM PORTAL — el resumen para la tarjeta del link
-- ------------------------------------------------------------
-- Cuando el link se pega en WhatsApp, el que lo lee del otro
-- lado es un robot que no ejecuta JavaScript. Le hace falta la
-- lista en el HTML, y para eso hay una función serverless que
-- la pide acá (api/jam.js).
--
-- Existe aparte de estado_publico() por tamaño: aquella devuelve
-- el repertorio entero —340 kB— porque la app necesita poder
-- buscar un tema. La tarjeta solo necesita los títulos de esta
-- jam, y eso son dos kilobytes. Cada vez que alguien reenvía el
-- link, un robot pide esto: no tiene sentido moverle el catálogo.
--
-- Devuelve MENOS que estado_publico(), nunca más: los nombres de
-- los temas y de quién canta, que es lo que ya se ve al abrir el
-- link. Nada de teléfonos, mails, ensayos ni otras jams.
-- ============================================================

create or replace function resumen_publico(t text) returns jsonb
language sql stable security definer set search_path = public as $fn$
select case when jam_del_token(t) is null then null else (
  select jsonb_build_object(
    'nombre', j.nombre,
    'fecha',  coalesce(to_char(j.fecha, 'YYYY-MM-DD'), ''),
    'hora',   coalesce(to_char(j.hora,  'HH24:MI'),    ''),
    'lugar',  j.lugar,
    'temas',  (select count(*) from setlist_item i
                where i.jam_id = j.id and i.tipo = 'song'),
    -- En orden y aplanado: los del medley van sueltos, que para leer una
    -- lista es lo que importa. El break y el bloque quedan afuera.
    'lista', coalesce((
      select jsonb_agg(x.linea order by x.orden, x.sub)
      from (
        select i.orden, coalesce(h.orden, -1) as sub,
               trim(s.titulo ||
                 case when s.artista <> '' then ' — ' || s.artista else '' end ||
                 coalesce(nullif((select ' (' || string_agg(p.nombre, ', ' order by ic.orden) || ')'
                                    from item_cantante ic join persona p on p.id = ic.persona_id
                                   where ic.item_id = coalesce(h.id, i.id)), ' ()'), '')) as linea
        from setlist_item i
        left join setlist_item h on h.parent_id = i.id
        join song s on s.id = coalesce(h.song_id, i.song_id)
        where i.jam_id = j.id and i.parent_id is null
      ) x), '[]'::jsonb)
  )
  from jam j where j.id = jam_del_token(t)
) end
$fn$;

revoke all on function resumen_publico(text) from public, anon;
grant execute on function resumen_publico(text) to anon, authenticated;
