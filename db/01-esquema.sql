-- ============================================================
-- JAM PORTAL — esquema
-- ------------------------------------------------------------
-- Corre entero y de una. Es idempotente a nivel "base limpia":
-- para rehacerlo, `drop schema public cascade; create schema public;`
--
-- Regla que ordena todo lo de abajo: nada que se pueda calcular
-- se guarda. Lo derivado vive en 02-vistas.sql.
-- ============================================================

-- Supabase pone las extensiones en el schema `extensions`; un Postgres
-- de escritorio no tiene ese schema y van a `public`. norm() busca en
-- los dos, así que cualquiera de las dos ubicaciones sirve.
do $ext$
declare destino text := case
  when exists (select 1 from pg_namespace where nspname = 'extensions')
  then ' with schema extensions' else '' end;
begin
  execute 'create extension if not exists unaccent'  || destino;
  execute 'create extension if not exists pg_trgm'   || destino;
  execute 'create extension if not exists pgcrypto'  || destino;
end $ext$;

-- ── normalización ───────────────────────────────────────────
-- La misma norm() que js/store.js, para cruzar por nombre sin
-- depender de acentos ni puntuación. Se usa la forma de dos
-- argumentos de unaccent(), que es IMMUTABLE y por eso sirve
-- adentro de columnas generadas e índices.
-- El `set search_path` no es decorativo: las columnas generadas y los
-- índices se evalúan con el search_path restringido, y sin esto no
-- resuelven el diccionario de unaccent. Incluye `extensions` porque es
-- ahí donde Supabase instala las extensiones, y `public` para Postgres
-- local; la que no exista se ignora.
create or replace function norm(t text) returns text
language sql immutable parallel safe
set search_path = public, extensions, pg_catalog as $fn$
  select trim(regexp_replace(
    regexp_replace(
      lower(unaccent('unaccent'::regdictionary, coalesce(t, ''))),
      '[^a-z0-9[:space:]]', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'))
$fn$;

create type rol_persona  as enum ('voz', 'instrumento');
create type estado_song  as enum ('repertorio', 'idea', 'descartado');
create type franja_tempo as enum ('low', 'mid', 'high');
create type tipo_item    as enum ('song', 'medley', 'break', 'bloque');
create type medio_aviso  as enum ('wsp', 'mail');

-- ── catálogo ────────────────────────────────────────────────
create table categoria (
  id     smallint primary key,
  nombre text     not null unique,
  orden  smallint not null default 0
);

create table persona (
  id           text primary key,               -- 'pachu', 'inv-fabo'
  nombre       text not null,
  nombre_norm  text not null generated always as (norm(nombre)) stored,
  rol          rol_persona not null default 'voz',
  activo       boolean not null default true,
  -- 'Todos' aparece como cantante de un tema pero no es una persona:
  -- queda marcado para que no ensucie contactos ni convocatorias.
  especial     boolean not null default false,
  instrumentos text[] not null default '{}',
  telefono     text not null default '',
  email        text not null default '',
  contacto     text not null default '',       -- campo viejo: mail o tel suelto
  notas        text not null default '',
  creada       timestamptz not null default now()
);
create unique index persona_nombre_uk on persona (nombre_norm);

create table song (
  id           text primary key,               -- 'a-ha--take-on-me'
  titulo       text not null,
  artista      text not null,
  categoria_id smallint not null references categoria,
  estado       estado_song not null default 'repertorio',

  bpm        smallint check (bpm between 40 and 260),
  bpm_raw    text not null default '',         -- '108 / 105', tal como vino
  bpm_fuente text not null default ''
             check (bpm_fuente in ('', 'sugerido', 'sin')),

  -- Hoy coincide en 374/374 porque hay JS que la recalcula en cada
  -- escritura. Como columna generada no se puede desincronizar.
  -- Ojo: el cast va en CADA rama. Castear el resultado del case entero
  -- ((case ... end)::franja_tempo) hace que Postgres considere la
  -- expresión no inmutable y rechace la columna generada.
  franja franja_tempo generated always as (
           case when bpm is null then null::franja_tempo
                when bpm <=  99  then 'low'::franja_tempo
                when bpm <= 124  then 'mid'::franja_tempo
                else                  'high'::franja_tempo end) stored,

  anio       smallint,
  notas      text not null default '',
  origen     text not null default 'manual',   -- import | manual | web:itunes
  genero_web text not null default '',

  cifra_url       text not null default '',
  cifra_artista   text not null default '',
  cifra_confianza text not null default '',

  patches text[] not null default '{}',        -- 'g43': códigos de teclado

  creada      timestamptz not null default now(),
  actualizada timestamptz not null default now()
);

create index song_categoria_ix on song (categoria_id);
create index song_franja_ix    on song (franja);
create index song_estado_ix    on song (estado) where estado <> 'repertorio';
create index song_busca_ix     on song using gin ((titulo || ' ' || artista) gin_trgm_ops);

-- Quién canta habitualmente cada tema.
create table song_cantante (
  song_id    text not null references song    on delete cascade,
  persona_id text not null references persona on delete restrict,
  orden      smallint not null default 0,
  primary key (song_id, persona_id)
);
create index song_cantante_persona_ix on song_cantante (persona_id);

-- Los invitados de un tema. En el JSON viejo esto era un text[] con
-- dos cosas mezcladas: "🥁 Fabo" (una persona con su instrumento) y
-- "🎷" suelto (hubo un saxo, sin nombre). Separarlos es lo que vuelve
-- derivable el contador de temas de los músicos, que hoy es el campo
-- más desincronizado de la base.
create table song_invitado (
  song_id     text not null references song on delete cascade,
  orden       smallint not null default 0,
  persona_id  text references persona on delete restrict,   -- null = sin nombre
  instrumento text not null default '',                     -- '🥁', '🎷'
  primary key (song_id, orden),
  constraint invitado_algo check (persona_id is not null or instrumento <> '')
);
create index song_invitado_persona_ix on song_invitado (persona_id);

-- ── jams ────────────────────────────────────────────────────
create table jam (
  id          text primary key,
  nombre      text not null,
  fecha       date,
  hora        time,
  lugar       text not null default 'Portal',
  notas       text not null default '',

  historica   boolean not null default false,
  con_orden   boolean not null default true,
  cerrada     boolean not null default false,
  codigo_hash text,                     -- crypt(); nunca el código en claro
  vivo_indice smallint not null default 0,

  mes smallint check (mes between 1 and 12),   -- históricas sin fecha exacta
  dia smallint check (dia between 1 and 31),

  creada      timestamptz not null default now(),
  actualizada timestamptz not null default now(),

  -- Sube en cada guardado. Quien escribe manda la versión que leyó, y
  -- si no coincide es porque otro guardó en el medio: la escritura se
  -- rechaza en vez de pisarlo en silencio.
  version     bigint not null default 0
);

-- El historial de cada tema usa el NOMBRE de la jam como clave.
-- Hoy funciona porque los 26 nombres resultaron únicos, no porque
-- algo lo impida: dos jams homónimas corromperían el historial de
-- todos los temas de las dos.
create unique index jam_nombre_uk on jam (norm(nombre));

-- El setlist. Se referencia a sí misma: los temas de un medley son
-- filas hijas con parent_id apuntando al medley, así hay una sola
-- tabla y un solo camino de código para los dos niveles.
create table setlist_item (
  id        uuid primary key default gen_random_uuid(),
  jam_id    text not null references jam on delete cascade,
  parent_id uuid references setlist_item (id) on delete cascade,
  orden     integer not null,
  tipo      tipo_item not null,

  song_id text references song on delete restrict,  -- tipo = 'song'
  titulo  text,                                     -- tipo = 'medley'
  label   text,                                     -- 'bloque' | 'break'
  minutos smallint,                                 -- tipo = 'break'
  notas   text not null default '',

  constraint item_song   check (tipo <> 'song'   or song_id is not null),
  constraint item_medley check (tipo <> 'medley' or song_id is null),
  constraint item_break  check (tipo <> 'break'  or label   is not null),
  constraint item_bloque check (tipo <> 'bloque' or label   is not null),
  -- de un medley solo cuelgan temas
  constraint item_hijo   check (parent_id is null or tipo = 'song'),

  -- DEFERRABLE porque arrastrar un tema renumera la lista entera
  -- dentro de una transacción, y en el medio los ordenes chocan.
  constraint item_orden unique nulls not distinct (jam_id, parent_id, orden)
    deferrable initially deferred
);

create index setlist_item_jam_ix    on setlist_item (jam_id, parent_id, orden);
create index setlist_item_song_ix   on setlist_item (song_id);
create index setlist_item_parent_ix on setlist_item (parent_id);

-- Quién cantó ese tema esa noche (puede no ser el cantante habitual).
create table item_cantante (
  item_id    uuid not null references setlist_item on delete cascade,
  persona_id text not null references persona      on delete restrict,
  orden      smallint not null default 0,
  primary key (item_id, persona_id)
);

-- Músicos sumados a mano a una jam, además de los que salen del setlist.
create table jam_musico_extra (
  jam_id     text not null references jam     on delete cascade,
  persona_id text not null references persona on delete restrict,
  primary key (jam_id, persona_id)
);

-- ── ensayos ─────────────────────────────────────────────────
create table ensayo (
  id       uuid primary key default gen_random_uuid(),
  jam_id   text not null references jam on delete cascade,
  fecha    date,
  hora     time,
  hora_fin time,
  lugar    text not null default '',
  notas    text not null default '',
  orden    smallint not null default 0
);
create index ensayo_jam_ix on ensayo (jam_id, orden);

create table convocado (
  ensayo_id   uuid not null references ensayo  on delete cascade,
  persona_id  text not null references persona on delete restrict,
  hora        time,
  instrumento text not null default '',
  aviso       medio_aviso,          -- null = todavía no se le avisó
  avisado_en  timestamptz,
  orden       smallint not null default 0,
  primary key (ensayo_id, persona_id)
);

-- ── suelto ──────────────────────────────────────────────────
-- "Por confirmar": renglones del documento original que nunca se
-- resolvieron a un tema concreto.
create table pendiente (
  id     uuid primary key default gen_random_uuid(),
  texto  text not null,
  orden  smallint not null default 0,
  creado timestamptz not null default now()
);
