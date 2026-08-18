"""
Genera data/seed.json a partir de las dos fuentes originales:

  ~/Downloads/jams-canciones.json        → repertorio curado (QUÉ se tocó en cada jam)
  ~/Downloads/JAMs - Lista Canciones.docx → los setlists reales (EN QUÉ ORDEN,
                                            con medleys, breaks y bloques)

De la primera salen los 551 temas, la base de cantantes y la de músicos
invitados. De la segunda sale el orden de cada jam histórica: recorro sus
líneas y las matcheo contra los temas que el JSON le asigna a esa jam, así
las líneas de arreglo ("Verso", "Caños LEMOTIVE") se descartan solas.

Medleys, tal como están escritos en el documento:
  · "Medley X" abre un grupo y lo cierra un renglón en blanco
    (o un BREAK, otro medley, o un bloque nuevo)
  · varios temas separados por "/" en un mismo renglón son un medley

    python3 scripts/convert-seed.py
"""
import json, re, unicodedata, collections, os, zipfile, difflib
import xml.etree.ElementTree as ET

SRC_JSON = os.path.expanduser('~/Downloads/jams-canciones.json')
SRC_DOCX = os.path.expanduser('~/Downloads/JAMs - Lista Canciones.docx')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')

# ============================================================ utilidades
def norm(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = s.replace('’', "'").replace('´', "'").replace('`', "'")
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower() or 'x'

def variantes(titulo):
    """'Loco (Me volvió loco tu forma de ser)' → completo, sin paréntesis y
    el contenido del paréntesis: el documento usa cualquiera de las tres."""
    v = [norm(titulo)]
    sin_par = norm(re.sub(r'\([^)]*\)', ' ', titulo))
    if sin_par and sin_par not in v: v.append(sin_par)
    for dentro in re.findall(r'\(([^)]{4,})\)', titulo):
        d = norm(re.sub(r'^(orig\.?|vers\.?|con|tocan la vers\.?)\s*', '', dentro, flags=re.I))
        if d and d not in v: v.append(d)
    return [x for x in v if len(x) >= 3]

def parcial(aguja, pajar):
    """Similitud del mejor tramo del pajar del largo de la aguja."""
    if not aguja or not pajar: return 0
    if len(aguja) >= len(pajar):
        return difflib.SequenceMatcher(None, aguja, pajar).ratio()
    mejor, paso = 0, max(1, len(aguja) // 6)
    for i in range(0, len(pajar) - len(aguja) + 1, paso):
        r = difflib.SequenceMatcher(None, aguja, pajar[i:i + len(aguja)]).ratio()
        if r > mejor: mejor = r
        if mejor > .97: break
    return mejor

# ============================================================ 1 · repertorio
FRANJA = {'🔵 Low': 'low', '🟢 Mid': 'mid', '🔴 High': 'high'}

def leer_repertorio():
    d = json.load(open(SRC_JSON))
    songs, vistos = [], set()
    for cat, artistas in d['categorias'].items():
        for artista, temas in artistas.items():
            for t in temas:
                sid = f"{slug(artista)}--{slug(t['titulo'])}"
                base, n = sid, 2
                while sid in vistos:
                    sid = f"{base}-{n}"; n += 1
                vistos.add(sid)
                bpm_raw = t.get('bpm') or ''
                m = re.search(r'\d+', bpm_raw)
                songs.append({
                    'id': sid,
                    'titulo': t['titulo'],
                    'artista': artista,
                    'categoria': cat,
                    'bpm': int(m.group()) if m else None,
                    'bpmRaw': bpm_raw if m and bpm_raw != m.group() else '',
                    'franja': FRANJA.get(t.get('tempo', '')),
                    'cantantes': t.get('cantantes', []),
                    'patches': t.get('patches', []),
                    'invitados': t.get('invitados', []),
                    'jams': t.get('jams', []),
                    'notas': '', 'origen': 'import',
                    'cifraUrl': '', 'cifraArtista': '', 'cifraConfianza': '',
                })
    songs.sort(key=lambda s: (s['artista'].lower(), s['titulo'].lower()))
    return songs, list(d['categorias'].keys()), d.get('por_confirmar', [])

def derivar_personas(songs):
    cant = collections.defaultdict(lambda: {'temas': 0, 'categorias': collections.Counter(), 'jams': set()})
    for s in songs:
        for c in s['cantantes']:
            if c.strip().lower() == 'todos': continue
            e = cant[c.strip()]
            e['temas'] += 1
            e['categorias'][s['categoria']] += 1
            e['jams'].update(s['jams'])
    cantantes = [{
        'id': slug(n), 'nombre': n, 'temas': e['temas'], 'jams': len(e['jams']),
        'categorias': [c for c, _ in e['categorias'].most_common(2)],
        'rol': 'voz', 'activo': True, 'telefono': '', 'email': '', 'contacto': '', 'notas': '',
    } for n, e in cant.items()]
    cantantes.sort(key=lambda c: (-c['temas'], c['nombre'].lower()))

    INSTR = {'🥁': 'batería', '🎸': 'guitarra/bajo', '🎷': 'saxo', '🎺': 'caños', '🎻': 'cuerdas'}
    inv = collections.defaultdict(lambda: {'temas': 0, 'instrumentos': set(), 'jams': set()})
    for s in songs:
        for raw in s['invitados']:
            icono = raw[0] if raw and raw[0] in INSTR else None
            nombres = raw[1:].strip()
            for nombre in [x.strip() for x in nombres.split(',') if x.strip()]:
                e = inv[nombre]
                e['temas'] += 1
                if icono: e['instrumentos'].add(INSTR[icono])
                e['jams'].update(s['jams'])
    musicos = [{
        'id': 'inv-' + slug(n), 'nombre': n, 'temas': e['temas'], 'jams': len(e['jams']),
        'instrumentos': sorted(e['instrumentos']), 'rol': 'instrumento',
        'activo': True, 'telefono': '', 'email': '', 'contacto': '', 'notas': '',
    } for n, e in inv.items()]
    musicos.sort(key=lambda m: (-m['temas'], m['nombre'].lower()))
    return cantantes, musicos

# ============================================================ 2 · orden real
# nombre del encabezado en el .docx → nombre de la jam en el JSON
JAM_MAP = {
    'JAM NOSTALIGA 15/8': 'JAM Nostalgia 15/8',
    'JAM 25/7 Bizarra': 'JAM Bizarra 25/7',
    'JAM 6/6 PEACE & LOVE': 'JAM Peace & Love 6/6',
    'JAM 16/5 MAKENA - BSAS': 'JAM Makena BsAs 16/5',
    'JAM 18 Abril 2026 — HEAVEN OR HELL': 'JAM Heaven or Hell 18/4',
    'JAM FEBRERO 25': 'JAM Febrero 25',
    'JAM FEBRERO 11': 'JAM Febrero 11',
    'JAM ENERO 28   .': 'JAM Enero 28',
    'JAM SERENA - ORDEN 1.0': 'JAM Serena',
    'JAM (Diciembre)': 'JAM Diciembre',
    'JAM (Noviembre)': 'JAM Noviembre',
    'JAM (Octubre)': 'JAM Octubre',
    'JAM (Septiembre)': 'JAM Septiembre',
    'AM Nostalgia (Agosto)': 'JAM Nostalgia (Agosto)',
    'JAM de los amigos (Julio)': 'JAM de los amigos (Julio)',
    'JAM Sabado 7/6': 'JAM 7/6',
    'JAM 03/05/25': 'JAM 3/5',
    'JAM 10/3/25': 'JAM 10/3',
    'Jam 7/2': 'JAM 7/2',
    'Jam 29/1 2000': 'JAM 29/1',
    'Jam 22/1 Special': 'JAM 22/1 Special',
    'Jam 15/1 90s': 'JAM 15/1 90s',
    'Jam 8/1': 'JAM 8/1',
    'JAM 22/12': 'JAM 22/12',
    'JAM 30/11': 'JAM 30/11',
    'Jam 6/11': 'JAM 6/11',
}

RE_BREAK   = re.compile(r'\bbreak\b', re.I)
RE_MEDLEY  = re.compile(r'\bmedle?y\b', re.I)
RE_HORA    = re.compile(r"^\s*\d{1,2}[:.]?\d{0,2}\s*(am|pm)?\s*[/\-–]?\s*\d{0,2}\s*(am|pm)?\s*$", re.I)
RE_DECADA  = re.compile(r"^\d{2,4}\s*'?s\b", re.I)
RE_HORATXT = re.compile(r'^\s*\d{1,2}[:.]\d{2}\s*(AM|PM)?\s*(.{2,38})$', re.I)

def es_bloque(linea):
    """'BANDA', 'DISCO 70s', '2000s', 'PIANO BAR (woloskis)', '11:10PM Rock Intl'."""
    s = linea.strip()
    if not s or len(s) > 48: return False
    if RE_HORA.match(s) or RE_DECADA.match(s) or RE_HORATXT.match(s): return True
    nucleo = re.sub(r'\([^)]*\)', '', s).strip()
    letras = [c for c in nucleo if c.isalpha()]
    return bool(letras) and sum(1 for c in letras if c.isupper()) / len(letras) > 0.7

def etiqueta_bloque(linea):
    m = RE_HORATXT.match(linea.strip())
    return (m.group(2).strip() if m else linea.strip())[:42]

# ---------- quién cantó cada tema, línea por línea ----------
# Los invitados van pegados a un emoji de instrumento ("🥁Fede", "FABO 🥁",
# "🎸 Charly, Tomi", "🎹alvaro piano"); ésos NO son los que cantan.
EMOJI = '🥁🎸🎷🎺🎻🎹'
RE_INV_DESPUES = re.compile(f'[{EMOJI}]' + r'\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s*[,+/]\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]+)*')
RE_INV_ANTES   = re.compile(r'[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s*' + f'[{EMOJI}]')

def limpiar_invitados(linea):
    """Primero saca 'emoji + nombre' y recién después 'nombre + emoji': así
    en 'Agas 🥁Fede' se va Fede (batería) y queda Agas (que canta)."""
    s = RE_INV_DESPUES.sub(' ', linea)
    s = RE_INV_ANTES.sub(' ', s)
    return re.sub(f'[{EMOJI}]', ' ', s)

def cantantes_por_tema(linea, cands, nombres_orden):
    """Reparte los nombres de la línea entre los temas que aparecen en ella:
    cada tema se queda con los nombres que van después de su título."""
    limpia = norm(limpiar_invitados(linea))
    if not limpia: return {}

    # ubicar cada tema dentro de la línea ya limpia
    spans = []
    for cand in cands:
        pos, fin = None, 0
        for v in variantes(cand['titulo']):
            p = limpia.find(v)
            if p >= 0: pos, fin = p, p + len(v); break
        spans.append([pos if pos is not None else 0, fin, cand])
    spans.sort(key=lambda x: x[0])

    salida = {}
    for k, (pos, fin, cand) in enumerate(spans):
        hasta = spans[k + 1][0] if k + 1 < len(spans) else len(limpia)
        salida[cand['id']] = nombres_en_tramo(limpia, nombres_orden, fin, max(hasta, fin))
    return salida

def nombres_en_tramo(limpia, nombres_orden, desde, hasta):
    hallados, texto = [], limpia
    for nombre, nnombre in nombres_orden:                 # los más largos primero
        m = re.search(r'(^| )' + re.escape(nnombre) + r'( |$)', texto)
        if not m: continue
        p = m.start()
        if desde <= p < hasta:
            hallados.append((p, nombre))
            texto = texto[:m.start(1)] + ' ' * (len(nnombre) + 1) + texto[m.end(1) + len(nnombre):]
    hallados.sort()
    vistos, out = set(), []
    for _, n in hallados:
        if n not in vistos: vistos.add(n); out.append(n)
    return out

def parrafos_docx(path):
    NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    root = ET.fromstring(zipfile.ZipFile(path).read('word/document.xml').decode('utf-8'))
    return [''.join(t.text or '' for t in p.iter(NS + 't')) for p in root.iter(NS + 'p')]

def reconstruir_setlists(songs, cantantes):
    """Devuelve {nombre_jam: [items en orden]} y un reporte por jam."""
    # El documento a veces usa solo el apellido ("Levy" por "Gaston Levy") o solo
    # el nombre. Registramos esos apodos, pero únicamente cuando son inequívocos:
    # "Gaston" no vale porque hay un "Gaston" y un "Gaston Levy" distintos.
    completos = {norm(c['nombre']) for c in cantantes}
    piezas = collections.Counter()
    for c in cantantes:
        for t in set(norm(c['nombre']).split()):
            if len(t) >= 4: piezas[t] += 1

    pares = [(c['nombre'], norm(c['nombre'])) for c in cantantes] + [('Todos', 'todos')]
    for c in cantantes:
        for t in set(norm(c['nombre']).split()):
            if len(t) >= 4 and piezas[t] == 1 and t not in completos:
                pares.append((c['nombre'], t))

    nombres_orden = sorted([p for p in pares if len(p[1]) >= 2], key=lambda x: -len(x[1]))

    por_jam = {}
    for s in songs:
        for j in s['jams']:
            por_jam.setdefault(j, []).append(s)

    paras = parrafos_docx(SRC_DOCX)
    secciones, actual, nombre = {}, [], None
    for linea in paras:
        if linea.strip() in JAM_MAP:
            if nombre: secciones[nombre] = actual
            nombre, actual = JAM_MAP[linea.strip()], []
            continue
        actual.append(linea)
    if nombre: secciones[nombre] = actual

    salida, reporte = {}, []
    for jam, lineas in secciones.items():
        candidatos = por_jam.get(jam, [])
        if not candidatos: continue

        normlin = [norm(l) for l in lineas]
        complin = [n.replace(' ', '') for n in normlin]
        en_linea, usados = {}, set()

        # pasada 1 · coincidencia literal, títulos largos primero
        for cand in sorted(candidatos, key=lambda s: -len(norm(s['titulo']))):
            for i, nl in enumerate(normlin):
                if not nl: continue
                pos = None
                for v in variantes(cand['titulo']):
                    m = re.search(r'(^| )' + re.escape(v) + r'( |$)', nl)
                    if m: pos = m.start(); break
                    cv = v.replace(' ', '')
                    if len(cv) >= 6 and cv in complin[i]: pos = complin[i].index(cv); break
                if pos is not None:
                    en_linea.setdefault(i, []).append((pos, cand))
                    usados.add(cand['id'])
                    break

        # pasada 2 · fuzzy para los que quedaron sueltos
        for cand in candidatos:
            if cand['id'] in usados: continue
            mejor, mejor_i = 0, None
            for i, nl in enumerate(normlin):
                if len(nl) < 4 or es_bloque(lineas[i]): continue
                for v in variantes(cand['titulo']):
                    r = parcial(v, nl)
                    if r > mejor: mejor, mejor_i = r, i
            if mejor >= 0.80 and mejor_i is not None:
                en_linea.setdefault(mejor_i, []).append((0, cand))
                usados.add(cand['id'])

        for i in en_linea: en_linea[i].sort(key=lambda x: x[0])

        # armado en orden de documento
        items, medley, voces_medley = [], None, []

        def cerrar():
            nonlocal medley
            if medley:
                if len(medley['songs']) >= 2: items.append(medley)
                elif medley['songs']: items.append({'tipo': 'song', **medley['songs'][0]})
                medley = None

        def quien_canto(cand, voces):
            """El de la línea; si no hay, el del encabezado del medley; y si el
            tema tuvo un solo cantante en toda su historia, ése."""
            v = voces.get(cand['id']) or []
            if not v and medley is not None: v = list(voces_medley)
            if not v:
                propios = [c for c in cand['cantantes'] if c.lower() != 'todos']
                if len(cand['cantantes']) == 1: v = list(cand['cantantes'])
                elif len(propios) == 1: v = propios
            return v

        for i, linea in enumerate(lineas):
            s = linea.strip()
            temas = [c for _, c in en_linea.get(i, [])]
            voces = cantantes_por_tema(linea, temas, nombres_orden) if temas else {}

            if not s:
                cerrar(); voces_medley = []; continue

            if RE_BREAK.search(s) and not RE_MEDLEY.search(s) and not temas:
                cerrar()
                mm = re.search(r'\((\d{1,2})\s*(?:min)?\)', s)
                items.append({'tipo': 'break', 'label': 'BREAK', 'minutos': int(mm.group(1)) if mm else 15})
                continue

            abre = bool(RE_MEDLEY.search(s))
            inline = len(temas) >= 2 and '/' in s

            if abre or inline:
                cerrar()
                t = 'Medley'
                if abre:
                    t = re.sub(r'\s{2,}.*$', '', s)
                    t = re.sub(r'[:·].*$', '', t).strip() or 'Medley'
                medley = {'tipo': 'medley', 'titulo': t[:60], 'songs': [], 'notas': ''}
                # "Medley Calamaro (Lalo)": el cantante del encabezado vale para todo el medley
                limpia_h = norm(limpiar_invitados(s))
                voces_medley = nombres_en_tramo(limpia_h, nombres_orden, 0, len(limpia_h))

            for c in temas:
                e = {'songId': c['id'], 'cantantes': quien_canto(c, voces), 'notas': ''}
                if medley: medley['songs'].append(e)
                else: items.append({'tipo': 'song', **e})

            if medley and inline:            # medley completo en un solo renglón
                cerrar()

            if not temas and not abre and es_bloque(s):
                cerrar()
                items.append({'tipo': 'bloque', 'label': etiqueta_bloque(s)})

        cerrar()

        faltantes = [c for c in candidatos if c['id'] not in usados]
        for c in faltantes:
            propios = [x for x in c['cantantes'] if x.lower() != 'todos']
            items.append({'tipo': 'song', 'songId': c['id'],
                          'cantantes': list(c['cantantes']) if len(c['cantantes']) == 1
                                       else (propios if len(propios) == 1 else []),
                          'notas': 'sin posición en el documento'})

        # bloques que quedaron sin nada debajo
        items = [it for i, it in enumerate(items)
                 if it['tipo'] != 'bloque' or any(x['tipo'] != 'bloque' for x in items[i + 1:])]

        salida[jam] = items
        reporte.append((jam, len(candidatos), len(faltantes),
                        sum(1 for x in items if x['tipo'] == 'medley'),
                        sum(1 for x in items if x['tipo'] == 'break'),
                        sum(1 for x in items if x['tipo'] == 'bloque')))
    return salida, reporte

# ============================================================ 2b · rescate
"""
El JSON original marca como "nunca tocado" todo tema que no figure en un
setlist. Pero se le escaparon algunos: los que el documento escribe con otro
título ("Traveling Band" por "Travelin' Band") o los que están adentro de un
medley en la misma línea ("… / Sing It Back / Titanium").

Acá los recuperamos. Para no meter basura, un tema solo se rescata si:
  1) matchea literal (o pegado, tipo "Jijiji" ↔ "Ji Ji Ji"), nunca por parecido
  2) la línea trae marcas de que se tocó: cantante, BPM, CLICK o un instrumento
  3) ningún otro tema de título más largo matchea esa misma línea
     (así "Crazy" no se roba la línea de "Crazy Little Thing Called Love")
  4) si el título es una sola palabra corta, el artista tiene que estar en la
     línea (evita que "Time" agarre "Spending my Time")
"""
RE_EMOJI_INSTR = re.compile('[🥁🎸🎷🎺🎻🎹]')

def variantes_estrictas(titulo):
    """Como variantes(), pero sin las aclaraciones de colaboración ni las cortas."""
    out = [norm(titulo)]
    sin_par = norm(re.sub(r'\([^)]*\)', ' ', titulo))
    if sin_par and sin_par not in out: out.append(sin_par)
    for dentro in re.findall(r'\(([^)]{4,})\)', titulo):
        if re.match(r'^\s*(con|feat|ft|orig|vers|tocan)\b', dentro, re.I): continue   # "(con Queen)"
        d = norm(dentro)
        if len(d) >= 8 and ' ' in d and d not in out: out.append(d)
    return [v for v in out if len(v) >= 4]

def corridas(tokens, maximo=6):
    """Todas las concatenaciones de tokens consecutivos: 'ji ji ji' → 'jijiji'."""
    out = set()
    for i in range(len(tokens)):
        junto = ''
        for j in range(i, min(i + maximo, len(tokens))):
            junto += tokens[j]
            out.add(junto)
    return out

def matchea(v, nl, tokens_junto):
    return bool(re.search(r'(^| )' + re.escape(v) + r'( |$)', nl)) or \
           (len(v) >= 6 and v.replace(' ', '') in tokens_junto)

def tiene_marcas(linea, nl, nombres):
    if RE_EMOJI_INSTR.search(linea): return True
    if re.search(r'\b(click|todos|fill|marco)\b', nl): return True
    if re.search(r'(^| )\d{2,3}( |$)', nl) and not re.search(r'\b(19|20)\d\d\b', nl): return True
    return any(re.search(r'(^| )' + re.escape(n) + r'( |$)', nl) for n in nombres)

# Encabezados que abren una lista de candidatos dentro del bloque de una jam.
# Todo lo que va después no se tocó: son opciones, backlog o repertorio suelto.
RE_LISTA_OPCIONES = re.compile(
    r'^\s*(borrador|backlog|back ?up|lista amplia|otras opciones|otras canciones|tbd|'
    r'movidas|full ?band|opciones|posibles|banco de|para (la )?prox|pedidos|'
    r'cantantes que|no entraron|descartad|extras|general|im[áa]genes|not 70|otras de los)',
    re.I)

def tramos(v, nl, juntos):
    """Dónde matchea la variante dentro de la línea normalizada."""
    m = re.search(r'(^| )' + re.escape(v) + r'( |$)', nl)
    if m: return (m.start(1) if m.group(1) else 0, m.end() - len(m.group(2)))
    if len(v) >= 6 and v.replace(' ', '') in juntos: return (-1, -1)     # matcheo pegado
    return None

def rescatar_no_tocados(songs, cantantes):
    nombres = [norm(c['nombre']) for c in cantantes if len(norm(c['nombre'])) >= 4]
    paras = parrafos_docx(SRC_DOCX)

    jam_de, region, actual, modo = [], [], None, 'setlist'
    for l in paras:
        s = l.strip()
        if s in JAM_MAP: actual, modo = JAM_MAP[s], 'setlist'
        elif RE_LISTA_OPCIONES.match(s): modo = 'opciones'
        jam_de.append(actual); region.append(modo)

    N = [norm(l) for l in paras]
    JUNTOS = [corridas(n.split()) for n in N]
    util = [bool(N[i]) and jam_de[i] is not None and region[i] == 'setlist' for i in range(len(N))]

    # todos los tramos ocupados por algún título, para no robarle la línea a otro
    # tema ("Crazy" no puede quedarse con "Crazy Little Thing Called Love"),
    # pero sí conviven dos títulos en distintas partes de un medley
    ocupados = {}
    for i in range(len(N)):
        if not util[i]: continue
        marcas = []
        for s in songs:
            for v in variantes_estrictas(s['titulo']):
                t = tramos(v, N[i], JUNTOS[i])
                if t and t[0] >= 0: marcas.append(t)
        ocupados[i] = marcas

    rescatados = []
    for s in songs:
        if s['jams']: continue
        vars_t = variantes_estrictas(s['titulo'])
        if not vars_t: continue
        na = norm(s['artista'])
        corto = len(vars_t[0].split()) == 1 and len(vars_t[0]) <= 6

        for i in range(len(N)):
            if not util[i]: continue
            propio = next((t for v in vars_t for t in [tramos(v, N[i], JUNTOS[i])] if t), None)
            if not propio: continue
            if propio[0] >= 0:
                a, b = propio
                if any(x <= a and y >= b and (y - x) > (b - a) for x, y in ocupados[i]):
                    continue                                    # otro título lo contiene
            if not tiene_marcas(paras[i], N[i], nombres): continue
            if corto and not any(p and p in N[i] for p in na.split()[:2]): continue
            s['jams'] = [jam_de[i]]
            rescatados.append((s['titulo'], s['artista'], jam_de[i], paras[i].strip()[:46]))
            break
    return rescatados

# ============================================================ 3 · jams
MESES = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
         'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}

def fecha_del_nombre(nombre):
    m = re.search(r'(\d{1,2})/(\d{1,2})', nombre)
    if m: return int(m.group(2)), int(m.group(1))
    low = nombre.lower()
    for nom, num in MESES.items():
        if nom in low: return num, None
    return None, None

def armar_jams(songs, setlists):
    byid = {s['id']: s for s in songs}
    jam_a_temas = {}
    for s in songs:
        for j in s['jams']:
            jam_a_temas.setdefault(j, []).append(s['id'])

    jams = []
    for nombre, ids in jam_a_temas.items():
        items = setlists.get(nombre)
        con_orden = items is not None
        if not con_orden:
            items = [{'tipo': 'song', 'songId': i, 'cantantes': [], 'notas': ''} for i in ids]
        mes, dia = fecha_del_nombre(nombre)
        cantantes = sorted({c for i in ids for c in byid[i]['cantantes'] if c.lower() != 'todos'})
        jams.append({
            'id': 'hist-' + slug(nombre),
            'nombre': nombre, 'fecha': '', 'hora': '', 'lugar': '',
            'mes': mes, 'dia': dia,
            'historica': True, 'conOrden': con_orden,
            'items': items, 'musicos': cantantes, 'ensayos': [], 'notas': '',
        })
    jams.sort(key=lambda j: -len(j['items']))
    return jams

# ============================================================ main
def main():
    songs, categorias, por_confirmar = leer_repertorio()
    cantantes, musicos = derivar_personas(songs)

    # 1) recuperamos los que sí se tocaron pero el JSON no había marcado
    rescatados = rescatar_no_tocados(songs, cantantes)

    # 2) el resto nunca llegó a un setlist: sale de DBSongs y queda archivado
    descartados = [s for s in songs if not s['jams']]
    songs = [s for s in songs if s['jams']]

    cantantes, musicos = derivar_personas(songs)     # recalculado sobre lo que quedó
    setlists, reporte = reconstruir_setlists(songs, cantantes)
    jams = armar_jams(songs, setlists)

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'descartados.json'), 'w') as f:
        json.dump({
            'nota': 'Temas que nunca figuraron en un setlist real: banco de repertorio '
                    'del documento original (backlog, "otras opciones", "TBD", "otras '
                    'canciones (nunca las hicimos)"). Se sacaron de DBSongs. Para '
                    'devolverlos, importalos desde Datos → Importar temas.',
            'total': len(descartados),
            'songs': descartados,
        }, f, ensure_ascii=False, indent=1)

    payload = {
        'version': 3,
        'generado': 'jams-canciones.json + JAMs - Lista Canciones.docx',
        'categorias': categorias,
        'porConfirmar': por_confirmar,
        'songs': songs,
        'cantantes': cantantes,
        'musicos': musicos,
        'jamsHistoricas': jams,
    }
    destino = os.path.join(OUT, 'seed.json')
    with open(destino, 'w') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print(f"RESCATADOS ({len(rescatados)}) — estaban marcados como nunca tocados:")
    for t, a, j, linea in rescatados:
        print(f"   {t[:30]:32} {a[:18]:20} → {j[:20]:22} «{linea}»")
    print(f"\nDESCARTADOS: {len(descartados)} temas de banco → data/descartados.json")
    print(f"DBSongs queda con {len(songs)} temas\n")

    print(f"{'JAM':28} {'temas':>6} {'s/orden':>8} {'medl':>5} {'brk':>4} {'bloq':>5}")
    print('-' * 60)
    tot_t = tot_f = 0
    for nombre, n, falt, med, brk, blq in sorted(reporte, key=lambda x: -x[1]):
        tot_t += n; tot_f += falt
        print(f"{nombre[:27]:28} {n:6} {falt:8} {med:5} {brk:4} {blq:5}")
    print('-' * 60)
    print(f"temas={len(songs)} cantantes={len(cantantes)} musicos={len(musicos)} jams={len(jams)}")
    print(f"ubicados en el setlist: {tot_t - tot_f}/{tot_t}")
    print(f"→ {destino} ({os.path.getsize(destino) // 1024} KB)")

main()
