#!/usr/bin/env python3
"""
Le pone la duración a cada tema del repertorio, buscándola en iTunes.

Es lo que hace falta para estimar a qué hora termina una jam. Sin este
dato la app usa 4 minutos parejos para todos, que es una mentira
razonable pero mentira: "Bohemian Rhapsody" y "Blitzkrieg Bop" no duran
lo mismo.

iTunes suele devolver varias versiones del mismo tema —el single, el
recopilado, el vivo— y no todas duran igual. Se descartan las versiones
raras (vivo, remix, karaoke) y de las que quedan se toma la MEDIANA:
si se cuela una versión extendida de 9 minutos, no arrastra el número.

Se puede correr las veces que haga falta: solo busca los que no tienen
duración. Los que iTunes no encuentra quedan marcados en un archivo
aparte para no volver a pedirlos en cada corrida.

    export JAMPORTAL_CONN='postgresql://...'
    python3 scripts/traer-duraciones.py
"""
import json, os, re, ssl, subprocess, sys, time, unicodedata, urllib.parse, urllib.request

# En macOS, el Python de python.org viene sin el almacén de certificados del
# sistema y urllib no puede validar el TLS de Apple: todas las búsquedas
# vuelven vacías, sin error visible. Si certifi está, lo usamos.
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = None

PAUSA = 0.25            # iTunes corta si le pegás muy seguido
GUARDAR_CADA = 25       # se escribe seguido: si se corta, no se pierde nada
SIN_DATO = 'scripts/salida/sin-duracion.txt'

RE_VERSION_RARA = re.compile(
    r'\b(live|en vivo|remix|karaoke|instrumental|acoustic|ac[uú]stic|tribute|'
    r'extended|medley|megamix|continuous|mix)\b', re.I)


def norm(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def conn():
    c = os.environ.get('JAMPORTAL_CONN')
    if not c:
        sys.exit('Falta JAMPORTAL_CONN con la cadena de conexión a Postgres.')
    return c


def psql(sql, capturar=True):
    # el separador va explícito en tab: el de fábrica es '|' y hay títulos
    # que lo tienen adentro ("Hey Jude | remaster")
    r = subprocess.run(['psql', conn(), '-v', 'ON_ERROR_STOP=1', '-F', '\t', '-Atc', sql],
                       capture_output=capturar, text=True)
    if r.returncode:
        sys.exit((r.stderr or '').strip() or 'psql falló')
    return r.stdout


def pedir(term, intentos=2):
    url = ('https://itunes.apple.com/search?entity=song&limit=25&term='
           + urllib.parse.quote(term))
    for i in range(intentos):
        try:
            with urllib.request.urlopen(url, timeout=10, context=CTX) as r:
                return json.loads(r.read().decode('utf-8')).get('results', [])
        except Exception:
            time.sleep(1.0 * (i + 1))
    return []


def duracion_de(titulo, artista):
    """Segundos, o None. La mediana de las versiones que coinciden."""
    nt, na = norm(titulo), norm(artista)
    if not nt:
        return None
    res = pedir(f'{titulo} {artista}'.strip())
    seg = []
    for r in res:
        rt, ra = norm(r.get('trackName')), norm(r.get('artistName'))
        if RE_VERSION_RARA.search(r.get('trackName') or ''):
            continue
        if RE_VERSION_RARA.search(r.get('collectionName') or ''):
            continue
        # sin artista cargado no hay con qué desempatar: el título tiene
        # que coincidir entero, si no cualquier homónimo pasa por bueno
        if na:
            if not (nt == rt or nt in rt or rt in nt):
                continue
            if not (na in ra or ra in na):
                continue
        elif nt != rt:
            continue
        ms = r.get('trackTimeMillis')
        if ms and 20_000 <= ms <= 1_800_000:
            seg.append(round(ms / 1000))
    if not seg:
        return None
    seg.sort()
    return seg[len(seg) // 2]


def main():
    ya_fallaron = set()
    if os.path.exists(SIN_DATO):
        ya_fallaron = {l.strip() for l in open(SIN_DATO, encoding='utf-8') if l.strip()}

    filas = [(l.split('\t') + ['', ''])[:3] for l in psql(
        "select id, titulo, artista from song "
        "where duracion_sec is null and estado <> 'descartado' "
        "order by artista, titulo").splitlines() if l]
    faltan = [f for f in filas if f[0] not in ya_fallaron]

    print(f'{len(filas)} temas sin duración · {len(faltan)} para pedir '
          f'({len(filas) - len(faltan)} ya dieron vacío antes)', flush=True)
    if not faltan:
        return

    pendientes, puestos, sin = [], 0, []

    def volcar():
        nonlocal pendientes
        if pendientes:
            psql('; '.join(
                f"update song set duracion_sec = {d} where id = '{i}'"
                for i, d in pendientes))
            pendientes = []
        if sin:
            os.makedirs(os.path.dirname(SIN_DATO), exist_ok=True)
            with open(SIN_DATO, 'a', encoding='utf-8') as f:
                f.writelines(i + '\n' for i in sin)
            sin.clear()

    for n, (sid, titulo, artista) in enumerate(faltan, 1):
        d = duracion_de(titulo, artista)
        if d:
            pendientes.append((sid, d))
            puestos += 1
            marca = f'{d // 60}:{d % 60:02d}'
        else:
            sin.append(sid)
            marca = '—'
        print(f'  {n:>3}/{len(faltan)}  {marca:>5}  {titulo[:38]:<38} {artista[:24]}', flush=True)
        if n % GUARDAR_CADA == 0:
            volcar()
        time.sleep(PAUSA)

    volcar()
    total = int(psql('select count(*) from song where duracion_sec is not null').strip())
    print(f'\nListo: {puestos} duraciones nuevas · {total} temas con duración en la base')


if __name__ == '__main__':
    main()
