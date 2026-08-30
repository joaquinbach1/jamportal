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


def sql_lit(t):
    return "'" + str(t).replace("'", "''") + "'"


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

        # Duración y link de Spotify: los dos son campos que la app manda y
        # espera de vuelta enteros. Si guardar_catalogo se olvida de uno, la
        # app no rompe —sigue andando con el promedio de 4 minutos— y la
        # pérdida solo se nota semanas después, cuando el horario estimado
        # de la jam ya no le cierra a nadie.
        sid = estado['songs'][0]['id']
        antes = {k: estado['songs'][0].get(k) for k in ('duracionSec', 'spotifyUrl')}
        for s in cat['songs']:
            if s['id'] == sid:
                s['duracionSec'], s['spotifyUrl'] = 247, 'https://open.spotify.com/track/prueba'
        st, _ = pedir('/rest/v1/rpc/guardar_catalogo', {'c': cat}, jwt)
        check(st == 200, 'guardar_catalogo acepta duración y Spotify', f'HTTP {st}')
        st, rele = pedir('/rest/v1/rpc/app_estado', {}, jwt)
        vuelta = next(x for x in rele['songs'] if x['id'] == sid)
        check(vuelta.get('duracionSec') == 247, 'la duración vuelve igual',
              f"volvió {vuelta.get('duracionSec')!r}")
        check(vuelta.get('spotifyUrl') == 'https://open.spotify.com/track/prueba',
              'el link de Spotify vuelve igual', f"volvió {vuelta.get('spotifyUrl')!r}")

        for s in cat['songs']:
            if s['id'] == sid:
                s['duracionSec'], s['spotifyUrl'] = antes['duracionSec'], antes['spotifyUrl'] or ''
        pedir('/rest/v1/rpc/guardar_catalogo', {'c': cat}, jwt)
        st, rele = pedir('/rest/v1/rpc/app_estado', {}, jwt)
        check(rele['songs'] == estado['songs'], 'y se puede volver atrás')

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

        print('\n── el link público ─────────────────────────────────────')
        # Todo esto va SIN jwt: es exactamente lo que hace el que recibe el
        # link. Que la lógica esté bien en psql no alcanza — lo que decide
        # es qué deja pasar PostgREST con el rol `anon`.
        jid = estado['jams'][0]['id']
        st, tok = pedir('/rest/v1/rpc/crear_token', {'p_jam': jid}, jwt)
        check(st == 200 and isinstance(tok, str) and len(tok) >= 12,
              'un miembro saca el token', f'HTTP {st}, {tok!r}')

        st, sin = pedir('/rest/v1/rpc/crear_token', {'p_jam': jid})
        check(st in (401, 403), 'sin sesión no se puede sacar un token', f'HTTP {st}')

        st, pub = pedir('/rest/v1/rpc/estado_publico', {'t': tok})
        check(st == 200 and pub and len(pub.get('jams') or []) == 1,
              'con el token se lee, sin cuenta', f"HTTP {st}, {len(pub.get('jams') or []) if pub else 0} jams")
        check((pub['jams'][0] or {}).get('id') == jid, 'y es la jam del token')

        # Lo que el link NO tiene que traer. Son datos de gente real, y el
        # link se manda por WhatsApp: si estuvieran acá, se regalan con él.
        gente = (pub.get('cantantes') or []) + (pub.get('musicos') or [])
        check(all(not p.get('telefono') and not p.get('email') for p in gente),
              f'ninguna de las {len(gente)} personas trae teléfono ni mail')
        check(pub['jams'][0].get('ensayos') == [], 'no trae los ensayos')
        check(pub['jams'][0].get('notas') == '', 'no trae las notas de la jam')
        check(pub.get('esAdmin') is False, 'el link nunca es admin')

        st, nada = pedir('/rest/v1/rpc/estado_publico', {'t': 'inventado123'})
        check(st == 200 and nada is None, 'un token inventado no devuelve nada', f'HTTP {st}')

        # Escribir: solo la jam del token, y solo por sus funciones.
        pjam = dict(pub['jams'][0])
        st, _ = pedir('/rest/v1/rpc/guardar_jam_publica',
                      {'t': tok, 'j': pjam, 'version_esperada': pjam['version']})
        check(st == 200, 'con el token se escribe esa jam', f'HTTP {st}')

        otra = next((j for j in estado['jams'] if j['id'] != jid), None)
        if otra:
            st, _ = pedir('/rest/v1/rpc/guardar_jam_publica', {'t': tok, 'j': otra})
            check(st >= 400, 'el token NO abre otra jam', f'HTTP {st}')

        for fn, args in [('guardar_catalogo', {'c': {}}), ('vaciar_todo', {}),
                         ('app_estado', {}), ('borrar_jam', {'jid': jid}),
                         ('guardar_jam', {'j': pjam}), ('restaurar_respaldo', {'p_id': 1}),
                         ('respaldos_de', {'p_jam': jid}), ('quitar_token', {'p_jam': jid})]:
            st, _ = pedir(f'/rest/v1/rpc/{fn}', args)
            check(st in (401, 403, 404), f'anon no puede llamar a {fn}()', f'HTTP {st}')

        # Los respaldos: es lo que hace que un link que edita no dé miedo.
        st, resp = pedir('/rest/v1/rpc/respaldos_de', {'p_jam': jid}, jwt)
        check(st == 200 and isinstance(resp, list) and len(resp) >= 1,
              'el guardado dejó respaldo', f'HTTP {st}, {len(resp or [])}')
        check(any(r.get('quien') == 'link público' for r in resp),
              'y dice que lo tocó el link, no una persona')

        st, _ = pedir('/rest/v1/rpc/quitar_token', {'p_jam': jid}, jwt)
        # 204 y no 200: quitar_token() devuelve void, y PostgREST traduce eso
        # a "sin contenido".
        check(st in (200, 204), 'un miembro corta el link', f'HTTP {st}')
        st, muerto = pedir('/rest/v1/rpc/estado_publico', {'t': tok})
        check(muerto is None, 'y el link cortado deja de servir')

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

        # Que app_estado() venga vacío no alcanza para saber qué pasa: puede
        # ser una base recién creada o alguien fuera de la lista. La app
        # necesita distinguirlas, porque si cree que la base está vacía
        # intenta sembrarla y pisa el repertorio de todos.
        st, rev = pedir('/rest/v1/rpc/revision_actual', {}, jwt)
        check(rev is None, 'un no-miembro lee revision null (así se distingue '
                           'de una base vacía)', f'devolvió {rev}')

        st, err = pedir('/rest/v1/rpc/guardar_catalogo',
                        {'c': {'version': 3, 'songs': [], 'categorias': ['X'],
                               'cantantes': [], 'musicos': [], 'porConfirmar': []}}, jwt)
        check(st == 403, 'un no-miembro no puede sembrar la base', f'HTTP {st}')

        print('\n── administrar la lista ────────────────────────────────')
        psql(f"insert into miembro (email, admin) values ({sql_lit(MAIL)}, false) "
             f"on conflict (email) do update set admin = false")
        st, _ = pedir('/rest/v1/rpc/listar_miembros', {}, jwt)
        check(st == 403, 'un miembro común no ve la lista', f'HTTP {st}')
        st, _ = pedir('/rest/v1/rpc/agregar_miembro', {'p_email': 'colado@ejemplo.com'}, jwt)
        check(st == 403, 'un miembro común no puede agregar', f'HTTP {st}')

        psql(f"update miembro set admin = true where email = {sql_lit(MAIL)}")
        st, filas = pedir('/rest/v1/rpc/listar_miembros', {}, jwt)
        check(st == 200 and isinstance(filas, list) and filas,
              'un admin sí ve la lista', f'HTTP {st}, {len(filas or [])} filas')

        st, _ = pedir('/rest/v1/rpc/agregar_miembro',
                      {'p_email': 'prueba-alta@ejemplo.com'}, jwt)
        check(st == 200, 'un admin agrega', f'HTTP {st}')
        st, filas = pedir('/rest/v1/rpc/listar_miembros', {}, jwt)
        nuevo = next((f for f in filas if f['email'] == 'prueba-alta@ejemplo.com'), None)
        check(nuevo is not None and not nuevo['tiene_cuenta'],
              'aparece marcado como "sin registrarse"')

        st, _ = pedir('/rest/v1/rpc/sacar_miembro',
                      {'p_email': 'prueba-alta@ejemplo.com'}, jwt)
        check(st == 200, 'un admin saca', f'HTTP {st}')

        st, e2 = pedir('/rest/v1/rpc/sacar_miembro', {'p_email': MAIL}, jwt)
        check(st == 400, 'un admin no se puede sacar a sí mismo', f'HTTP {st}')
        st, e3 = pedir('/rest/v1/rpc/agregar_miembro', {'p_email': 'no-es-mail'}, jwt)
        check(st == 400, 'un mail inválido se rechaza', f'HTTP {st}')

        psql("delete from miembro where email = 'prueba-alta@ejemplo.com'")
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
