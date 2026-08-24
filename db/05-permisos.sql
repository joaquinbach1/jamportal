-- ============================================================
-- JAM PORTAL — permisos
-- ------------------------------------------------------------
-- Esto es lo único de la migración que arregla un problema de
-- seguridad concreto: hoy la política es `for all using (true)`
-- con la clave anónima en el navegador, así que cualquiera con
-- la URL puede leer y borrar todo.
--
-- El reemplazo: entrar con magic link y estar en la lista.
-- Para cinco personas es lo que menos fricción tiene — no hay
-- contraseña que recordar ni que rotar.
--
-- Después de correr esto hay que cargar los emails:
--   insert into miembro (email) values ('alguien@ejemplo.com');
-- y en el panel de Supabase, Authentication → Providers, dejar
-- solo Email con "Confirm email" activado.
-- ============================================================

create table if not exists miembro (
  email text primary key,
  alta  timestamptz not null default now()
);

-- Sin policy: a esta tabla solo se llega desde el panel de Supabase.
alter table miembro enable row level security;

-- security definer para que pueda leer `miembro` aunque quien pregunta
-- no tenga permiso de leerla.
create or replace function es_miembro() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from miembro m
     where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$fn$;

do $do$
declare t text;
begin
  foreach t in array array[
    'categoria', 'persona', 'song', 'song_cantante', 'song_invitado',
    'jam', 'setlist_item', 'item_cantante', 'jam_musico_extra',
    'ensayo', 'convocado', 'pendiente', 'revision']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "solo la banda" on %I', t);
    execute format($p$create policy "solo la banda" on %I for all
                      to authenticated
                      using (es_miembro()) with check (es_miembro())$p$, t);
  end loop;
end $do$;

-- ── permisos de tabla ───────────────────────────────────────
-- La policy dice QUÉ FILAS podés tocar; esto dice si podés tocar la
-- tabla. Hacen falta las dos. Supabase suele dar estos grants solos
-- por default privileges, pero dejarlo explícito es lo que hace que
-- el archivo se pueda probar y no dependa de cómo esté el proyecto.
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Sin sesión no se ve nada. Antes, la clave anónima alcanzaba para
-- leer y borrar todo: esta línea es la que cierra esa puerta.
revoke all on all tables in schema public from anon;

-- Las funciones corren con los permisos de quien llama, así que las
-- policies de arriba también las cubren.
revoke all on function app_estado(), guardar_catalogo(jsonb), guardar_jam(jsonb),
                      borrar_jam(text), cerrar_jam(text, text), abrir_jam(text, text),
                      vaciar_todo(), revision_actual()
  from public, anon;

grant execute on function app_estado(), guardar_catalogo(jsonb), guardar_jam(jsonb),
                          borrar_jam(text), cerrar_jam(text, text), abrir_jam(text, text),
                          vaciar_todo(), revision_actual()
  to authenticated;

-- `miembro` queda afuera a propósito: se administra desde el panel.
