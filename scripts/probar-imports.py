#!/usr/bin/env python3
"""
Comprueba que todo lo que un módulo importa, el otro lo exporte.

`node --check` no lo ve: valida sintaxis, no resolución. Un import mal
escrito pasa el chequeo y revienta recién en el navegador, cuando
alguien abre esa pantalla.

    python3 scripts/probar-imports.py
"""

import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
JS = RAIZ / 'js'

# Los identificadores de JS admiten $ y _, que \w no cubre.
IDENT = r'[\w$]+'


def exportados(src):
    n = set(re.findall(rf'export\s+(?:async\s+)?function\s+({IDENT})', src))
    n |= set(re.findall(rf'export\s+(?:const|let|var|class)\s+({IDENT})', src))
    for grupo in re.findall(r'export\s*\{([^}]*)\}', src):
        n |= {x.strip().split()[-1] for x in grupo.split(',') if x.strip()}
    return n


def main():
    tabla = {f: exportados(f.read_text()) for f in JS.rglob('*.js')}
    problemas = []

    for f in sorted(JS.rglob('*.js')):
        src = f.read_text()
        # import estático y dinámico
        pares = re.findall(rf"import\s*\{{([^}}]*)\}}\s*from\s*'([^']+)'", src)
        pares += [(g, r) for g, r in
                  re.findall(rf"const\s*\{{([^}}]*)\}}\s*=\s*await\s+import\('([^']+)'\)", src)]

        for grupo, ruta in pares:
            destino = (f.parent / ruta).resolve()
            if destino not in tabla:
                problemas.append(f'{f.relative_to(RAIZ)}: no existe {ruta}')
                continue
            for nombre in [x.strip() for x in grupo.split(',') if x.strip()]:
                base = nombre.split(' as ')[0].strip()
                if base not in tabla[destino]:
                    problemas.append(
                        f'{f.relative_to(RAIZ)}: importa «{base}» de {ruta}, '
                        f'que no lo exporta')

    for p in problemas:
        print(f'  ✗ {p}')
    if problemas:
        print(f'\n✗ {len(problemas)} imports rotos\n')
        sys.exit(1)
    print(f'  ✓ {len(tabla)} módulos, todos los imports resuelven\n')


if __name__ == '__main__':
    main()
