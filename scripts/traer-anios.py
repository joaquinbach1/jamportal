#!/usr/bin/env python3
"""
Le pone el año a cada tema de data/seed.json, buscándolo en iTunes.

iTunes a veces devuelve la fecha de una reedición en vez de la del
original ("Necesito" de Sui Generis vuelve como 1987 y es del 73), así
que se queda con la MÁS VIEJA de las coincidencias buenas: la primera
edición es la que define la época del tema.

Se puede correr varias veces: solo busca los que no tienen año.
"""
import json, io, sys, time, urllib.parse, urllib.request, unicodedata, re

SEED = 'data/seed.json'
PAUSA = 0.25          # iTunes corta si le pegás muy seguido
GUARDAR_CADA = 20     # se escribe seguido: si se corta, no se pierde nada

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

def anio_de(titulo, artista):
    res = pedir(f'{titulo} {artista}')
    nt, na = norm(titulo), norm(artista)
    anios = []
    for r in res:
        rt, ra = norm(r.get('trackName')), norm(r.get('artistName'))
        # el título tiene que coincidir de verdad, y el artista al menos rozar
        if not (nt == rt or nt in rt or rt in nt):
            continue
        if not (na in ra or ra in na):
            continue
        f = (r.get('releaseDate') or '')[:4]
        if f.isdigit():
            anios.append(int(f))
    return min(anios) if anios else None

def main():
    d = json.load(io.open(SEED, encoding='utf-8'))
    songs = d['songs']
    faltan = [s for s in songs if not s.get('anio') and s.get('anioFuente') != 'sin']
    print(f'{len(songs)} temas · {len(faltan)} sin año', flush=True)

    puestos = sin_dato = 0
    for i, s in enumerate(faltan, 1):
        a = anio_de(s['titulo'], s['artista'])
        if a:
            s['anio'] = a
            puestos += 1
        else:
            s['anio'] = None
            s['anioFuente'] = 'sin'
            sin_dato += 1
        if i % GUARDAR_CADA == 0 or i == len(faltan):
            json.dump(d, io.open(SEED, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'  {i}/{len(faltan)} · {puestos} con año · {sin_dato} sin dato', flush=True)
        time.sleep(PAUSA)

    json.dump(d, io.open(SEED, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'listo: {puestos} con año, {sin_dato} sin dato', flush=True)

if __name__ == '__main__':
    main()
