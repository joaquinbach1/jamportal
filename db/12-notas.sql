-- ============================================================
-- JAM PORTAL — notas privadas por tema
-- ------------------------------------------------------------
-- "Entro en el segundo estribillo", "afinar medio tono abajo".
-- Son de cada uno: nadie más las ve, ni siquiera un admin.
--
-- La privacidad no depende de que el cliente se porte bien. El
-- email sale del JWT adentro de la base, así que aunque alguien
-- llame a la API a mano solo puede tocar las suyas.
-- ============================================================

create table if not exists nota (
  email     text        not null,
  jam_id    text        not null,
  song_id   text        not null,
  texto     text        not null,
  guardada  timestamptz not null default now(),
  primary key (email, jam_id, song_id)
);

alter table nota enable row level security;

drop policy if exists "solo las mías" on nota;
create policy "solo las mías" on nota for all
  to authenticated
  using      (es_miembro() and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (es_miembro() and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ── lectura ─────────────────────────────────────────────────
-- Todo junto en un viaje: { "jam_1": { "song_a": "texto" } }
create or replace function mis_notas() returns jsonb
language sql stable security invoker set search_path = public as $fn$
  select coalesce(
    jsonb_object_agg(jam_id, temas),
    '{}'::jsonb
  )
  from (
    select jam_id, jsonb_object_agg(song_id, texto) as temas
      from nota
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     group by jam_id
  ) x
$fn$;

-- ── escritura ───────────────────────────────────────────────
-- Con texto vacío se borra: es lo que espera alguien que vació el campo.
create or replace function guardar_nota(p_jam text, p_song text, p_texto text)
returns void
language plpgsql volatile security invoker set search_path = public as $fn$
declare
  yo text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if yo = '' then
    raise exception 'sin sesión';
  end if;

  if coalesce(btrim(p_texto), '') = '' then
    delete from nota where email = yo and jam_id = p_jam and song_id = p_song;
  else
    insert into nota (email, jam_id, song_id, texto)
    values (yo, p_jam, p_song, btrim(p_texto))
    on conflict (email, jam_id, song_id)
      do update set texto = excluded.texto, guardada = now();
  end if;
end
$fn$;

-- ── permisos ────────────────────────────────────────────────
grant select, insert, update, delete on nota to authenticated;
revoke all on nota from anon;

revoke all on function mis_notas(), guardar_nota(text, text, text) from public, anon;
grant execute on function mis_notas(), guardar_nota(text, text, text) to authenticated;
