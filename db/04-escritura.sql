-- ============================================================
-- JAM PORTAL — escritura
-- ------------------------------------------------------------
-- El driver sigue mandando documentos enteros (el catálogo por un
-- lado, cada jam por otro), igual que hoy. Estas funciones los
-- desarman en filas. Así el paso a SQL no obliga a reescribir las
-- 1580 líneas de jam-editor.js que mutan objetos en memoria.
--
-- Cada jam se reescribe entera: borrar sus ítems e insertarlos de
-- nuevo es más simple y más seguro que diferenciarlos, y con 25
-- ítems por lista el costo es irrelevante.
--
-- Este archivo está al día con las columnas de las migraciones
-- (db/13, db/14, db/20, db/21, db/22): correrlas primero, y esto
-- después.
--
-- Ojo al re-correrlo sobre una base que ya corrió db/06: acá se
-- crea guardar_jam(jsonb), que db/06 reemplaza por la versión
-- con control de concurrencia. Correr db/06 de nuevo después
-- (es idempotente), o queda un doble pelado y con permisos de
-- más.
--
-- Y otro ojo: los `drop function` de acá tiran los grants, y las
-- funciones recreadas nacen con los defaults del proyecto — que
-- incluyen a `anon`. Después de re-correr esto hay que volver a
-- cerrar los permisos (los revoke de db/05, adaptados a que
-- guardar_jam(jsonb) ya no existe):
--
--   revoke all on function guardar_catalogo(jsonb), borrar_jam(text),
--     cerrar_jam(text, text), abrir_jam(text, text),
--     persona_id(text), subir_revision()
--     from public, anon;
-- ============================================================

-- Contador global de revisión: el sondeo pregunta por esto en vez
-- de traerse la base entera. Una sola fila, que toda escritura sube.
create table if not exists revision (
  id    smallint primary key default 1 check (id = 1),
  n     bigint      not null default 0,
  sello timestamptz not null default now()
);
insert into revision (id) values (1) on conflict do nothing;

create or replace function subir_revision() returns bigint
language sql as $fn$
  update revision set n = n + 1, sello = now() where id = 1 returning n;
$fn$;

create or replace function revision_actual() returns bigint
language sql stable as $fn$ select n from revision where id = 1 $fn$;

-- `create or replace` no puede renombrar parámetros, así que para que
-- este archivo se pueda correr de nuevo hay que soltar las funciones.
drop function if exists persona_id(text);
drop function if exists guardar_catalogo(jsonb);
drop function if exists guardar_jam(jsonb);
drop function if exists borrar_jam(text);
drop function if exists cerrar_jam(text, text);
drop function if exists abrir_jam(text, text);

-- Busca una persona por nombre y, si no está, la crea. La app deja
-- escribir cualquier nombre en un setlist; esto lo respeta en vez de
-- rechazar la escritura.
-- El parámetro va prefijado: llamarlo `nombre` lo haría ambiguo contra
-- la columna persona.nombre y plpgsql aborta.
create or replace function persona_id(p_nombre text) returns text
language plpgsql as $fn$
declare pid text; base text;
begin
  if p_nombre is null or btrim(p_nombre) = '' then return null; end if;
  select id into pid from persona where nombre_norm = norm(p_nombre);
  if pid is not null then return pid; end if;

  base := nullif(regexp_replace(norm(p_nombre), '[^a-z0-9]+', '-', 'g'), '');
  pid  := coalesce(base, 'p') || '-' || substr(md5(p_nombre), 1, 4);
  insert into persona (id, nombre, rol) values (pid, btrim(p_nombre), 'voz')
    on conflict (id) do nothing;
  return pid;
end $fn$;

-- ── catálogo ────────────────────────────────────────────────
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
                      album, album_id, cover, vientos, coros, no_es_nueva,
                      patches, actualizada)
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
            coalesce((e->>'coros')::boolean, false),
            coalesce((e->>'noEsNueva')::boolean, false),
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
      vientos = excluded.vientos, coros = excluded.coros,
      no_es_nueva = excluded.no_es_nueva,
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
       or song.album           is distinct from excluded.album
       or song.album_id        is distinct from excluded.album_id
       or song.cover           is distinct from excluded.cover
       or song.vientos         is distinct from excluded.vientos
       or song.coros           is distinct from excluded.coros
       or song.no_es_nueva     is distinct from excluded.no_es_nueva
       or song.cifra_url       is distinct from excluded.cifra_url
       or song.cifra_artista   is distinct from excluded.cifra_artista
       or song.cifra_confianza is distinct from excluded.cifra_confianza
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

-- ── una jam ─────────────────────────────────────────────────
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
                              titulo, label, minutos, notas, musicos)
    values (iid, j->>'id', null, pos, (it->>'tipo')::tipo_item,
            nullif(it->>'songId', ''), it->>'titulo', it->>'label',
            nullif(it->>'minutos', '')::smallint, coalesce(it->>'notas', ''),
            coalesce(it->'musicos', '{}'::jsonb));

    insert into item_cantante (item_id, persona_id, orden)
    select iid, persona_id(x.v#>>'{}'), (x.nn - 1)::smallint
    from   jsonb_array_elements(coalesce(it->'cantantes', '[]')) with ordinality x(v, nn)
    on conflict do nothing;

    kpos := 0;
    for sub in select * from jsonb_array_elements(coalesce(it->'songs', '[]')) loop
      insert into setlist_item (id, jam_id, parent_id, orden, tipo, song_id,
                                notas, musicos)
      values (gen_random_uuid(), j->>'id', iid, kpos, 'song',
              nullif(sub->>'songId', ''), coalesce(sub->>'notas', ''),
              coalesce(sub->'musicos', '{}'::jsonb))
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

create or replace function borrar_jam(jid text) returns bigint
language plpgsql as $fn$
begin
  delete from jam where id = jid;
  return subir_revision();
end $fn$;

-- Cerrar una jam guarda el hash del código, nunca el código.
-- El search_path va fijo porque crypt() y gen_salt() viven en el schema
-- `extensions` en Supabase: sin esto dependería de cómo esté configurado
-- el rol que llama.
create or replace function cerrar_jam(jid text, codigo text) returns bigint
language plpgsql set search_path = public, extensions, pg_catalog as $fn$
begin
  update jam set cerrada = true, actualizada = now(),
                 codigo_hash = case when coalesce(codigo, '') = '' then null
                                    else crypt(codigo, gen_salt('bf')) end
   where id = jid;
  return subir_revision();
end $fn$;

create or replace function abrir_jam(jid text, codigo text) returns boolean
language plpgsql set search_path = public, extensions, pg_catalog as $fn$
declare h text;
begin
  select codigo_hash into h from jam where id = jid;
  if h is null then return true; end if;
  return h = crypt(coalesce(codigo, ''), h);
end $fn$;

-- Vacía todo menos el catálogo de categorías. Es lo que usa "Reiniciar"
-- en Datos; deja la base lista para volver a sembrarla con 10-datos.sql.
create or replace function vaciar_todo() returns bigint
language plpgsql as $fn$
begin
  -- `where true` por lo mismo que en guardar_catalogo: sin él, la API
  -- rechaza el DELETE por no tener WHERE.
  delete from jam       where true;   -- cascada: setlist, cantantes, ensayos
  delete from song      where true;   -- cascada: cantantes e invitados
  delete from persona   where true;
  delete from pendiente where true;
  return subir_revision();
end $fn$;
