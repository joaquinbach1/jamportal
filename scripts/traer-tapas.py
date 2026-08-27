#!/usr/bin/env python3
"""
Busca el disco y la tapa de cada tema del repertorio.

Entrada: el respaldo exportado desde Datos.
Salida:  scripts/salida/tapas.csv   (para pegar en Datos → Importar temas)

Se queda con el resultado cuyo título coincida exacto y cuyo artista
coincida, y prefiere la edición MÁS VIEJA: iTunes suele devolver primero
un "Deluxe Edition" o un grandes éxitos, y el disco original es el que
uno reconoce.
"""
import json, io, os, re, sys, time, unicodedata, urllib.parse, urllib.request

PAUSA = 0.25
GUARDAR_CADA = 25

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

# los recopilatorios no son "el disco" del tema
RE_RECOPILADO = re.compile(
    r'greatest hits|best of|grandes exitos|coleccion|collection|antolog|'
    r'essential|\bhits\b|compilation|anthology|obras cumbres|20 a[nñ]os|'
    r'\bsingles\b|box set|\blive\b|en vivo|unplugged|tribut|karaoke|'
    r'\bmix\b|remixes|soundtrack|banda de sonido', re.I)

# "(Deluxe Edition)", "(Remastered 2011)" — el disco es el mismo, el nombre no
RE_ADORNO = re.compile(r'\s*[\(\[][^)\]]*(deluxe|remaster|edition|edici[oó]n|expanded|anniversary|version)[^)\]]*[\)\]]', re.I)

def portada_grande(url, px=300):
    return re.sub(r'/\d+x\d+bb\.', f'/{px}x{px}bb.', url or '')

def disco_de(titulo, artista):
    res = pedir(f'{titulo} {artista}')
    nt, na = norm(titulo), norm(artista)

    buenos = []
    for r in res:
        if norm(r.get('trackName')) != nt:
            continue
        ra = norm(r.get('artistName'))
        if na and not (na in ra or ra in na):
            continue
        if not r.get('collectionName'):
            continue
        buenos.append(r)
    if not buenos:
        return None

    # fuera los recopilatorios; entre los que quedan, primero los que no
    # tienen adornos en el nombre, y de esos el más viejo
    propios = [r for r in buenos if not RE_RECOPILADO.search(r['collectionName'])] or buenos
    propios.sort(key=lambda r: (
        1 if RE_ADORNO.search(r['collectionName']) else 0,
        r.get('releaseDate') or '9999',
    ))
    g = propios[0]
    return {
        'album': RE_ADORNO.sub('', g['collectionName']).strip(),
        'albumId': g.get('collectionId') or '',
        'cover': portada_grande(g.get('artworkUrl100')),
    }

def csv_escape(v):
    v = '' if v is None else str(v)
    return '"' + v.replace('"', '""') + '"' if any(c in v for c in ',"\n') else v

def main(ruta):
    d = json.load(io.open(ruta, encoding='utf-8'))
    songs = [s for s in d.get('songs', []) if (s.get('titulo') or '').strip()]
    faltan = [s for s in songs if not s.get('cover')]
    print(f'{len(songs)} temas · {len(faltan)} sin tapa', flush=True)

    filas, sin = [], 0
    os.makedirs('scripts/salida', exist_ok=True)

    def escribir():
        with io.open('scripts/salida/tapas.csv', 'w', encoding='utf-8') as f:
            f.write('tema,artista,album,albumId,cover\n')
            for r in filas:
                f.write(','.join(csv_escape(x) for x in r) + '\n')

    for i, s in enumerate(faltan, 1):
        r = disco_de(s['titulo'], s.get('artista') or '')
        if r:
            filas.append((s['titulo'], s.get('artista') or '', r['album'], r['albumId'], r['cover']))
        else:
            sin += 1
        if i % GUARDAR_CADA == 0 or i == len(faltan):
            escribir()
            print(f'  {i}/{len(faltan)} · {len(filas)} con tapa · {sin} sin dato', flush=True)
        time.sleep(PAUSA)

    escribir()
    print(f'listo: {len(filas)} con tapa, {sin} sin dato', flush=True)

if __name__ == '__main__':
    main(sys.argv[1])
