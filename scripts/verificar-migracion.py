#!/usr/bin/env python3
"""
Levanta la base entera en un Postgres local y comprueba que lo que
devuelve app_estado() es lo mismo que la app tenía en data/seed.json.

    createdb jamportal_test
    python3 scripts/verificar-migracion.py

Hace tres cosas:

  1. Corre db/*.sql de cero sobre una base limpia.
  2. Compara app_estado() contra el seed, campo por campo. Las únicas
     diferencias que acepta son las que la migración corrige a propósito.
  3. Round-trip: lee el estado, lo vuelve a guardar con guardar_catalogo
     y guardar_jam, y lo lee de nuevo. Tiene que dar idéntico — es lo que
     prueba que el camino de escritura no pierde ni inventa nada.

Sale con código 1 si algo no cierra, así que sirve en CI.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BASE = 'jamportal_test'

# 00-local.sql imita el esquema `auth` de Supabase para poder probar
# los permisos acá; en Supabase ese archivo no se corre.
ARCHIVOS = ['00-local.sql', '01-esquema.sql', '02-vistas.sql', '03-app-estado.sql',
            '04-escritura.sql', '05-permisos.sql', '06-concurrencia.sql',
            '10-datos.sql', '11-miembros.sql']

fallas = []


def sin_where():
    """
    Busca DELETE y UPDATE sin WHERE en los .sql.

    Existe por un bug que este script no puede reproducir de otra forma:
    por la API, estas funciones corren en la conexión de PostgREST, donde
    supautils rechaza los DELETE sin WHERE con "DELETE requires a WHERE
    clause". Por psql pasan sin chistar, así que un round-trip por SQL
    —como el del paso 3— les da el visto bueno igual.
    """
    malos = []
    for f in sorted((RAIZ / 'db').glob('*.sql')):
        if f.name == '10-datos.sql':
            continue                      # generado, son solo inserts
        limpio = re.sub(r'--[^\n]*', '', f.read_text())
        for sent in limpio.split(';'):
            plano = ' '.join(sent.split()).lower()
            if not plano.startswith(('delete from', 'update ')):
                continue
            if ' where ' not in plano:
                malos.append(f'{f.name}: {plano[:60]}')
    return malos


def sql_lit(t):
    return "'" + str(t).replace("'", "''") + "'"


def como(rol, email, sql):
    """Corre una consulta haciéndose pasar por alguien. Devuelve la
    primera línea de salida, sea un resultado o un error."""
    claims = json.dumps({'email': email}) if email else '{}'
    r = subprocess.run(
        ['psql', '-d', BASE, '-tAX', '-c',
         f"begin; set local role {rol}; "
         f"set local request.jwt.claims = '{claims}'; {sql}; rollback;"],
        capture_output=True, text=True)
    salida = [l for l in (r.stdout + r.stderr).splitlines()
              if l.strip() and not l.startswith(('BEGIN', 'SET', 'ROLLBACK', 'INSERT'))]
    return salida[0] if salida else ''


def psql(args, entrada=None):
    r = subprocess.run(['psql', '-d', BASE, '-v', 'ON_ERROR_STOP=1', '-q'] + args,
                       capture_output=True, text=True, input=entrada)
    if r.returncode != 0:
        print(r.stderr.strip()[:800], file=sys.stderr)
        sys.exit(1)
    return r.stdout


def estado():
    return json.loads(psql(['-tAc', 'select app_estado()']))


def check(ok, titulo, detalle=''):
    print(f"  {'✓' if ok else '✗'} {titulo}{'  ' + detalle if detalle else ''}")
    if not ok:
        fallas.append(titulo)


def main():
    print(f'\nBase de prueba: {BASE}')
    subprocess.run(['dropdb', '--if-exists', BASE], capture_output=True)
    subprocess.run(['createdb', BASE], check=True, capture_output=True)

    print('\n── 1. cargar el esquema ────────────────────────────────')
    for f in ARCHIVOS:
        psql(['-f', str(RAIZ / 'db' / f)])
        print(f'  ✓ db/{f}')

    seed = json.loads((RAIZ / 'data' / 'seed.json').read_text())
    est = estado()

    print('\n── 2. app_estado() contra seed.json ────────────────────')
    check(est['categorias'] == seed['categorias'], 'categorías idénticas')
    check(est['porConfirmar'] == seed['porConfirmar'], 'porConfirmar idéntico')

    S = {s['id']: s for s in seed['songs']}
    E = {s['id']: s for s in est['songs']}
    check(set(S) == set(E), 'los 374 temas del repertorio están',
          f'{len(E)} temas')

    # Los invitados con dos nombres en un mismo renglón ("🥁 Fabo, Fede")
    # se parten en dos filas: es la corrección que vuelve derivable el
    # contador de temas de los músicos.
    dif = {}
    for i in set(S) & set(E):
        for k in set(S[i]) | set(E[i]):
            a, b = S[i].get(k), E[i].get(k)
            if isinstance(a, list) and isinstance(b, list) \
               and sorted(map(str, a)) == sorted(map(str, b)):
                continue
            if a == b or (a or '') == (b or ''):
                continue
            dif.setdefault(k, []).append(i)
    check(set(dif) <= {'invitados'}, 'ningún campo de tema cambió sin querer',
          f'difieren: {sorted(dif) or "ninguno"}')
    if 'invitados' in dif:
        print(f'      (invitados repartidos en {len(dif["invitados"])} temas, a propósito)')

    SJ = {j['id']: j for j in seed['jamsHistoricas']}
    EJ = {j['id']: j for j in est['jams']}
    check(set(SJ) == set(EJ), 'las 26 jams históricas están')

    iguales = distintos = 0
    for i in set(SJ) & set(EJ):
        ia, ib = SJ[i].get('items') or [], EJ[i].get('items') or []
        if len(ia) != len(ib):
            distintos += max(len(ia), len(ib))
            continue

        def nz(it):
            return {**it, 'cantantes': sorted(it.get('cantantes') or []),
                    'songs': [{**m, 'cantantes': sorted(m.get('cantantes') or [])}
                              for m in it.get('songs') or []]}
        for x, y in zip(ia, ib):
            if nz(x) == nz(y):
                iguales += 1
            else:
                distintos += 1
    check(distintos == 0, 'los setlists son idénticos',
          f'{iguales} ítems, {distintos} distintos')

    # jam.musicos: la base la deriva del setlist, como hace jam-editor.js.
    # El seed la traía del documento original y estaba incompleta.
    faltantes = sum(1 for i in set(SJ) & set(EJ)
                    if set(SJ[i].get('musicos') or []) - set(EJ[i].get('musicos') or []))
    completadas = sum(1 for i in set(SJ) & set(EJ)
                      if set(EJ[i].get('musicos') or []) - set(SJ[i].get('musicos') or []))
    check(faltantes == 0, 'no se perdió ningún músico de ninguna jam')
    print(f'      (la base completa la lista en {completadas} jams que el seed tenía corta)')

    print('\n── 3. round-trip: leer → escribir → leer ───────────────')
    antes = estado()
    psql(['-c', '''
      do $$
      declare e jsonb; st jsonb;
      begin
        st := app_estado();
        perform guardar_catalogo(st);
        for e in select * from jsonb_array_elements(st->'jams') loop
          perform guardar_jam(e);
        end loop;
      end $$;'''])
    despues = estado()
    for k in ['categorias', 'songs', 'cantantes', 'musicos', 'porConfirmar']:
        check(antes[k] == despues[k], f'{k} sobrevive el viaje de ida y vuelta')

    # Las jams se comparan sin `version`, que sube a propósito en cada
    # guardado: que suba es justamente lo que se verifica aparte.
    def sin_version(js):
        return [{k: v for k, v in j.items() if k != 'version'} for j in js]
    check(sin_version(antes['jams']) == sin_version(despues['jams']),
          'jams sobrevive el viaje de ida y vuelta')

    va = {j['id']: j.get('version') for j in antes['jams']}
    vd = {j['id']: j.get('version') for j in despues['jams']}
    subieron = sum(1 for i in va if vd.get(i) == va[i] + 1)
    check(subieron == len(va), 'la versión de cada jam subió exactamente 1',
          f'{subieron}/{len(va)}')

    print('\n── 4. integridad ───────────────────────────────────────')
    for titulo, sql in [
        ('ningún ítem apunta a un tema que no existe',
         "select count(*) from setlist_item i where i.song_id is not null "
         "and not exists (select 1 from song s where s.id = i.song_id)"),
        ('ninguna franja contradice su bpm',
         "select count(*) from song where bpm is not null and franja is null"),
        ('ningún hijo de medley cuelga de algo que no es un medley',
         "select count(*) from setlist_item h join setlist_item p on p.id = h.parent_id "
         "where p.tipo <> 'medley'"),
        ('ninguna persona duplicada por nombre',
         "select count(*) from (select nombre_norm from persona "
         "group by 1 having count(*) > 1) t"),
    ]:
        n = int(psql(['-tAc', sql]).strip())
        check(n == 0, titulo, f'{n} casos' if n else '')

    print('\n── 5. control de versión ───────────────────────────────')
    jam0 = estado()['jams'][0]
    jid, v = jam0['id'], jam0['version']

    # con la versión que acabo de leer: pasa
    r = psql(['-tAc', f"select guardar_jam("
                      f"(select e from jsonb_array_elements(app_estado()->'jams') e "
                      f"where e->>'id' = {sql_lit(jid)}), {v}) > 0"])
    check('t' in r, 'guardar con la versión que leíste funciona')

    # con la vieja: la base lo rechaza en vez de pisar al otro
    r = subprocess.run(
        ['psql', '-d', BASE, '-tAc',
         f"select guardar_jam("
         f"(select e from jsonb_array_elements(app_estado()->'jams') e "
         f"where e->>'id' = {sql_lit(jid)}), {v})"],
        capture_output=True, text=True)
    salida = (r.stdout + r.stderr)
    check('cambió mientras la editabas' in salida,
          'guardar con una versión vieja se rechaza',
          '' if 'cambió mientras' in salida else salida.strip()[:60])
    check('PT409' in salida or r.returncode != 0,
          'el rechazo llega como conflicto, no como éxito silencioso')

    print('\n── 6. lo que solo se rompe por la API ──────────────────')
    malos = sin_where()
    check(not malos, 'ningún DELETE ni UPDATE sin WHERE',
          f'{len(malos)} casos' if malos else '')
    for m in malos:
        print(f'      {m}')

    print('\n── 7. permisos ─────────────────────────────────────────')
    miembro = 'matiasw@gmail.com'
    casos = [
        ('un miembro lee el repertorio',
         ('authenticated', miembro, 'select count(*) from song'), '551'),
        ('un miembro puede escribir',
         ('authenticated', miembro,
          "insert into pendiente (texto) values ('x') returning 'ok'"), 'ok'),
        ('el mail no distingue mayúsculas',
         ('authenticated', miembro.upper(), 'select count(*) from song'), '551'),
        ('un logueado que no es miembro no ve nada',
         ('authenticated', 'random@ejemplo.com', 'select count(*) from song'), '0'),
        ('...y tampoco puede escribir',
         ('authenticated', 'random@ejemplo.com',
          "insert into pendiente (texto) values ('x')"), 'violates row-level security'),
        ('sin sesión no se lee nada',
         ('anon', None, 'select count(*) from song'), 'permission denied'),
        ('sin sesión no se llama a app_estado()',
         ('anon', None, 'select app_estado()'), 'permission denied'),
        ('sin sesión no se puede vaciar la base',
         ('anon', None, 'select vaciar_todo()'), 'permission denied'),
        ('la lista de miembros no se puede espiar',
         ('authenticated', miembro, 'select count(*) from miembro'), '0'),
    ]
    for titulo, (rol, email, sql), esperado in casos:
        got = como(rol, email, sql)
        check(esperado in got, titulo, '' if esperado in got else f'dio: {got[:60]}')

    print()
    if fallas:
        print(f'✗ {len(fallas)} comprobaciones fallaron:')
        for f in fallas:
            print(f'    {f}')
        sys.exit(1)
    print('✓ todo cierra\n')


if __name__ == '__main__':
    main()
