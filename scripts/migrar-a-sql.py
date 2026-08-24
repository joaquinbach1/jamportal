#!/usr/bin/env python3
"""
Convierte data/seed.json + data/descartados.json (y, si se le pasa, un
export JSON de la app) en db/10-datos.sql.

Se corre una sola vez, para sembrar la base. Después de eso la fuente
de verdad es Postgres y este script queda como documentación de cómo
se hizo la conversión.

    python3 scripts/migrar-a-sql.py                 # desde el seed
    python3 scripts/migrar-a-sql.py respaldo.json   # desde un export

Es estricto a propósito: si un nombre no resuelve a una persona o un
songId no existe, aborta en vez de escribir una base incompleta.
"""

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'db' / '10-datos.sql'

# Los emoji con los que el documento original marcaba el instrumento
# de un invitado: "🥁 Fabo" es Fabo en batería, "🎷" solo es un saxo.
RE_EMOJI = re.compile(
    r'^[\s‍️]*((?:[\U0001F000-\U0001FAFF☀-➿][\s‍️]*)+)')


def norm(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9\s]', ' ', s.lower())).strip()


# ---------- emisión de SQL ----------
def q(v):
    """Un literal SQL a partir de un valor de Python."""
    if v is None or v == '':
        return 'null' if v is None else "''"
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(vs):
    if not vs:
        return "'{}'"
    return 'array[' + ', '.join(q(str(v)) for v in vs) + ']::text[]'


class Salida:
    def __init__(self):
        self.p = []

    def w(self, s=''):
        self.p.append(s)

    def insert(self, tabla, cols, filas):
        if not filas:
            self.w(f'-- {tabla}: sin filas')
            self.w()
            return
        self.w(f'-- {tabla}: {len(filas)} filas')
        self.w(f'insert into {tabla} ({", ".join(cols)}) values')
        self.w(',\n'.join('  (' + ', '.join(f) + ')' for f in filas) + ';')
        self.w()


def morir(msg, ejemplos=()):
    print(f'\n✗ {msg}', file=sys.stderr)
    for e in list(ejemplos)[:10]:
        print(f'    {e}', file=sys.stderr)
    sys.exit(1)


def main():
    fuente = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / 'data' / 'seed.json'
    d = json.loads(fuente.read_text())
    jams_src = d.get('jams') or d.get('jamsHistoricas') or []

    descartados = []
    f_desc = RAIZ / 'data' / 'descartados.json'
    if len(sys.argv) == 1 and f_desc.exists():
        descartados = json.loads(f_desc.read_text()).get('songs', [])

    out = Salida()
    out.w('-- ============================================================')
    out.w(f'-- Generado por scripts/migrar-a-sql.py desde {fuente.name}')
    out.w('-- No editar a mano: correr el script de nuevo.')
    out.w('-- ============================================================')
    out.w()
    out.w('begin;')
    out.w()

    # ---------- categorías ----------
    cats = d.get('categorias') or []
    cat_id = {c: i + 1 for i, c in enumerate(cats)}
    out.insert('categoria', ['id', 'nombre', 'orden'],
               [[q(i + 1), q(c), q(i + 1)] for i, c in enumerate(cats)])

    # ---------- personas ----------
    # El seed arma dos listas independientes, así que 7 personas figuran
    # dos veces: como cantante y como músico invitado. Son la misma gente
    # (Ale canta 27 temas y además toca el bajo). Se fusionan en una sola
    # fila, que es justamente lo que el índice único de nombre exige.
    # Gana el id del cantante: los setlists lo referencian, y a los músicos
    # el seed los referencia por nombre, nunca por id.
    personas = []
    por_norm = {}
    fusionadas = []
    for p, rol in [(p, 'voz') for p in d.get('cantantes', [])] + \
                  [(p, 'instrumento') for p in d.get('musicos', [])]:
        n = norm(p['nombre'])
        previa = por_norm.get(n)
        if previa:
            previa['instrumentos'] = sorted(
                set(previa.get('instrumentos') or []) | set(p.get('instrumentos') or []))
            for campo in ('telefono', 'email', 'contacto', 'notas'):
                previa[campo] = previa.get(campo) or p.get(campo) or ''
            fusionadas.append(f"{p['nombre']}: {p['id']} → {previa['id']}")
            continue
        reg = dict(p, rol=p.get('rol') or rol)
        por_norm[n] = reg
        personas.append(reg)

    # Nombres usados en temas y setlists que no son una persona real.
    usados = Counter()
    for s in d.get('songs', []):
        for c in s.get('cantantes') or []:
            usados[c] += 1
    for j in jams_src:
        for it in j.get('items') or []:
            for c in it.get('cantantes') or []:
                usados[c] += 1
            for ms in it.get('songs') or []:
                for c in ms.get('cantantes') or []:
                    usados[c] += 1

    especiales = {'todos'}
    faltan = sorted({c for c in usados if norm(c) not in por_norm})
    inventadas = []
    for nombre in faltan:
        if norm(nombre) not in especiales:
            morir(f'"{nombre}" canta temas pero no está en cantantes ni músicos',
                  [f'aparece {usados[nombre]} veces'])
        reg = {'id': norm(nombre).replace(' ', '-'), 'nombre': nombre,
               'rol': 'voz', 'activo': False, 'especial': True}
        por_norm[norm(nombre)] = reg
        personas.append(reg)
        inventadas.append(nombre)

    def pid(nombre):
        p = por_norm.get(norm(nombre))
        return p['id'] if p else None

    out.insert('persona',
               ['id', 'nombre', 'rol', 'activo', 'especial', 'instrumentos',
                'telefono', 'email', 'contacto', 'notas'],
               [[q(p['id']), q(p['nombre']), q(p['rol']),
                 q(p.get('activo', True)), q(p.get('especial', False)),
                 arr(p.get('instrumentos') or []),
                 q(p.get('telefono') or ''), q(p.get('email') or ''),
                 q(p.get('contacto') or ''), q(p.get('notas') or '')]
                for p in personas])

    # ---------- temas ----------
    todos_temas = [(s, 'idea' if s.get('esIdea') else 'repertorio')
                   for s in d.get('songs', [])]
    vistos = {s['id'] for s, _ in todos_temas}
    for s in descartados:
        if s['id'] in vistos:
            continue          # ya volvió al repertorio: gana el seed
        todos_temas.append((s, 'descartado'))
        vistos.add(s['id'])

    sin_cat = sorted({s['categoria'] for s, _ in todos_temas
                      if s.get('categoria') not in cat_id})
    if sin_cat:
        morir('categorías que no están en la lista', sin_cat)

    filas, f_cant, f_inv = [], [], []
    for s, estado in todos_temas:
        filas.append([
            q(s['id']), q(s['titulo']), q(s['artista']),
            q(cat_id[s['categoria']]), q(estado),
            q(s.get('bpm')), q(s.get('bpmRaw') or ''), q(s.get('bpmFuente') or ''),
            q(s.get('anio') or None), q(s.get('notas') or ''),
            q(s.get('origen') or 'manual'), q(s.get('generoWeb') or ''),
            q(s.get('cifraUrl') or ''), q(s.get('cifraArtista') or ''),
            q(s.get('cifraConfianza') or ''), arr(s.get('patches') or []),
        ])
        for i, c in enumerate(dict.fromkeys(s.get('cantantes') or [])):
            f_cant.append([q(s['id']), q(pid(c)), q(i)])
        # Un contador corrido, no i*10+k: "🥁 Fabo, Fede" genera dos filas
        # y correría el índice del invitado siguiente.
        orden_inv = 0
        for crudo in s.get('invitados') or []:
            m = RE_EMOJI.match(crudo)
            instr = (m.group(1).strip() if m else '')
            resto = crudo[m.end():] if m else crudo
            nombres = [x.strip() for x in resto.split(',') if x.strip()]
            if not nombres:
                f_inv.append([q(s['id']), q(orden_inv), 'null', q(instr or crudo.strip())])
                orden_inv += 1
                continue
            for nom in nombres:
                p = pid(nom)
                if p:
                    f_inv.append([q(s['id']), q(orden_inv), q(p), q(instr)])
                else:
                    # No es una persona conocida: se conserva el texto entero
                    # para no perder información del documento original.
                    f_inv.append([q(s['id']), q(orden_inv), 'null',
                                  q((instr + ' ' + nom).strip())])
                orden_inv += 1

    out.insert('song',
               ['id', 'titulo', 'artista', 'categoria_id', 'estado', 'bpm',
                'bpm_raw', 'bpm_fuente', 'anio', 'notas', 'origen', 'genero_web',
                'cifra_url', 'cifra_artista', 'cifra_confianza', 'patches'], filas)
    out.insert('song_cantante', ['song_id', 'persona_id', 'orden'], f_cant)
    out.insert('song_invitado', ['song_id', 'orden', 'persona_id', 'instrumento'], f_inv)

    # ---------- jams ----------
    ids_song = vistos
    huerfanos = set()
    for j in jams_src:
        for it in j.get('items') or []:
            if it.get('songId') and it['songId'] not in ids_song:
                huerfanos.add(it['songId'])
            for ms in it.get('songs') or []:
                if ms.get('songId') not in ids_song:
                    huerfanos.add(ms['songId'])
    if huerfanos:
        morir(f'{len(huerfanos)} songId en setlists que no existen', sorted(huerfanos))

    nombres_jam = Counter(norm(j['nombre']) for j in jams_src)
    repes = [n for n, c in nombres_jam.items() if c > 1]
    if repes:
        morir('jams con el mismo nombre: el historial de temas usa el nombre '
              'como clave y quedaría corrupto', repes)

    f_jam, f_item, f_ic, f_extra, f_ens, f_conv = [], [], [], [], [], []
    total = len(jams_src)

    for idx, j in enumerate(jams_src):
        # El seed viene ordenado de la jam más nueva a la más vieja y no trae
        # fecha: se sintetiza `creada` para que ese orden sobreviva.
        creada = j.get('creada') or f'2020-01-01T00:00:00Z'
        orden_creada = (f"timestamptz '2020-01-01' + interval '1 day' * {total - idx}"
                        if not j.get('creada') else q(creada))
        f_jam.append([
            q(j['id']), q(j['nombre']), q(j.get('fecha') or None),
            q(j.get('hora') or None), q(j.get('lugar') or ''),
            q(j.get('notas') or ''), q(bool(j.get('historica'))),
            q(j.get('conOrden', True)), q(bool(j.get('cerrada'))),
            q(j.get('vivoIndice') or 0), q(j.get('mes')), q(j.get('dia')),
            orden_creada,
        ])

        del_setlist = set()
        for orden, it in enumerate(j.get('items') or []):
            tipo = it.get('tipo')
            item_id = f"'{j['id']}-{orden}'"
            uuid_expr = f'md5({item_id})::uuid'
            f_item.append([
                uuid_expr, q(j['id']), 'null', q(orden), q(tipo),
                q(it.get('songId')), q(it.get('titulo')), q(it.get('label')),
                q(it.get('minutos')), q(it.get('notas') or ''),
            ])
            for k, c in enumerate(dict.fromkeys(it.get('cantantes') or [])):
                f_ic.append([uuid_expr, q(pid(c)), q(k)])
                del_setlist.add(norm(c))
            for sub, ms in enumerate(it.get('songs') or []):
                hijo = f"'{j['id']}-{orden}-{sub}'"
                hijo_expr = f'md5({hijo})::uuid'
                f_item.append([
                    hijo_expr, q(j['id']), uuid_expr, q(sub), q('song'),
                    q(ms.get('songId')), 'null', 'null', 'null',
                    q(ms.get('notas') or ''),
                ])
                for k, c in enumerate(dict.fromkeys(ms.get('cantantes') or [])):
                    f_ic.append([hijo_expr, q(pid(c)), q(k)])
                    del_setlist.add(norm(c))

        # jam.musicos que no salen del setlist: se guardan aparte.
        # Solo se descuenta a quienes cantaron, que es lo que la vista
        # jam_musico deriva. Los invitados no entran acá.
        for nombre in j.get('musicos') or []:
            if norm(nombre) in del_setlist:
                continue
            p = pid(nombre)
            if not p:
                morir(f'músico "{nombre}" de {j["nombre"]} no existe como persona')
            f_extra.append([q(j['id']), q(p)])

        for e_i, e in enumerate(j.get('ensayos') or []):
            eid = f'md5({q(j["id"] + "-ens-" + str(e_i))})::uuid'
            f_ens.append([eid, q(j['id']), q(e.get('fecha') or None),
                          q(e.get('hora') or None), q(e.get('horaFin') or None),
                          q(e.get('lugar') or ''), q(e.get('notas') or ''), q(e_i)])
            for c_i, c in enumerate(e.get('convocados') or []):
                p = pid(c.get('nombre', ''))
                if not p:
                    morir(f'convocado "{c.get("nombre")}" no existe como persona')
                f_conv.append([eid, q(p), q(c.get('hora') or None),
                               q(c.get('instrumento') or ''),
                               q(c.get('aviso') or None), q(c_i)])

    out.insert('jam',
               ['id', 'nombre', 'fecha', 'hora', 'lugar', 'notas', 'historica',
                'con_orden', 'cerrada', 'vivo_indice', 'mes', 'dia', 'creada'], f_jam)
    out.w('-- Los ids de ítem son md5 del par (jam, posición): así el script')
    out.w('-- se puede correr de nuevo y da exactamente la misma base.')
    out.insert('setlist_item',
               ['id', 'jam_id', 'parent_id', 'orden', 'tipo', 'song_id',
                'titulo', 'label', 'minutos', 'notas'], f_item)
    out.insert('item_cantante', ['item_id', 'persona_id', 'orden'], f_ic)
    out.insert('jam_musico_extra', ['jam_id', 'persona_id'], f_extra)
    out.insert('ensayo',
               ['id', 'jam_id', 'fecha', 'hora', 'hora_fin', 'lugar', 'notas', 'orden'], f_ens)
    out.insert('convocado',
               ['ensayo_id', 'persona_id', 'hora', 'instrumento', 'aviso', 'orden'], f_conv)

    out.insert('pendiente', ['texto', 'orden'],
               [[q(t), q(i)] for i, t in enumerate(d.get('porConfirmar') or [])])

    out.w('commit;')
    out.w()

    SALIDA.write_text('\n'.join(out.p))

    print(f'✓ {SALIDA.relative_to(RAIZ)}')
    print(f'  {len(cats)} categorías · {len(personas)} personas '
          f'({len(inventadas)} especiales) · {len(filas)} temas')
    print(f'  {len(f_cant)} cantantes de tema · {len(f_inv)} invitados')
    print(f'  {len(f_jam)} jams · {len(f_item)} ítems · {len(f_ic)} cantantes de ítem')
    print(f'  {len(f_extra)} músicos sueltos · {len(f_ens)} ensayos · {len(f_conv)} convocados')
    if inventadas:
        print(f'  personas especiales creadas: {", ".join(inventadas)}')
    if fusionadas:
        print(f'  {len(fusionadas)} personas duplicadas fusionadas:')
        for f in fusionadas:
            print(f'    {f}')


if __name__ == '__main__':
    main()
