-- ============================================================
-- JAM PORTAL — administrar la lista desde la app
-- ------------------------------------------------------------
-- Hasta acá, dar de alta a alguien requería psql. Eso significa que
-- cuando alguien se registra y no está en `miembro`, se queda afuera
-- hasta que aparezca quien tiene la contraseña de la base.
--
-- Algunos miembros son `admin` y pueden manejar la lista desde
-- Datos → Miembros. Las funciones son `security definer` porque
-- tocan una tabla que nadie puede tocar directo, y cada una
-- comprueba por su cuenta quién la está llamando: el permiso lo
-- decide la función, no el cliente.
--
-- Estar en la lista no crea la cuenta. Cada uno se registra desde la
-- pantalla de entrada; la lista dice quién tiene permitido ver algo.
-- Se puede habilitar un mail antes de que esa persona se registre.
-- ============================================================

alter table miembro add column if not exists admin boolean not null default false;

create or replace function soy_admin() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from miembro m
     where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and m.admin
  )
$fn$;

create or replace function mi_email() returns text
language sql stable as $fn$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$fn$;

-- ── ver la lista ────────────────────────────────────────────
drop function if exists listar_miembros();
create or replace function listar_miembros()
returns table (email text, admin boolean, alta timestamptz, tiene_cuenta boolean, soy_yo boolean)
language plpgsql security definer set search_path = public, auth as $fn$
begin
  if not soy_admin() then
    raise exception 'Solo un admin puede ver la lista de miembros'
      using errcode = 'PT403';
  end if;
  return query
    select m.email, m.admin, m.alta,
           -- Sirve para distinguir "lo habilité pero todavía no se
           -- registró" de "ya entró": son dos estados muy distintos y
           -- desde afuera se ven igual.
           exists (select 1 from auth.users u where lower(u.email) = lower(m.email)),
           lower(m.email) = mi_email()
    from miembro m
    order by m.admin desc, m.alta;
end $fn$;

-- ── alta ────────────────────────────────────────────────────
create or replace function agregar_miembro(p_email text, p_admin boolean default false)
returns text
language plpgsql security definer set search_path = public as $fn$
declare mail text := lower(btrim(p_email));
begin
  if not soy_admin() then
    raise exception 'Solo un admin puede agregar miembros' using errcode = 'PT403';
  end if;
  if mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '«%» no parece un mail', p_email using errcode = 'PT400';
  end if;

  insert into miembro (email, admin) values (mail, coalesce(p_admin, false))
  on conflict (email) do update set admin = excluded.admin;

  return mail;
end $fn$;

-- ── baja ────────────────────────────────────────────────────
create or replace function sacar_miembro(p_email text)
returns text
language plpgsql security definer set search_path = public as $fn$
declare mail text := lower(btrim(p_email));
begin
  if not soy_admin() then
    raise exception 'Solo un admin puede sacar miembros' using errcode = 'PT403';
  end if;
  if mail = mi_email() then
    raise exception 'No te podés sacar a vos mismo' using errcode = 'PT400';
  end if;
  -- Quedarse sin admins deja la lista sin quien la maneje, y volver de
  -- eso requiere entrar por psql. Mejor no permitirlo.
  if (select admin from miembro where email = mail)
     and (select count(*) from miembro where admin) <= 1 then
    raise exception 'Es el único admin: hacé admin a otro antes de sacarlo'
      using errcode = 'PT400';
  end if;

  delete from miembro where email = mail;
  if not found then
    raise exception '% no está en la lista', mail using errcode = 'PT404';
  end if;
  return mail;
end $fn$;

-- ── cambiar rol ─────────────────────────────────────────────
create or replace function set_admin(p_email text, p_admin boolean)
returns text
language plpgsql security definer set search_path = public as $fn$
declare mail text := lower(btrim(p_email));
begin
  if not soy_admin() then
    raise exception 'Solo un admin puede cambiar permisos' using errcode = 'PT403';
  end if;
  if not p_admin and (select count(*) from miembro where admin) <= 1
     and (select admin from miembro where email = mail) then
    raise exception 'Quedaría la lista sin ningún admin' using errcode = 'PT400';
  end if;

  update miembro set admin = p_admin where email = mail;
  if not found then
    raise exception '% no está en la lista', mail using errcode = 'PT404';
  end if;
  return mail;
end $fn$;

-- Las funciones deciden solas si quien llama puede: por eso las puede
-- invocar cualquiera con sesión. La tabla `miembro` sigue sin policy,
-- así que por fuera de estas funciones no se llega.
revoke all on function soy_admin(), listar_miembros(), agregar_miembro(text, boolean),
                       sacar_miembro(text), set_admin(text, boolean), mi_email()
  from public, anon;
grant execute on function soy_admin(), listar_miembros(), agregar_miembro(text, boolean),
                          sacar_miembro(text), set_admin(text, boolean), mi_email()
  to authenticated;
