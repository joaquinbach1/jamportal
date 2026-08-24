-- ============================================================
-- JAM PORTAL — dar de alta gente con contraseña
-- ------------------------------------------------------------
-- Por qué no hay registro abierto en la app: si cualquiera pudiera
-- registrarse con el mail que quisiera y quedar confirmado, bastaría
-- con saber que `joaco@ejemplo.com` está en `miembro` para crearse una
-- cuenta con ese mail y entrar. Con magic link eso no puede pasar
-- porque hace falta la casilla; con contraseña autoconfirmada, sí.
--
-- Así que las altas las hace quien tiene acceso a la base, de una sola
-- vez, y después cada uno se cambia la clave desde la app.
--
--     select crear_miembro('quien@sea.com', 'una-clave-larga');
--     select poner_clave('quien@sea.com', 'otra-clave');
--     delete from miembro where email = 'quien@sea.com';
--
-- Estas funciones escriben en el esquema `auth`, que normalmente
-- maneja solo Supabase. Es el camino que queda cuando no se tiene la
-- clave de servicio: se replica lo que hace la API de admin, incluidas
-- las columnas de token, que GoTrue lee como texto y no tolera en null.
-- ============================================================

create or replace function crear_miembro(p_email text, p_clave text)
returns text
language plpgsql security definer set search_path = auth, public, extensions as $fn$
declare uid uuid;
        mail text := lower(btrim(p_email));
begin
  if mail = '' or mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Mail inválido: %', p_email;
  end if;
  if length(coalesce(p_clave, '')) < 8 then
    raise exception 'La clave tiene que tener al menos 8 caracteres';
  end if;

  select id into uid from auth.users where lower(email) = mail;

  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous,
      -- GoTrue lee estas columnas como texto: en null revienta con
      -- "Database error querying schema" al intentar entrar.
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      mail, crypt(p_clave, gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, false, '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider,
                                 created_at, updated_at)
    values (uid::text, uid,
            jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true),
            'email', now(), now());
  else
    update auth.users
       set encrypted_password = crypt(p_clave, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = uid;
  end if;

  insert into miembro (email) values (mail) on conflict (email) do nothing;
  return mail || ' listo — que se cambie la clave al entrar';
end $fn$;

create or replace function poner_clave(p_email text, p_clave text)
returns text
language plpgsql security definer set search_path = auth, public, extensions as $fn$
begin
  if length(coalesce(p_clave, '')) < 8 then
    raise exception 'La clave tiene que tener al menos 8 caracteres';
  end if;
  update auth.users
     set encrypted_password = crypt(p_clave, gen_salt('bf')), updated_at = now()
   where lower(email) = lower(btrim(p_email));
  if not found then
    raise exception 'No existe ninguna cuenta con %', p_email;
  end if;
  return 'clave cambiada';
end $fn$;

-- Nadie las llama desde la app: son para quien tiene acceso a la base.
-- Que un miembro pudiera crear cuentas con el mail de otro sería darle
-- una llave que no necesita.
revoke all on function crear_miembro(text, text) from public, anon, authenticated;
revoke all on function poner_clave(text, text)   from public, anon, authenticated;
