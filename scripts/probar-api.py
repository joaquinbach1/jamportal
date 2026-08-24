#!/usr/bin/env python3
"""
Prueba la base por HTTP, como la usa el navegador.

Existe porque hay una clase de bug que solo aparece por la API y que
scripts/verificar-migracion.py no puede ver: Supabase carga supautils en
la conexión de PostgREST, con restricciones que por psql no existen. Un
round-trip por SQL le da el visto bueno a código que después falla.

Crea un usuario descartable, corre las pruebas y lo borra. No manda
mails (el usuario se crea directo en la base) para no gastar el cupo,
que es chico.

    export JAMPORTAL_CONN='postgresql://postgres.<ref>@...:5432/postgres'
    export JAMPORTAL_URL='https://<ref>.supabase.co'
    export JAMPORTAL_KEY='sb_publishable_...'
    python3 scripts/probar-api.py
"""

import json
import os
import subprocess
import sys
import tempfile

CONN = os.environ.get('JAMPORTAL_CONN')
URL = (os.environ.get('JAMPORTAL_URL') or '').rstrip('/')
KEY = os.environ.get('JAMPORTAL_KEY')
MAIL = 'prueba-api@jamportal.test'
CLAVE = 'descartable-1234'

fallas = []


def psql(sql):
    r = subprocess.run(['psql', CONN, '-tAX', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr.strip()[:400], file=sys.stderr)
        sys.exit(1)
    return r.stdout.strip()


def pedir(ruta, cuerpo, token=None):
    """
    POST a la API. Devuelve (status, json); no levanta en 4xx.

    Va por curl y no por urllib a propósito: algunos Python de macOS no
    traen los certificados y fallan el TLS contra Supabase.
    """
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(cuerpo, f)
        entrada = f.name
    cmd = ['curl', '-s', '-o', entrada + '.out', '-w', '%{http_code}',
           '-X', 'POST', URL + ruta,
           '-H', 'apikey: ' + KEY, '-H', 'Content-Type: application/json',
           '--data-binary', '@' + entrada]
    if token:
        cmd += ['-H', 'Authorization: Bearer ' + token]
    r = subprocess.run(cmd, capture_output=True, text=True)
    estado = int(r.stdout.strip() or 0)
    try:
        with open(entrada + '.out') as f:
            texto = f.read()
        return estado, (json.loads(texto) if texto.strip() else None)
    except json.JSONDecodeError:
        return estado, texto
    finally:
        for p in (entrada, entrada + '.out'):
            try:
                os.unlink(p)
            except OSError:
                pass


def check(ok, titulo, detalle=''):
    print(f"  {'✓' if ok else '✗'} {titulo}{'  ' + detalle if detalle else ''}")
    if not ok:
        fallas.append(titulo)


def crear_usuario():
    psql(f"""
    do $$
    declare uid uuid := gen_random_uuid();
    begin
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        is_sso_user, is_anonymous, confirmation_token, recovery_token, email_change,
        email_change_token_new, email_change_token_current, phone_change,
        phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        '{MAIL}', crypt('{CLAVE}', gen_salt('bf')), now(), now(), now(),
        '{{"provider":"email","providers":["email"]}}'::jsonb, '{{}}'::jsonb,
        false, false, '', '', '', '', '', '', '', ''
      );
      insert into auth.identities (provider_id, user_id, identity_data, provider,
                                   created_at, updated_at)
      values (uid::text, uid,
              format('{{"sub":"%s","email":"{MAIL}","email_verified":true}}', uid)::jsonb,
              'email', now(), now());
    end $$;""")
    psql(f"insert into miembro (email) values ('{MAIL}') on conflict do nothing")


def borrar_usuario():
    psql(f"""
      delete from miembro where email = '{MAIL}';
      delete from auth.identities where user_id in (select id from auth.users where email = '{MAIL}');
      delete from auth.sessions where user_id in (select id from auth.users where email = '{MAIL}');
      delete from auth.refresh_tokens where user_id in (select id::text from auth.users where email = '{MAIL}');
      delete from auth.users where email = '{MAIL}';""")


def main():
    if not (CONN and URL and KEY):
        print('Faltan JAMPORTAL_CONN, JAMPORTAL_URL o JAMPORTAL_KEY', file=sys.stderr)
        sys.exit(2)

    print(f'\nProyecto: {URL}')
    crear_usuario()
    try:
        st, tok = pedir('/auth/v1/token?grant_type=password',
                        {'email': MAIL, 'password': CLAVE})
        if st != 200:
            print(f'No pude entrar: {tok}', file=sys.stderr)
            sys.exit(1)
        jwt = tok['access_token']

        print('\n── leer ────────────────────────────────────────────────')
        st, estado = pedir('/rest/v1/rpc/app_estado', {}, jwt)
        check(st == 200, 'app_estado responde', f'HTTP {st}')
        check(len(estado.get('songs', [])) > 0,
              'devuelve el repertorio', f"{len(estado['songs'])} temas")

        print('\n── escribir el catálogo ────────────────────────────────')
        cat = {k: estado[k] for k in ('version', 'songs', 'cantantes', 'musicos',
                                      'categorias', 'porConfirmar')}
        original = None
        for s in cat['songs']:
            if s['id'] == estado['songs'][0]['id']:
                original, s['titulo'] = s['titulo'], s['titulo'] + ' ~prueba~'
        st, _ = pedir('/rest/v1/rpc/guardar_catalogo', {'c': cat}, jwt)
        check(st == 200, 'guardar_catalogo acepta un cambio de título', f'HTTP {st}')

        st, rele = pedir('/rest/v1/rpc/app_estado', {}, jwt)
        check(rele['songs'][0]['titulo'].endswith('~prueba~'), 'el cambio quedó guardado')

        for s in cat['songs']:
            if s['id'] == estado['songs'][0]['id']:
                s['titulo'] = original
        st, _ = pedir('/rest/v1/rpc/guardar_catalogo', {'c': cat}, jwt)
        st, rele = pedir('/rest/v1/rpc/app_estado', {}, jwt)
        check(rele['songs'] == estado['songs'], 'revertir deja todo como estaba')

        print('\n── control de versión ──────────────────────────────────')
        jam = rele['jams'][0]
        v = jam['version']
        st, _ = pedir('/rest/v1/rpc/guardar_jam', {'j': jam, 'version_esperada': v}, jwt)
        check(st == 200, 'guardar con la versión leída funciona', f'HTTP {st}')

        st, err = pedir('/rest/v1/rpc/guardar_jam', {'j': jam, 'version_esperada': v}, jwt)
        check(st == 409, 'guardar con una versión vieja da 409', f'HTTP {st}')
        check(isinstance(err, dict) and 'editabas' in json.dumps(err),
              'el 409 explica qué pasó')

        st, _ = pedir('/rest/v1/rpc/guardar_jam', {'j': jam, 'version_esperada': None}, jwt)
        check(st == 200, 'sin versión, pisa a propósito', f'HTTP {st}')

        print('\n── permisos ────────────────────────────────────────────')
        st, _ = pedir('/rest/v1/rpc/app_estado', {})          # sin token
        check(st in (401, 403), 'sin sesión no se lee', f'HTTP {st}')
        st, _ = pedir('/rest/v1/rpc/vaciar_todo', {})
        check(st in (401, 403), 'sin sesión no se vacía la base', f'HTTP {st}')

        psql(f"delete from miembro where email = '{MAIL}'")
        st, estado2 = pedir('/rest/v1/rpc/app_estado', {}, jwt)
        check(st == 200 and not estado2.get('songs'),
              'fuera de la lista de miembros no se ve nada',
              f"HTTP {st}, {len(estado2.get('songs') or [])} temas")
    finally:
        borrar_usuario()

    print()
    if fallas:
        print(f'✗ {len(fallas)} fallaron:')
        for f in fallas:
            print(f'    {f}')
        sys.exit(1)
    print('✓ la API hace lo que dice\n')


if __name__ == '__main__':
    main()
