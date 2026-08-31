-- ============================================================
-- JAM PORTAL — arreglar el Reggae Medley
-- ------------------------------------------------------------
-- En el doc original (JAM Peace & Love) el Reggae Medley es:
--
--     3 Little Birds        (A)  🥁Fede
--     One Love              (B)  🥁Fede
--     Baby I love your way  (G)  🥁Fede
--     Cant help falling in love (E) Pachu
--
-- La importación lo destrozó buscando cada título en el catálogo
-- y quedándose con el parecido más cercano:
--
--     "One Love"             → "One" de U2
--     "Baby I love your way" → "Baby" de Justin Bieber
--     "3 Little Birds"       → se perdió
--
-- Así quedó un "Reggae Medley" con U2, Justin Bieber y Elvis,
-- que no se parece a un medley de reggae ni de casualidad y por
-- eso nadie lo encontraba buscando "reggae".
--
-- Esto lo devuelve a lo que dice el doc. Tres de los cuatro
-- temas ya están en el catálogo; el que falta se da de alta.
--
-- Es idempotente: si ya está arreglado, no hace nada.
-- ============================================================

-- El que falta. Es la versión reggae de Big Mountain, que es la que se
-- toca; el original de Peter Frampton no es reggae.
insert into song (id, titulo, artista, categoria_id, estado, origen)
select 'big-mountain--baby-i-love-your-way', 'Baby I Love Your Way', 'Big Mountain',
       (select id from categoria where nombre ilike 'Internacional%' order by orden limit 1),
       'repertorio', 'doc'
where not exists (select 1 from song where id = 'big-mountain--baby-i-love-your-way');

do $$
declare med uuid; jid text; iid uuid;
        temas text[] := array[
          'bob-marley--three-little-birds',
          'bob-marley--one-love-people-get-ready',
          'big-mountain--baby-i-love-your-way',
          'elvis-presley--can-t-help-falling-in-love'];
        t text; n smallint := 0;
begin
  select i.id, i.jam_id into med, jid
  from   setlist_item i
  where  i.tipo = 'medley' and i.titulo = 'Reggae Medley'
  limit  1;

  if med is null then
    raise notice 'No hay ningún "Reggae Medley": nada que arreglar.';
    return;
  end if;

  -- ¿ya está como tiene que estar?
  if (select array_agg(h.song_id order by h.orden)
        from setlist_item h where h.parent_id = med) = temas then
    raise notice 'El Reggae Medley ya está arreglado.';
    return;
  end if;

  -- La copia antes de tocar, igual que hace el trigger de respaldos: un
  -- UPDATE directo no mueve jam.version, así que no se dispara solo.
  insert into jam_respaldo (jam_id, nombre, version, items, quien)
  select jid, j.nombre, j.version, items_de_jam(jid), 'arreglo del Reggae Medley'
  from   jam j where j.id = jid;

  delete from item_cantante where item_id in (
    select id from setlist_item where parent_id = med);
  delete from setlist_item where parent_id = med;

  foreach t in array temas loop
    insert into setlist_item (id, jam_id, parent_id, orden, tipo, song_id, notas)
    values (gen_random_uuid(), jid, med, n, 'song', t, '')
    returning id into iid;
    -- Pachu canta el último, según el doc; el resto no dice quién.
    if t = 'elvis-presley--can-t-help-falling-in-love' then
      insert into item_cantante (item_id, persona_id, orden)
      select iid, p.id, 0 from persona p where p.nombre_norm = norm('Pachu')
      on conflict do nothing;
    end if;
    n := n + 1;
  end loop;

  update jam set version = version + 1, actualizada = now() where id = jid;
  raise notice 'Reggae Medley arreglado: % temas.', array_length(temas, 1);
end $$;

select subir_revision();
