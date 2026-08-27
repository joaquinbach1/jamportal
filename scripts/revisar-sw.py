#!/usr/bin/env python3
"""
Comprueba que sw.js liste TODOS los módulos, y los pone si falta alguno.

Existe porque la lista a mano se quedó vieja: faltaban duracion.js,
spotify.js y views/movil.js. Con señal no se nota —la estrategia es
"primero la red"— pero el que se quedaba sin conexión justo en esos
archivos no podía ni abrir la app, y el error que veía no decía nada
del service worker.

    python3 scripts/revisar-sw.py            # avisa si falta algo
    python3 scripts/revisar-sw.py --arreglar # además lo escribe
"""
import os
import re
import sys

SW = 'sw.js'
FIJOS = ["./", "./index.html", "./css/styles.css"]


def modulos():
    out = []
    for raiz, _, files in os.walk('js'):
        for f in files:
            if f.endswith('.js'):
                out.append('./' + os.path.join(raiz, f).replace(os.sep, '/'))
    return sorted(out)


def main():
    src = open(SW, encoding='utf-8').read()
    m = re.search(r'const BASE = \[(.*?)\];', src, re.S)
    if not m:
        sys.exit(f'No encontré la lista BASE en {SW}')

    listados = re.findall(r"'([^']+)'", m.group(1))
    esperados = FIJOS + modulos()

    faltan = [x for x in esperados if x not in listados]
    sobran = [x for x in listados if x not in esperados]

    if not faltan and not sobran:
        print(f'  ✓ sw.js lista los {len(modulos())} módulos')
        return

    for x in faltan:
        print(f'  ✗ falta en sw.js: {x}')
    for x in sobran:
        print(f'  ✗ sobra en sw.js (ya no existe): {x}')

    if '--arreglar' not in sys.argv:
        print('\nCorré: python3 scripts/revisar-sw.py --arreglar')
        sys.exit(1)

    nueva = '\n'.join(f"  '{x}'," for x in esperados)
    open(SW, 'w', encoding='utf-8').write(
        src[:m.start(1)] + '\n' + nueva + '\n' + src[m.end(1):])
    print(f'\n  ✓ sw.js actualizado: {len(esperados)} archivos')


if __name__ == '__main__':
    main()
