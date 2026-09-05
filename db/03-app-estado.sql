-- ============================================================
-- JAM PORTAL — el puente con la app
-- ------------------------------------------------------------
-- app_estado() arma del lado del servidor el MISMO objeto que
-- js/store.js tiene hoy en memoria. Gracias a eso el driver
-- nuevo mantiene la interfaz read()/write(state) y ninguna de
-- las vistas de la app se entera de que abajo hay 12 tablas.
--
-- Las horas salen como 'HH:MM' y las fechas como 'YYYY-MM-DD',
-- que es lo que producen los <input type=date|time> del form.
-- Los campos de texto salen como '' y nunca como null, para que
-- la comparación de cambios del driver no vea diferencias falsas.
--
-- Este archivo está al día con las columnas de las migraciones
-- (db/13, db/14, db/20, db/21, db/22, db/26, db/27): correrlas
-- primero, y esto después.
--
-- `musicos` sale tanto en el tema suelto como en cada tema de un
-- medley: la columna es la misma, son todos setlist_item.
-- ============================================================

create or replace function cantantes_de(i uuid) returns jsonb
language sql stable as $fn$
  select coalesce(jsonb_agg(p.nombre order by ic.orden, p.nombre), '[]'::jsonb)
  from   item_cantante ic
  join   persona p on p.id = ic.persona_id
  where  ic.item_id = i
$fn$;

-- Rearma el text[] de invitados tal como lo espera la app:
-- '🥁' + 'Fabo' → '🥁 Fabo'; sin persona queda solo '🎷'.
create or replace function invitados_de(s text) returns jsonb
language sql stable as $fn$
  select coalesce(jsonb_agg(
           trim(si.instrumento || ' ' || coalesce(p.nombre, ''))
           order by si.orden), '[]'::jsonb)
  from   song_invitado si
  left   join persona p on p.id = si.persona_id
  where  si.song_id = s
$fn$;

create or replace function app_estado() returns jsonb
language sql stable as $fn$
select jsonb_build_object(

  'version', 3,

  -- Si quien pregunta puede manejar la lista de miembros. Va acá y no en
  -- una llamada aparte para que la app lo sepa al arrancar, sin pedirlo.
  'esAdmin', soy_admin(),

  'categorias', (select coalesce(jsonb_agg(nombre order by orden), '[]'::jsonb)
                   from categoria),

  'songs', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',        s.id,
             'titulo',    s.titulo,
             'artista',   s.artista,
             'categoria', c.nombre,
             'bpm',       s.bpm,
             'bpmRaw',    s.bpm_raw,
             'bpmFuente', s.bpm_fuente,
             'franja',    s.franja,
             'anio',      s.anio,
             'notas',     s.notas,
             'origen',    s.origen,
             'generoWeb', s.genero_web,
             'patches',   to_jsonb(s.patches),
             'invitados', invitados_de(s.id),
             'cifraUrl',        s.cifra_url,
             'cifraArtista',    s.cifra_artista,
             'cifraConfianza',  s.cifra_confianza,
             'duracionSec',     s.duracion_sec,
             'spotifyUrl',      s.spotify_url,
             'album',           s.album,
             'albumId',         s.album_id,
             'cover',           s.cover,
             'vientos',         s.vientos,
             'coros',           s.coros,
             'noEsNueva',       s.no_es_nueva,
             'esIdea',    s.estado = 'idea',
             'cantantes', (select coalesce(jsonb_agg(p.nombre order by sc.orden, p.nombre), '[]'::jsonb)
                             from song_cantante sc
                             join persona p on p.id = sc.persona_id
                            where sc.song_id = s.id),
             'jams',      (select coalesce(jsonb_agg(sj.jam_nombre order by sj.jam_nombre), '[]'::jsonb)
                             from song_jam sj where sj.song_id = s.id)
           ) order by s.artista, s.titulo), '[]'::jsonb)
    from   song s
    join   categoria c on c.id = s.categoria_id
    where  s.estado <> 'descartado'),

  'jams', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',         j.id,
             'nombre',     j.nombre,
             'fecha',      coalesce(to_char(j.fecha, 'YYYY-MM-DD'), ''),
             'hora',       coalesce(to_char(j.hora,  'HH24:MI'),    ''),
             'lugar',      j.lugar,
             'notas',      j.notas,
             'historica',  j.historica,
             'conOrden',   j.con_orden,
             'cerrada',    j.cerrada,
             'codigo',     case when j.codigo_hash is null then '' else '·····' end,
             'vivoIndice', j.vivo_indice,
             -- La versión que el driver devuelve al guardar, para que la
             -- base pueda detectar que alguien escribió en el medio.
             'version',    j.version,
             'mes',        j.mes,
             'dia',        j.dia,
             'creada',     to_char(j.creada at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),

             'musicos', (select coalesce(jsonb_agg(p.nombre order by p.nombre), '[]'::jsonb)
                           from jam_musico jm
                           join persona p on p.id = jm.persona_id
                          where jm.jam_id = j.id and not p.especial),

             -- Los que se sumaron a mano, que es lo único que la app
             -- puede editar de esa lista: el resto sale del setlist.
             'musicosExtra', (select coalesce(jsonb_agg(p.nombre order by p.nombre), '[]'::jsonb)
                                from jam_musico_extra jx
                                join persona p on p.id = jx.persona_id
                               where jx.jam_id = j.id),

             'ensayos', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'fecha',   coalesce(to_char(e.fecha,    'YYYY-MM-DD'), ''),
                        'hora',    coalesce(to_char(e.hora,     'HH24:MI'),    ''),
                        'horaFin', coalesce(to_char(e.hora_fin, 'HH24:MI'),    ''),
                        'lugar',   e.lugar,
                        'notas',   e.notas,
                        'convocados', (
                          select coalesce(jsonb_agg(jsonb_build_object(
                                   'nombre',      p.nombre,
                                   'hora',        coalesce(to_char(cv.hora, 'HH24:MI'), ''),
                                   'instrumento', cv.instrumento,
                                   'aviso',       coalesce(cv.aviso::text, '')
                                 ) order by cv.orden), '[]'::jsonb)
                          from   convocado cv
                          join   persona p on p.id = cv.persona_id
                          where  cv.ensayo_id = e.id)
                      ) order by e.orden), '[]'::jsonb)
               from ensayo e where e.jam_id = j.id),

             'items', (
               select coalesce(jsonb_agg(x.item order by x.orden), '[]'::jsonb)
               from (
                 select i.orden, case i.tipo

                   when 'bloque' then jsonb_build_object(
                     'tipo', 'bloque', 'label', i.label)

                   when 'break' then jsonb_build_object(
                     'tipo', 'break', 'label', i.label, 'minutos', i.minutos)

                   when 'medley' then jsonb_build_object(
                     'tipo', 'medley', 'titulo', i.titulo, 'notas', i.notas,
                     'songs', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'songId',    h.song_id,
                                 'notas',     h.notas,
                                 'musicos',   h.musicos,
                                 'ensayada',  h.ensayada,
                                 'notaTecnica', h.nota_tecnica,
                                 'cantantes', cantantes_de(h.id)
                               ) order by h.orden), '[]'::jsonb)
                               from setlist_item h where h.parent_id = i.id))

                   else jsonb_build_object(
                     'tipo', 'song', 'songId', i.song_id, 'notas', i.notas,
                     'musicos', i.musicos,
                     'ensayada', i.ensayada,
                     'notaTecnica', i.nota_tecnica,
                     'cantantes', cantantes_de(i.id))

                 end as item
                 from   setlist_item i
                 where  i.jam_id = j.id and i.parent_id is null) x)

           ) order by j.historica, j.fecha desc nulls last, j.creada desc), '[]'::jsonb)
    from jam j),

  'cantantes', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'nombre', p.nombre, 'rol', p.rol,
             'activo', p.activo, 'telefono', p.telefono, 'email', p.email,
             'contacto', p.contacto, 'notas', p.notas,
             'temas', st.temas, 'jams', st.jams
           ) order by st.temas desc, lower(p.nombre)), '[]'::jsonb)
    from   persona p join persona_stats st on st.id = p.id
    where  p.rol = 'voz'),

  'musicos', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'nombre', p.nombre, 'rol', p.rol,
             'instrumentos', to_jsonb(p.instrumentos),
             'activo', p.activo, 'telefono', p.telefono, 'email', p.email,
             'contacto', p.contacto, 'notas', p.notas,
             'temas', st.temas, 'jams', st.jams
           ) order by st.temas desc, lower(p.nombre)), '[]'::jsonb)
    from   persona p join persona_stats st on st.id = p.id
    where  p.rol = 'instrumento'),

  'porConfirmar', (select coalesce(jsonb_agg(texto order by orden), '[]'::jsonb)
                     from pendiente)
)
$fn$;
