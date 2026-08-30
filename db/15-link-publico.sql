-- ============================================================
-- JAM PORTAL — el link para compartir una jam
-- ------------------------------------------------------------
-- Un link que se manda por WhatsApp y abre esa jam sin cuenta:
-- se ve y se edita, como si fueras de la banda, pero SOLO esa
-- jam. El resto de la base sigue cerrado.
--
-- Tres piezas:
--
--   1. `jam.token` — 12 caracteres al azar. No es el id, que es
--      adivinable ('hist-jam-nostalgia-15-8'). Se crea cuando
--      alguien pide el link y se borra para revocarlo.
--
--   2. Snapshots. Si cualquiera con el link puede vaciar el
--      setlist una hora antes de la jam, tiene que haber vuelta
--      atrás. Antes no había ninguna: `version` subía pero no
--      guardaba lo anterior.
--
--   3. Las funciones que `anon` puede ejecutar, y nada más.
--      Las tablas siguen revocadas: se entra por acá o no se
--      entra.
--
-- Lo que el link NO muestra, aunque deje editar: teléfonos y
-- mails de las personas, las otras jams, los ensayos y a quién
-- convocaron, y las notas de la jam. El repertorio sí, porque
-- sin él no se puede buscar un tema para agregarlo.
-- ============================================================

alter table jam add column if not exists token text;

do $$
begin
  alter table jam add constraint jam_token_uk unique (token);
exception when duplicate_object then null;
end $$;


-- ============================================================
-- 1. Snapshots — la vuelta atrás
-- ------------------------------------------------------------
-- El truco para no copiar las 90 líneas de guardar_jam: esa
-- función actualiza la fila de `jam` ANTES de borrar los ítems,
-- así que un trigger sobre la fila los ve todavía enteros. De
-- paso cubre todos los caminos de escritura —miembro, link
-- público o psql— sin que ninguno tenga que acordarse.
-- ============================================================

create table if not exists jam_respaldo (
  id      bigserial primary key,
  jam_id  text        not null,
  nombre  text        not null default '',
  version bigint      not null default 0,
  items   jsonb       not null,
  quien   text        not null default '',
  creada  timestamptz not null default now()
);
create index if not exists jam_respaldo_ix on jam_respaldo (jam_id, creada desc);

-- Los ítems con la misma forma que usa la app. Un respaldo es, tal
-- cual, un `items` válido para volver a pasarle a guardar_jam().
create or replace function items_de_jam(jid text) returns jsonb
language sql stable as $fn$
  select coalesce(jsonb_agg(x.item order by x.orden), '[]'::jsonb)
  from (
    select i.orden, case i.tipo
      when 'bloque' then jsonb_build_object('tipo', 'bloque', 'label', i.label)
      when 'break'  then jsonb_build_object('tipo', 'break', 'label', i.label,
                                            'minutos', i.minutos)
      when 'medley' then jsonb_build_object(
        'tipo', 'medley', 'titulo', i.titulo, 'notas', i.notas,
        'songs', (select coalesce(jsonb_agg(jsonb_build_object(
                    'songId', h.song_id, 'notas', h.notas,
                    'cantantes', cantantes_de(h.id)) order by h.orden), '[]'::jsonb)
                  from setlist_item h where h.parent_id = i.id))
      else jsonb_build_object('tipo', 'song', 'songId', i.song_id,
                              'notas', i.notas, 'cantantes', cantantes_de(i.id))
    end as item
    from setlist_item i
    where i.jam_id = jid and i.parent_id is null) x
$fn$;

create or replace function respaldar_jam() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare cuantos jsonb;
begin
  cuantos := items_de_jam(old.id);
  -- Una jam sin ítems no vale la pena guardarla: lo único que haría es
  -- empujar los respaldos buenos fuera de los últimos 20.
  if jsonb_array_length(cuantos) = 0 then return old; end if;

  insert into jam_respaldo (jam_id, nombre, version, items, quien)
  values (old.id, old.nombre, old.version, cuantos,
          coalesce(nullif(auth.jwt() ->> 'email', ''), 'link público'));

  -- Los últimos 20 por jam. Sin esto, una jam que se edita mucho junta
  -- cientos de copias de las que solo sirven las de arriba.
  delete from jam_respaldo r
   where r.jam_id = old.id
     and r.id not in (select id from jam_respaldo
                       where jam_id = old.id order by creada desc limit 20);
  return old;
end $fn$;

drop trigger if exists respaldar_al_guardar on jam;
create trigger respaldar_al_guardar
  after update of version on jam for each row
  when (old.version is distinct from new.version)
  execute function respaldar_jam();

-- Borrar la jam también deja copia: BEFORE, que es cuando los ítems
-- todavía no se fueron con el cascade.
drop trigger if exists respaldar_al_borrar on jam;
create trigger respaldar_al_borrar
  before delete on jam for each row
  execute function respaldar_jam();


-- ── ver y restaurar, para la banda ──────────────────────────
create or replace function respaldos_de(p_jam text) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case when not es_miembro() then null else coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id', r.id, 'version', r.version, 'quien', r.quien,
       'temas', (select count(*) from jsonb_array_elements(r.items)),
       'cuando', to_char(r.creada at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
       order by r.creada desc)
     from jam_respaldo r where r.jam_id = p_jam), '[]'::jsonb) end
$fn$;

create or replace function restaurar_respaldo(p_id bigint) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare r jam_respaldo; j jsonb;
begin
  if not es_miembro() then
    raise exception 'Solo la banda puede restaurar' using errcode = '42501';
  end if;
  select * into r from jam_respaldo where id = p_id;
  if not found then raise exception 'Ese respaldo no existe'; end if;

  -- Se arma el documento de la jam tal como está hoy y se le cambian los
  -- ítems: restaurar la lista no debería mover la fecha ni el lugar.
  select jsonb_build_object(
           'id', j2.id, 'nombre', j2.nombre,
           'fecha', coalesce(to_char(j2.fecha, 'YYYY-MM-DD'), ''),
           'hora', coalesce(to_char(j2.hora, 'HH24:MI'), ''),
           'lugar', j2.lugar, 'notas', j2.notas,
           'historica', j2.historica, 'conOrden', j2.con_orden,
           'cerrada', j2.cerrada, 'vivoIndice', j2.vivo_indice,
           'mes', j2.mes, 'dia', j2.dia,
           'items', r.items)
    into j from jam j2 where j2.id = r.jam_id;
  if j is null then raise exception 'La jam ya no existe'; end if;

  return guardar_jam(j, null);          -- sin versión: restaurar pisa a propósito
end $fn$;


-- ============================================================
-- 2. El token
-- ============================================================

-- 12 caracteres URL-safe = 72 bits. No se adivina ni se enumera.
create or replace function crear_token(p_jam text) returns text
language plpgsql security definer set search_path = public, extensions as $fn$
declare t text;
begin
  if not es_miembro() then
    raise exception 'Solo la banda puede crear el link' using errcode = '42501';
  end if;
  select token into t from jam where id = p_jam;
  if t is not null then return t; end if;

  loop
    t := translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_');
    exit when not exists (select 1 from jam where token = t);
  end loop;
  update jam set token = t where id = p_jam;
  return t;
end $fn$;

create or replace function quitar_token(p_jam text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not es_miembro() then
    raise exception 'Solo la banda puede quitar el link' using errcode = '42501';
  end if;
  update jam set token = null where id = p_jam;
end $fn$;


-- ============================================================
-- 3. Lo que puede hacer quien entra por el link
-- ------------------------------------------------------------
-- Todas `security definer`: leen y escriben por su cuenta, sin
-- pasar por las policies. El token es lo único que las abre, y
-- lo que acota a UNA jam.
-- ============================================================

create or replace function jam_del_token(t text) returns text
language sql stable security definer set search_path = public as $fn$
  select id from jam where token = t and t is not null and t <> ''
$fn$;

/*
 * El estado que ve el link: la misma forma que app_estado(), para que la
 * app no tenga que aprender un formato nuevo, pero con UNA jam.
 *
 * Las personas van sin teléfono ni mail. Son datos de gente real y no
 * hacen ninguna falta para armar un setlist; que estuvieran ahí sería
 * regalarlos con cada link que se manda por WhatsApp.
 */
create or replace function estado_publico(t text) returns jsonb
language sql stable security definer set search_path = public as $fn$
select case when jam_del_token(t) is null then null else jsonb_build_object(

  'version', 3,
  'esAdmin', false,
  'publico', true,

  'categorias', (select coalesce(jsonb_agg(nombre order by orden), '[]'::jsonb)
                   from categoria),

  -- El repertorio entero: sin él no se puede buscar un tema para sumarlo.
  'songs', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'titulo', s.titulo, 'artista', s.artista,
             'categoria', c.nombre, 'bpm', s.bpm, 'bpmRaw', s.bpm_raw,
             'bpmFuente', s.bpm_fuente, 'franja', s.franja, 'anio', s.anio,
             'notas', s.notas, 'origen', s.origen, 'generoWeb', s.genero_web,
             'patches', to_jsonb(s.patches), 'invitados', invitados_de(s.id),
             'cifraUrl', s.cifra_url, 'cifraArtista', s.cifra_artista,
             'cifraConfianza', s.cifra_confianza,
             'duracionSec', s.duracion_sec, 'spotifyUrl', s.spotify_url,
             'album', s.album, 'albumId', s.album_id, 'cover', s.cover,
             'esIdea', s.estado = 'idea',
             'cantantes', (select coalesce(jsonb_agg(p.nombre order by sc.orden, p.nombre), '[]'::jsonb)
                             from song_cantante sc join persona p on p.id = sc.persona_id
                            where sc.song_id = s.id),
             'jams', (select coalesce(jsonb_agg(sj.jam_nombre order by sj.jam_nombre), '[]'::jsonb)
                        from song_jam sj where sj.song_id = s.id)
           ) order by s.artista, s.titulo), '[]'::jsonb)
    from song s join categoria c on c.id = s.categoria_id
    where s.estado <> 'descartado'),

  'jams', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', j.id, 'nombre', j.nombre,
             'fecha', coalesce(to_char(j.fecha, 'YYYY-MM-DD'), ''),
             'hora',  coalesce(to_char(j.hora,  'HH24:MI'),    ''),
             'lugar', j.lugar,
             'notas', '',                       -- las notas son de la banda
             'historica', j.historica, 'conOrden', j.con_orden,
             'cerrada', j.cerrada, 'codigo', '',
             'vivoIndice', j.vivo_indice, 'version', j.version,
             'mes', j.mes, 'dia', j.dia,
             'creada', to_char(j.creada at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'musicos', '[]'::jsonb,
             'musicosExtra', '[]'::jsonb,
             'ensayos', '[]'::jsonb,            -- quién ensaya y cuándo, tampoco
             'items', items_de_jam(j.id)
           )), '[]'::jsonb)
    from jam j where j.id = jam_del_token(t)),

  -- Solo los nombres: son los que se eligen como cantantes de un tema.
  'cantantes', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'nombre', p.nombre, 'rol', p.rol, 'activo', p.activo,
             'telefono', '', 'email', '', 'contacto', '', 'notas', '',
             'temas', st.temas, 'jams', st.jams
           ) order by st.temas desc, lower(p.nombre)), '[]'::jsonb)
    from persona p join persona_stats st on st.id = p.id where p.rol = 'voz'),

  'musicos', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'nombre', p.nombre, 'rol', p.rol,
             'instrumentos', to_jsonb(p.instrumentos), 'activo', p.activo,
             'telefono', '', 'email', '', 'contacto', '', 'notas', '',
             'temas', st.temas, 'jams', st.jams
           ) order by st.temas desc, lower(p.nombre)), '[]'::jsonb)
    from persona p join persona_stats st on st.id = p.id where p.rol = 'instrumento'),

  'porConfirmar', '[]'::jsonb
) end
$fn$;

-- Para el sondeo: el mismo número que revision_actual(), pero abierto
-- solo a quien traiga un token que exista.
create or replace function revision_publica(t text) returns bigint
language sql stable security definer set search_path = public as $fn$
  select case when jam_del_token(t) is null then null
              else (select n from revision where id = 1) end
$fn$;

/*
 * Guardar la jam del link.
 *
 * El token dice CUÁL jam, y por eso el id del documento tiene que
 * coincidir: sin esa comprobación, alguien con un link cualquiera podría
 * mandar el id de otra jam y escribirla.
 */
create or replace function guardar_jam_publica(t text, j jsonb,
                                               version_esperada bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $fn$
declare jid text := jam_del_token(t);
begin
  if jid is null then
    raise exception 'Ese link no sirve o fue revocado' using errcode = '42501';
  end if;
  if j->>'id' is distinct from jid then
    raise exception 'Ese link no abre esa jam' using errcode = '42501';
  end if;
  return guardar_jam(j, version_esperada);
end $fn$;

/*
 * Dar de alta UN tema, para poder sumarlo a la lista.
 *
 * No es guardar_catalogo(): esa recibe el catálogo entero y BORRA lo que
 * no venga en el paquete. Por el link solo se puede insertar de a uno, y
 * si el tema ya existe no se toca — así nadie renombra el repertorio de
 * la banda desde un link que anda dando vueltas.
 */
create or replace function crear_song_publica(t text, s jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare cid smallint; ya text;
begin
  if jam_del_token(t) is null then
    raise exception 'Ese link no sirve o fue revocado' using errcode = '42501';
  end if;
  if coalesce(btrim(s->>'titulo'), '') = '' then
    raise exception 'Falta el título';
  end if;

  select id into ya from song where id = s->>'id';
  if ya is not null then return to_jsonb(ya); end if;

  select id into cid from categoria where nombre = s->>'categoria';
  if cid is null then select id into cid from categoria order by orden limit 1; end if;

  insert into song (id, titulo, artista, categoria_id, estado, bpm, anio,
                    origen, genero_web, duracion_sec, album, album_id, cover)
  values (s->>'id', btrim(s->>'titulo'), coalesce(s->>'artista', ''), cid,
          'repertorio', nullif(s->>'bpm', '')::smallint,
          nullif(s->>'anio', '')::smallint,
          coalesce(s->>'origen', 'link'), coalesce(s->>'generoWeb', ''),
          nullif(s->>'duracionSec', '')::smallint,
          coalesce(s->>'album', ''), nullif(s->>'albumId', '')::bigint,
          coalesce(s->>'cover', ''));
  perform subir_revision();
  return to_jsonb(s->>'id');
end $fn$;


-- ============================================================
-- 4. Permisos
-- ------------------------------------------------------------
-- Las tablas siguen revocadas para `anon`: lo único que puede
-- hacer es llamar a estas cuatro funciones, y las cuatro piden
-- token. Sin token no hay nada.
-- ============================================================

revoke all on function estado_publico(text), revision_publica(text),
                      guardar_jam_publica(text, jsonb, bigint),
                      crear_song_publica(text, jsonb), jam_del_token(text),
                      crear_token(text), quitar_token(text),
                      respaldos_de(text), restaurar_respaldo(bigint),
                      items_de_jam(text)
  from public, anon;

grant execute on function estado_publico(text), revision_publica(text),
                          guardar_jam_publica(text, jsonb, bigint),
                          crear_song_publica(text, jsonb)
  to anon, authenticated;

grant execute on function crear_token(text), quitar_token(text),
                          respaldos_de(text), restaurar_respaldo(bigint)
  to authenticated;

-- La tabla de respaldos se lee por respaldos_de(), no directo.
alter table jam_respaldo enable row level security;
revoke all on table jam_respaldo from anon;
revoke all on sequence jam_respaldo_id_seq from anon;
