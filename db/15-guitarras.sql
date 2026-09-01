-- ============================================================
-- JAM PORTAL — quién toca la viola en cada tema
-- ------------------------------------------------------------
-- Dos puestos de guitarra por tema, con quién lo toca y si hace
-- el solo. Se ve y se edita desde el gremio Guitarras.
--
-- Va en `setlist_item` y no en `song` a propósito: quién agarra
-- la viola es cosa de esta jam, no del tema para siempre. Igual
-- que los cantantes.
--
-- Se guarda como jsonb —[{nombre, solo}, {nombre, solo}]— en vez
-- de cuatro columnas: son siempre dos puestos, siempre juntos, y
-- así agregar un tercero no pide otra migración.
--
-- Es idempotente: correrlo dos veces no rompe nada.
-- ============================================================

alter table setlist_item
  add column if not exists guitarras jsonb not null default '[]'::jsonb;


-- ── escritura ───────────────────────────────────────────────

create or replace function guardar_jam(j jsonb) returns bigint
language plpgsql as $fn$
declare it jsonb; sub jsonb; e jsonb; iid uuid; eid uuid;
        pos int := 0; kpos int; epos int := 0;
begin
  insert into jam (id, nombre, fecha, hora, lugar, notas, historica, con_orden,
                   cerrada, vivo_indice, mes, dia, actualizada)
  values (j->>'id', coalesce(j->>'nombre', ''),
          nullif(j->>'fecha', '')::date, nullif(j->>'hora', '')::time,
          coalesce(j->>'lugar', ''), coalesce(j->>'notas', ''),
          coalesce((j->>'historica')::boolean, false),
          coalesce((j->>'conOrden')::boolean, true),
          coalesce((j->>'cerrada')::boolean, false),
          coalesce((j->>'vivoIndice')::smallint, 0),
          nullif(j->>'mes', '')::smallint, nullif(j->>'dia', '')::smallint, now())
  on conflict (id) do update set
    nombre = excluded.nombre, fecha = excluded.fecha, hora = excluded.hora,
    lugar = excluded.lugar, notas = excluded.notas,
    historica = excluded.historica, con_orden = excluded.con_orden,
    cerrada = excluded.cerrada, vivo_indice = excluded.vivo_indice,
    mes = excluded.mes, dia = excluded.dia, actualizada = now();

  -- el setlist se reescribe entero (borra en cascada hijos y cantantes)
  delete from setlist_item where jam_id = j->>'id';

  for it in select * from jsonb_array_elements(coalesce(j->'items', '[]')) loop
    iid := gen_random_uuid();
    insert into setlist_item (id, jam_id, parent_id, orden, tipo, song_id,
                              titulo, label, minutos, notas, guitarras)
    values (iid, j->>'id', null, pos, (it->>'tipo')::tipo_item,
            nullif(it->>'songId', ''), it->>'titulo', it->>'label',
            nullif(it->>'minutos', '')::smallint, coalesce(it->>'notas', ''),
            coalesce(it->'guitarras', '[]'::jsonb));

    insert into item_cantante (item_id, persona_id, orden)
    select iid, persona_id(x.v#>>'{}'), (x.nn - 1)::smallint
    from   jsonb_array_elements(coalesce(it->'cantantes', '[]')) with ordinality x(v, nn)
    on conflict do nothing;

    kpos := 0;
    for sub in select * from jsonb_array_elements(coalesce(it->'songs', '[]')) loop
      insert into setlist_item (id, jam_id, parent_id, orden, tipo, song_id, notas)
      values (gen_random_uuid(), j->>'id', iid, kpos, 'song',
              nullif(sub->>'songId', ''), coalesce(sub->>'notas', ''))
      returning id into eid;

      insert into item_cantante (item_id, persona_id, orden)
      select eid, persona_id(x.v#>>'{}'), (x.nn - 1)::smallint
      from   jsonb_array_elements(coalesce(sub->'cantantes', '[]')) with ordinality x(v, nn)
      on conflict do nothing;
      kpos := kpos + 1;
    end loop;
    pos := pos + 1;
  end loop;

  -- músicos sumados a mano (los del setlist salen de la vista jam_musico)
  delete from jam_musico_extra where jam_id = j->>'id';
  insert into jam_musico_extra (jam_id, persona_id)
  select j->>'id', persona_id(x#>>'{}')
  from   jsonb_array_elements(coalesce(j->'musicosExtra', '[]')) x
  on conflict do nothing;

  -- ensayos y convocatorias
  delete from ensayo where jam_id = j->>'id';
  for e in select * from jsonb_array_elements(coalesce(j->'ensayos', '[]')) loop
    insert into ensayo (id, jam_id, fecha, hora, hora_fin, lugar, notas, orden)
    values (gen_random_uuid(), j->>'id', nullif(e->>'fecha', '')::date,
            nullif(e->>'hora', '')::time, nullif(e->>'horaFin', '')::time,
            coalesce(e->>'lugar', ''), coalesce(e->>'notas', ''), epos)
    returning id into eid;

    insert into convocado (ensayo_id, persona_id, hora, instrumento, aviso, orden)
    select eid, persona_id(x.v->>'nombre'), nullif(x.v->>'hora', '')::time,
           coalesce(x.v->>'instrumento', ''),
           nullif(x.v->>'aviso', '')::medio_aviso, (x.nn - 1)::smallint
    from   jsonb_array_elements(coalesce(e->'convocados', '[]')) with ordinality x(v, nn)
    where  btrim(coalesce(x.v->>'nombre', '')) <> ''
    on conflict do nothing;
    epos := epos + 1;
  end loop;

  -- Una idea que ya sonó en una jam pasada deja de ser una idea. Es lo
  -- único que hacía consolidarJamsPasadas() y que no era mantener a mano
  -- datos derivados: el resto lo resuelve la vista song_jam.
  update song s set estado = 'repertorio', actualizada = now()
   where s.estado = 'idea'
     and exists (select 1 from song_jam sj where sj.song_id = s.id);

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
                     'guitarras', i.guitarras,
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
