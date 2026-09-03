-- ============================================================
-- JAM PORTAL — que nadie pise a nadie
-- ------------------------------------------------------------
-- Dos cosas distintas, que suelen confundirse:
--
--   · Realtime hace que veas el cambio del otro en el momento.
--     Achica la ventana de choque, pero no la cierra: si los dos
--     guardan en el mismo segundo, sigue ganando el último.
--
--   · El control de versión es el que de verdad la cierra. Cada
--     jam tiene un número que sube en cada guardado; quien
--     escribe manda el que leyó, y si no coincide la base
--     rechaza la escritura en vez de aceptarla y perder lo del
--     otro. El choque pasa de invisible a visible.
--
-- Este archivo hace las dos. Es idempotente.
-- ============================================================

alter table jam add column if not exists version bigint not null default 0;

-- ── control de versión ──────────────────────────────────────
drop function if exists guardar_jam(jsonb);
drop function if exists guardar_jam(jsonb, bigint);

create or replace function guardar_jam(j jsonb, version_esperada bigint default null)
returns bigint
language plpgsql as $fn$
declare it jsonb; sub jsonb; e jsonb; iid uuid; eid uuid;
        pos int := 0; kpos int; epos int := 0;
        v_actual bigint;
begin
  select version into v_actual from jam where id = j->>'id';

  -- La comparación es opcional para no romper a quien todavía llame a la
  -- función con un solo argumento. Cuando viene, manda.
  if version_esperada is not null and v_actual is not null
     and v_actual <> version_esperada then
    -- El prefijo PT hace que PostgREST devuelva ese código HTTP: 409.
    raise exception 'La jam cambió mientras la editabas (leíste v%, hay v%)',
                    version_esperada, v_actual
      using errcode = 'PT409',
            hint = 'Traé los cambios del otro antes de guardar.';
  end if;

  insert into jam (id, nombre, fecha, hora, lugar, notas, historica, con_orden,
                   cerrada, vivo_indice, mes, dia, actualizada, version)
  values (j->>'id', coalesce(j->>'nombre', ''),
          nullif(j->>'fecha', '')::date, nullif(j->>'hora', '')::time,
          coalesce(j->>'lugar', ''), coalesce(j->>'notas', ''),
          coalesce((j->>'historica')::boolean, false),
          coalesce((j->>'conOrden')::boolean, true),
          coalesce((j->>'cerrada')::boolean, false),
          coalesce((j->>'vivoIndice')::smallint, 0),
          nullif(j->>'mes', '')::smallint, nullif(j->>'dia', '')::smallint,
          now(), coalesce(v_actual, 0) + 1)
  on conflict (id) do update set
    nombre = excluded.nombre, fecha = excluded.fecha, hora = excluded.hora,
    lugar = excluded.lugar, notas = excluded.notas,
    historica = excluded.historica, con_orden = excluded.con_orden,
    cerrada = excluded.cerrada, vivo_indice = excluded.vivo_indice,
    mes = excluded.mes, dia = excluded.dia,
    actualizada = now(), version = jam.version + 1;

  delete from setlist_item where jam_id = j->>'id';

  for it in select * from jsonb_array_elements(coalesce(j->'items', '[]')) loop
    iid := gen_random_uuid();
    insert into setlist_item (id, jam_id, parent_id, orden, tipo, song_id,
                              titulo, label, minutos, notas, musicos, ensayada)
    values (iid, j->>'id', null, pos, (it->>'tipo')::tipo_item,
            nullif(it->>'songId', ''), it->>'titulo', it->>'label',
            nullif(it->>'minutos', '')::smallint, coalesce(it->>'notas', ''),
            coalesce(it->'musicos', '{}'::jsonb),
            coalesce((it->>'ensayada')::boolean, false));

    insert into item_cantante (item_id, persona_id, orden)
    select iid, persona_id(x.v#>>'{}'), (x.nn - 1)::smallint
    from   jsonb_array_elements(coalesce(it->'cantantes', '[]')) with ordinality x(v, nn)
    on conflict do nothing;

    kpos := 0;
    for sub in select * from jsonb_array_elements(coalesce(it->'songs', '[]')) loop
      insert into setlist_item (id, jam_id, parent_id, orden, tipo, song_id,
                                notas, musicos, ensayada)
      values (gen_random_uuid(), j->>'id', iid, kpos, 'song',
              nullif(sub->>'songId', ''), coalesce(sub->>'notas', ''),
              coalesce(sub->'musicos', '{}'::jsonb),
              coalesce((sub->>'ensayada')::boolean, false))
      returning id into eid;

      insert into item_cantante (item_id, persona_id, orden)
      select eid, persona_id(x.v#>>'{}'), (x.nn - 1)::smallint
      from   jsonb_array_elements(coalesce(sub->'cantantes', '[]')) with ordinality x(v, nn)
      on conflict do nothing;
      kpos := kpos + 1;
    end loop;
    pos := pos + 1;
  end loop;

  delete from jam_musico_extra where jam_id = j->>'id';
  insert into jam_musico_extra (jam_id, persona_id)
  select j->>'id', persona_id(x#>>'{}')
  from   jsonb_array_elements(coalesce(j->'musicosExtra', '[]')) x
  on conflict do nothing;

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

  -- Una idea que ya sonó en una jam pasada deja de ser una idea.
  update song s set estado = 'repertorio', actualizada = now()
   where s.estado = 'idea'
     and exists (select 1 from song_jam sj where sj.song_id = s.id);

  return subir_revision();
end $fn$;

revoke all on function guardar_jam(jsonb, bigint) from public, anon;
grant execute on function guardar_jam(jsonb, bigint) to authenticated;

-- ── realtime ────────────────────────────────────────────────
-- Solo se publica `revision`: una única fila con un contador. No viaja
-- ni un dato del repertorio por el websocket — el aviso dice "algo
-- cambió" y el cliente vuelve a leer por la vía de siempre, que ya
-- pasa por RLS. Menos superficie y nada que filtrar.
alter table revision replica identity full;

-- La publicación `supabase_realtime` solo existe en Supabase; en un
-- Postgres de escritorio esto se saltea sin ruido.
do $rt$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'sin publicación supabase_realtime: se saltea (Postgres local)';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'revision'
  ) then
    alter publication supabase_realtime add table revision;
  end if;
end $rt$;
