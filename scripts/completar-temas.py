#!/usr/bin/env python3
"""
Les busca artista y categoría a los temas que quedaron sin banda.

Entrada: el respaldo exportado desde Datos.
Salida:  scripts/salida/completados.csv  (para pegar en Datos → Importar temas)
         scripts/salida/dudosos.csv      (los que conviene mirar a ojo)

El criterio de categoría es el mismo de la app (js/lookup.js): primero,
si la banda ya está en el repertorio, hereda su categoría; si no, se
decide por el género que devuelve iTunes.
"""
import json, io, os, re, sys, time, unicodedata, urllib.parse, urllib.request

CATS = {
    'intl':  'Internacional (rock / pop / funk / soul)',
    'nac':   'Rock nacional argentino / rioplatense',
    'lat':   'Latino y pop en español',
    'trop':  'Cumbia, tropical y cuarteto',
}
GEN_LATINO   = re.compile(r'latin|reggaet|salsa|bachata|merengue|bolero|ranchera|mariachi|flamenco|tango', re.I)
GEN_TROPICAL = re.compile(r'cumbia|tropical|cuarteto|vallenato', re.I)

PAUSA = 0.25

def norm(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()

def pedir(term, intentos=2):
    url = ('https://itunes.apple.com/search?entity=song&limit=25&term='
           + urllib.parse.quote(term))
    for i in range(intentos):
        try:
            with urllib.request.urlopen(url, timeout=8) as r:
                return json.loads(r.read().decode('utf-8')).get('results', [])
        except Exception:
            time.sleep(1.0 * (i + 1))
    return []

def elegir(titulo, res, por_artista):
    """
    El mejor candidato entre los que tienen el título idéntico.

    iTunes ordena por relevancia y ahí arriba aparecen bandas de covers:
    "Celebration" volvía de Forrest Frank en vez de Kool & The Gang. Dos
    desempates que funcionan mejor:
      1) si la banda ya está en el repertorio, es esa — tocan lo que tocan;
      2) si no, la grabación MÁS VIEJA, que suele ser la original y no el cover.
    """
    nt = norm(titulo)
    exactos = [r for r in res if norm(r.get('trackName')) == nt]

    if exactos:
        conocidos = [r for r in exactos if norm(r.get('artistName')) in por_artista]
        if conocidos:
            return conocidos[0], 'alta'
        con_fecha = [r for r in exactos if (r.get('releaseDate') or '')[:4].isdigit()]
        if con_fecha:
            return min(con_fecha, key=lambda r: r['releaseDate'][:4]), 'alta'
        return exactos[0], 'alta'

    parecidos = [r for r in res if nt and nt in norm(r.get('trackName'))]
    if parecidos:
        return parecidos[0], 'media'
    return (res[0], 'baja') if res else (None, None)

def categoria(genero, artista, por_artista):
    """Si la banda ya está en el repertorio, manda su categoría."""
    na = norm(artista)
    if na in por_artista:
        return por_artista[na], 'heredada'
    g = genero or ''
    if GEN_TROPICAL.search(g): return CATS['trop'], g
    if GEN_LATINO.search(g):   return CATS['lat'], g
    return CATS['intl'], g or '(sin género)'

def csv_escape(v):
    v = '' if v is None else str(v)
    return '"' + v.replace('"', '""') + '"' if any(c in v for c in ',"\n') else v

def main(ruta):
    d = json.load(io.open(ruta, encoding='utf-8'))
    songs = d.get('songs', [])

    # artistas que ya están en el repertorio, con su categoría
    por_artista = {}
    for s in songs:
        a = norm(s.get('artista'))
        if a and s.get('categoria'):
            por_artista.setdefault(a, s['categoria'])

    faltan = [s for s in songs if not (s.get('artista') or '').strip()]
    print(f'{len(songs)} temas · {len(faltan)} sin artista', flush=True)

    filas, dudosos = [], []
    for i, s in enumerate(faltan, 1):
        titulo = s['titulo']
        cand, conf = elegir(titulo, pedir(titulo), por_artista)
        if not cand:
            dudosos.append((titulo, '', '', 'no encontrado'))
        else:
            artista = cand.get('artistName') or ''
            cat, motivo = categoria(cand.get('primaryGenreName'), artista, por_artista)
            filas.append((titulo, artista, cat))
            if conf != 'alta':
                dudosos.append((titulo, artista, cat, f'match {conf} · {motivo}'))
        if i % 10 == 0 or i == len(faltan):
            print(f'  {i}/{len(faltan)}', flush=True)
        time.sleep(PAUSA)

    os.makedirs('scripts/salida', exist_ok=True)
    with io.open('scripts/salida/completados.csv', 'w', encoding='utf-8') as f:
        f.write('tema,artista,categoria\n')
        for r in filas:
            f.write(','.join(csv_escape(x) for x in r) + '\n')
    with io.open('scripts/salida/dudosos.csv', 'w', encoding='utf-8') as f:
        f.write('tema,artista,categoria,por que\n')
        for r in dudosos:
            f.write(','.join(csv_escape(x) for x in r) + '\n')

    print(f'listo: {len(filas)} completados · {len(dudosos)} para mirar', flush=True)

if __name__ == '__main__':
    main(sys.argv[1])
