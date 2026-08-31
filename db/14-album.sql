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
-- Mismo movimiento que db/13 para duración y Spotify: las
-- columnas, y después las dos funciones que las mueven.
--
-- Es idempotente: correrlo dos veces no rompe nada.
--
-- Las funciones van completas, copiadas de db/04-escritura.sql y
-- db/03-app-estado.sql tal como están hoy, con las líneas nuevas
-- sumadas. Si alguna cambió después de esto, rehacer el diff
-- antes de correr.
-- ============================================================

alter table song add column if not exists album    text   not null default '';
alter table song add column if not exists album_id bigint;
alter table song add column if not exists cover    text   not null default '';

-- Si el tema lleva vientos. Se marca con la trompeta en el playlist.
alter table song add column if not exists vientos  boolean not null default false;


-- ── escritura ───────────────────────────────────────────────
-- Las cuatro entran también al WHERE del final: es lo que decide si la
-- fila cambió. Sin eso, cargar una tapa no marca el tema como
-- actualizado y el resto de la banda no se entera.

create or replace function guardar_catalogo(c jsonb) returns bigint
language plpgsql as $fn$
declare e jsonb; cid smallint;
begin
  -- categorías
  for e in select * from jsonb_array_elements(c->'categorias') loop
    insert into categoria (id, nombre, orden)
    values ((select coalesce(max(id), 0) + 1 from categoria), e#>>'{}',
            (select coalesce(max(orden), 0) + 1 from categoria))
    on conflict (nombre) do nothing;
  end loop;

  -- personas (cantantes y músicos vienen en dos listas, van a una tabla)
  for e in select * from jsonb_array_elements(
             coalesce(c->'cantantes', '[]') || coalesce(c->'musicos', '[]')) loop
    insert into persona (id, nombre, rol, activo, instrumentos,
                         telefono, email, contacto, notas)
    values (e->>'id', e->>'nombre',
            coalesce((e->>'rol')::rol_persona, 'voz'),
            coalesce((e->>'activo')::boolean, true),
            coalesce((select array_agg(x#>>'{}')
                        from jsonb_array_elements(e->'instrumentos') x), '{}'),
            coalesce(e->>'telefono', ''), coalesce(e->>'email', ''),
            coalesce(e->>'contacto', ''), coalesce(e->>'notas', ''))
    on conflict (id) do update set
      nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo,
      instrumentos = excluded.instrumentos, telefono = excluded.telefono,
      email = excluded.email, contacto = excluded.contacto, notas = excluded.notas
    where persona.nombre       is distinct from excluded.nombre
       or persona.rol          is distinct from excluded.rol
       or persona.activo       is distinct from excluded.activo
       or persona.instrumentos is distinct from excluded.instrumentos
       or persona.telefono     is distinct from excluded.telefono
       or persona.email        is distinct from excluded.email
       or persona.contacto     is distinct from excluded.contacto
       or persona.notas        is distinct from excluded.notas;
  end loop;

  -- temas
  for e in select * from jsonb_array_elements(c->'songs') loop
    select id into cid from categoria where nombre = e->>'categoria';
    if cid is null then
      insert into categoria (id, nombre, orden)
      values ((select coalesce(max(id), 0) + 1 from categoria), e->>'categoria',
              (select coalesce(max(orden), 0) + 1 from categoria))
      returning id into cid;
    end if;

    insert into song (id, titulo, artista, categoria_id, estado, bpm, bpm_raw,
                      bpm_fuente, anio, notas, origen, genero_web,
                      cifra_url, cifra_artista, cifra_confianza,
                      duracion_sec, spotify_url,
                      album, album_id, cover, vientos, patches, actualizada)
    values (e->>'id', e->>'titulo', e->>'artista', cid,
            case when coalesce((e->>'esIdea')::boolean, false)
                 then 'idea'::estado_song else 'repertorio'::estado_song end,
            nullif(e->>'bpm', '')::smallint, coalesce(e->>'bpmRaw', ''),
            coalesce(e->>'bpmFuente', ''), nullif(e->>'anio', '')::smallint,
            coalesce(e->>'notas', ''), coalesce(e->>'origen', 'manual'),
            coalesce(e->>'generoWeb', ''), coalesce(e->>'cifraUrl', ''),
            coalesce(e->>'cifraArtista', ''), coalesce(e->>'cifraConfianza', ''),
            nullif(e->>'duracionSec', '')::smallint, coalesce(e->>'spotifyUrl', ''),
            coalesce(e->>'album', ''), nullif(e->>'albumId', '')::bigint,
            coalesce(e->>'cover', ''),
            coalesce((e->>'vientos')::boolean, false),
            coalesce((select array_agg(x#>>'{}')
                        from jsonb_array_elements(e->'patches') x), '{}'),
            now())
    on conflict (id) do update set
      titulo = excluded.titulo, artista = excluded.artista,
      categoria_id = excluded.categoria_id, estado = excluded.estado,
      bpm = excluded.bpm, bpm_raw = excluded.bpm_raw,
      bpm_fuente = excluded.bpm_fuente, anio = excluded.anio,
      notas = excluded.notas, origen = excluded.origen,
      genero_web = excluded.genero_web, cifra_url = excluded.cifra_url,
      cifra_artista = excluded.cifra_artista,
      cifra_confianza = excluded.cifra_confianza,
      duracion_sec = excluded.duracion_sec, spotify_url = excluded.spotify_url,
      album = excluded.album, album_id = excluded.album_id, cover = excluded.cover,
      vientos = excluded.vientos,
      patches = excluded.patches, actualizada = now()
    -- El WHERE es lo que hace que `actualizada` signifique algo. Sin él,
    -- cambiar un título marcaba los 551 temas como actualizados y no
    -- quedaba forma de saber cuál se tocó de verdad. De paso, Postgres
    -- se saltea la escritura de las filas que no cambiaron.
    where song.titulo          is distinct from excluded.titulo
       or song.artista         is distinct from excluded.artista
       or song.categoria_id    is distinct from excluded.categoria_id
       or song.estado          is distinct from excluded.estado
       or song.bpm             is distinct from excluded.bpm
       or song.bpm_raw         is distinct from excluded.bpm_raw
       or song.bpm_fuente      is distinct from excluded.bpm_fuente
       or song.anio            is distinct from excluded.anio
       or song.notas           is distinct from excluded.notas
       or song.origen          is distinct from excluded.origen
       or song.genero_web      is distinct from excluded.genero_web
       or song.duracion_sec    is distinct from excluded.duracion_sec
       or song.spotify_url     is distinct from excluded.spotify_url
       or song.cifra_url       is distinct from excluded.cifra_url
       or song.cifra_artista   is distinct from excluded.cifra_artista
       or song.cifra_confianza is distinct from excluded.cifra_confianza
       or song.album           is distinct from excluded.album
       or song.album_id        is distinct from excluded.album_id
       or song.cover           is distinct from excluded.cover
       or song.vientos         is distinct from excluded.vientos
       or song.patches         is distinct from excluded.patches;

    delete from song_cantante where song_id = e->>'id';
    insert into song_cantante (song_id, persona_id, orden)
    select e->>'id', persona_id(x.v#>>'{}'), (x.i - 1)::smallint
    from   jsonb_array_elements(e->'cantantes') with ordinality x(v, i)
    on conflict do nothing;

    -- Los invitados vuelven a partirse en instrumento + persona, que es
    -- como se guardan. Lo que no resuelve a una persona queda como texto.
    delete from song_invitado where song_id = e->>'id';
    insert into song_invitado (song_id, orden, persona_id, instrumento)
    select e->>'id', (x.i - 1)::smallint,
           (select id from persona
             where nombre_norm = norm(regexp_replace(x.v#>>'{}', '^[^[:alnum:]]+', ''))
               and norm(regexp_replace(x.v#>>'{}', '^[^[:alnum:]]+', '')) <> ''),
           case when norm(regexp_replace(x.v#>>'{}', '^[^[:alnum:]]+', '')) = ''
                     or not exists (select 1 from persona
                                     where nombre_norm = norm(regexp_replace(x.v#>>'{}', '^[^[:alnum:]]+', '')))
                then x.v#>>'{}'
                else btrim((regexp_match(x.v#>>'{}', '^([^[:alnum:]]*)'))[1]) end
    from jsonb_array_elements(e->'invitados') with ordinality x(v, i);
  end loop;

  -- temas que la app ya no tiene. No se tocan los descartados (que la
  -- app no ve) ni los que todavía cuelgan de algún setlist.
  delete from song s
   where s.estado <> 'descartado'
     and not exists (select 1 from jsonb_array_elements(c->'songs') js
                      where js->>'id' = s.id)
     and not exists (select 1 from setlist_item i where i.song_id = s.id);

  -- por confirmar
  -- `where true` no es decorativo: por la API estas funciones corren en
  -- la conexión de PostgREST, donde supautils rechaza los DELETE sin
  -- WHERE ("DELETE requires a WHERE clause"). Por psql pasan igual, así
  -- que esto solo se ve en producción.
  delete from pendiente where true;
  insert into pendiente (texto, orden)
  select x.v#>>'{}', (x.i - 1)::smallint
  from   jsonb_array_elements(coalesce(c->'porConfirmar', '[]')) with ordinality x(v, i);

  return subir_revision();
end $fn$;


-- ── lectura ─────────────────────────────────────────────────

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
                                 'cantantes', cantantes_de(h.id)
                               ) order by h.orden), '[]'::jsonb)
                               from setlist_item h where h.parent_id = i.id))

                   else jsonb_build_object(
                     'tipo', 'song', 'songId', i.song_id, 'notas', i.notas,
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
