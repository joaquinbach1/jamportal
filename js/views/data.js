/* ============================================================
   views/data.js — importar / exportar / respaldo
   ============================================================ */

import { store, norm } from '../store.js';
import { h, frag, clear, field, toast, confirmar, descargar, copiar } from '../ui.js';
import { PASOS_SQL } from '../drivers/postgres.js';
import { refrescar } from '../app.js';

/* ---------- parser CSV / TSV ---------- */
export function parsearTabla(texto) {
  const sep = texto.includes('\t') && texto.indexOf('\t') < (texto.indexOf(',') === -1 ? 1e9 : texto.indexOf(',')) ? '\t' : ',';
  const filas = [];
  let campo = '', fila = [], entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(c => c.trim()));
}

const ALIAS = {
  titulo: ['titulo', 'título', 'tema', 'cancion', 'canción', 'title', 'song', 'nombre'],
  artista: ['artista', 'banda', 'grupo', 'artist', 'band', 'interprete', 'intérprete'],
  categoria: ['categoria', 'categoría', 'genero', 'género', 'genre', 'estilo'],
  bpm: ['bpm', 'tempo bpm', 'pulso'],
  franja: ['franja', 'tempo', 'energia', 'energía', 'vibe'],
  cantantes: ['cantantes', 'canto', 'cantó', 'canta', 'voz', 'singer', 'vocalista'],
  patches: ['patch', 'patches', 'teclado'],
  cifraUrl: ['cifra', 'cifraurl', 'acordes', 'partitura', 'cifra club', 'cifraclub'],
  notas: ['notas', 'nota', 'comentarios', 'obs'],
  anio: ['anio', 'año', 'year'],
};

function mapearColumnas(cabecera) {
  return cabecera.map(col => {
    const n = norm(col);
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (alias.some(a => norm(a) === n)) return campo;
    }
    return null;
  });
}

const FRANJA_ALIAS = { low: 'low', bajo: 'low', lento: 'low', mid: 'mid', medio: 'mid', high: 'high', alto: 'high', rapido: 'high' };

function filasAObjetos(filas) {
  if (filas.length < 2) return [];
  const mapa = mapearColumnas(filas[0]);
  if (!mapa.includes('titulo')) return [];
  return filas.slice(1).map(f => {
    const o = {};
    mapa.forEach((campo, i) => {
      if (!campo) return;
      const v = (f[i] || '').trim();
      if (!v) return;
      if (campo === 'bpm') { const m = v.match(/\d+/); if (m) o.bpm = parseInt(m[0], 10); }
      else if (campo === 'franja') { const k = norm(v).replace(/[^a-z]/g, ''); o.franja = FRANJA_ALIAS[k] || null; }
      else if (campo === 'cantantes' || campo === 'patches') o[campo] = v.split(/[,;·]/).map(s => s.trim()).filter(Boolean);
      else o[campo] = v;
    });
    return o;
  }).filter(o => o.titulo);
}

/* ============================================================
   Base compartida — para que entren varios y editen lo mismo
   ============================================================ */
function tarjetaNube() {
  const cfg = store.configNube();
  const estado = h('div');

  const fUrl = h('input', {
    type: 'text', value: cfg ? cfg.url : '',
    placeholder: 'https://xxxxxxxx.supabase.co',
  });
  const fKey = h('input', {
    type: 'text', value: cfg ? cfg.key : '',
    placeholder: 'clave anon (la pública, empieza con eyJ…)',
  });

  async function conectar(btn, subirLocal) {
    const url = fUrl.value.trim(), key = fKey.value.trim();
    if (!url || !key) { toast('Faltan la URL y la clave', 'err'); return; }

    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Conectando…';
    try {
      if (store.auth && store.auth.haySesion) {
        await store.conectarNube({ url, key }, { subirLocal });
        toast(`Conectado: ${store.repertorio.length} temas en la base compartida`, 'ok');
        refrescar();
        return;
      }
      // Todavía no hay sesión: guardamos a dónde apuntar y recargamos.
      // La pantalla de entrada se ocupa del resto.
      store.guardarConfigNube({ url, key });
      toast('Ahora entrá con tu mail', 'ok');
      setTimeout(() => location.reload(), 600);
      return;
    } catch (e) {
      toast('No se pudo conectar: ' + e.message, 'err');
      console.error(e);
    }
    btn.disabled = false; btn.textContent = t;
  }

  const pasos = h('ol.pasos', {},
    h('li', {}, 'Creá un proyecto gratis en ',
      h('a', { href: 'https://supabase.com', target: '_blank', rel: 'noopener' }, 'supabase.com'), '.'),
    h('li', {}, 'En ', h('b', {}, 'SQL Editor'), ', pegá y corré los archivos de ',
      h('code.mono', {}, 'db/'), ' en este orden:',
      h('ol.pasos-sql', {}, ...PASOS_SQL.map(p =>
        h('li', {}, h('code.mono', {}, p.archivo), ' — ', h('span.dim', {}, p.que)))),
      h('div.method-hint', {}, 'El último trae el repertorio y las 26 jams históricas. ',
        'Si ya tenías datos en la app, generá el tuyo con ',
        h('code.mono', {}, 'python3 scripts/migrar-a-sql.py respaldo.json'),
        ' a partir de un export de Datos → Respaldo.')),
    h('li', {}, 'En ', h('b', {}, 'Project Settings → API'), ' copiá la ',
      h('b', {}, 'Project URL'), ' y la clave publicable (', h('code.mono', {}, 'sb_publishable_…'),
      ' o la ', h('b', {}, 'anon'), ' vieja), y pegalas acá abajo.'),
    h('li', {}, 'Listo. Pasale el link de la app a los demás: entran y editan lo mismo.'),
  );

  if (store.enLaNube) {
    estado.append(
      h('div.nube-ok', {}, '● Conectada — todo lo que edites se guarda en la base compartida ',
        h('span.dim', {}, `· ${cfg.url.replace(/^https?:\/\//, '')}`)),
      store.email
        ? h('div.nube-sesion', {},
            h('span', {}, 'Entraste como ', h('b', {}, store.email)),
            h('button.btn.xs.ghost', {
              onclick: async () => {
                if (await confirmar('Cerrás la sesión en este navegador. Para volver a entrar te mandamos otro link por mail.',
                  { titulo: 'Salir', okText: 'Salir' })) {
                  store.cerrarSesion();
                  location.reload();
                }
              },
            }, 'Salir'))
        : null,
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
        h('button.btn', {
          onclick: async e => {
            const b = e.currentTarget; b.disabled = true;
            try { await store.sincronizar(); toast('Sincronizado', 'ok'); refrescar(); }
            catch (err) { toast('No se pudo sincronizar: ' + err.message, 'err'); }
            b.disabled = false;
          },
        }, '↻ Traer cambios ahora'),
        h('button.btn.ghost', {
          onclick: async () => {
            if (await confirmar('Volvés a trabajar solo en este navegador. La base compartida queda intacta, pero dejás de ver lo que hagan los demás.',
              { titulo: 'Desconectar', danger: false, okText: 'Desconectar' })) {
              store.desconectarNube(); toast('Desconectado'); refrescar();
            }
          },
        }, 'Desconectar')));
  } else {
    estado.append(
      pasos,
      h('div.grid-2', { style: { marginTop: '14px' } },
        field('Project URL', fUrl),
        field('Clave anon', fKey)),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
        h('button.btn.primary', { onclick: e => conectar(e.currentTarget, false) }, 'Conectar'),
        h('button.btn', {
          title: 'Usá esto solo la primera vez, desde la compu que tiene los datos buenos',
          onclick: async e => {
            if (await confirmar('Sube lo que tenés en este navegador y pisa lo que haya en la base compartida. Usalo solo la primera vez.',
              { titulo: 'Subir mis datos', okText: 'Subir y pisar' })) conectar(e.currentTarget, true);
          },
        }, '⬆ Conectar y subir lo mío')),
      h('div.dim', { style: { fontSize: '11.5px', marginTop: '10px', lineHeight: '1.5' } },
        'La clave anon es pública por diseño, pero con esta configuración cualquiera que tenga el link ',
        'y la clave puede editar. Sirve para la banda; no lo publiques abierto.'));
  }

  return h('div.card', {},
    h('div.card-head', {}, h('h3', {}, 'Base compartida'),
      h('span.dim', { style: { fontSize: '12px' } },
        store.enLaNube ? 'varios editando la misma base' : 'hoy: solo este navegador')),
    estado);
}

/* ============================================================
   Vista
   ============================================================ */
export function vistaData() {
  const infoImport = h('div');

  /* --- importar JSON (respaldo completo) --- */
  const fileJSON = h('input', { type: 'file', accept: '.json', style: { display: 'none' } });
  fileJSON.addEventListener('change', async () => {
    const file = fileJSON.files[0];
    if (!file) return;
    if (!await confirmar(`Importar «${file.name}» reemplaza TODO lo que tenés cargado (temas, cantantes y jams). ¿Seguimos?`, { titulo: 'Importar respaldo' })) return;
    try {
      await store.importJSON(await file.text());
      toast('Respaldo importado', 'ok');
      refrescar();
    } catch (e) { toast('No se pudo importar: ' + e.message, 'err'); }
    fileJSON.value = '';
  });

  /* --- importar CSV / pegado --- */
  const ta = h('textarea', {
    placeholder: 'Pegá acá el CSV o directamente las celdas copiadas de Excel / Google Sheets.\n\nLa primera fila tiene que ser el encabezado. Reconozco: tema, artista, categoría, bpm, franja, cantantes, patch, año, notas.',
    style: { minHeight: '140px' },
  });
  const fileCSV = h('input', { type: 'file', accept: '.csv,.tsv,.txt', style: { display: 'none' } });
  fileCSV.addEventListener('change', async () => {
    const file = fileCSV.files[0];
    if (file) { ta.value = await file.text(); previsualizar(); }
    fileCSV.value = '';
  });

  function previsualizar() {
    clear(infoImport);
    const objetos = filasAObjetos(parsearTabla(ta.value));
    if (!objetos.length) {
      infoImport.appendChild(h('div.method-hint', {}, 'No reconocí ninguna fila. Revisá que haya una columna llamada "tema" o "título".'));
      return;
    }
    const nuevas = objetos.filter(o => !store.matchSong(o.titulo, o.artista));
    infoImport.append(
      h('div.method-hint', {}, `${objetos.length} filas leídas · ${nuevas.length} temas nuevos · ${objetos.length - nuevas.length} que ya están (se actualizan).`),
      h('div.paste-result', {}, objetos.slice(0, 12).map(o => {
        const existe = store.matchSong(o.titulo, o.artista);
        return h('div.paste-row.' + (existe ? 'ok' : 'new'), {},
          h('div.pr-main', {}, h('div.pr-t', {}, o.titulo),
            h('div.pr-s', {}, [o.artista, o.bpm && o.bpm + ' bpm', o.categoria].filter(Boolean).join(' · ') || '—')),
          h('span.chip', {}, existe ? 'actualiza' : 'nuevo'));
      })),
      objetos.length > 12 ? h('div.dim', { style: { fontSize: '12px', marginTop: '6px' } }, `…y ${objetos.length - 12} más`) : null,
      h('button.btn.primary', {
        style: { marginTop: '12px' },
        onclick: () => {
          const r = store.importSongRows(objetos);
          toast(`${r.nuevas} nuevas, ${r.actualizadas} actualizadas`, 'ok');
          ta.value = ''; clear(infoImport); refrescar();
        },
      }, `Importar ${objetos.length} temas`));
  }

  /* --- exportar CSV --- */
  function exportarCSV() {
    const cols = ['titulo', 'artista', 'categoria', 'bpm', 'franja', 'cantantes', 'patches', 'jams', 'cifraUrl', 'notas'];
    const esc = v => {
      const s = Array.isArray(v) ? v.join('; ') : (v ?? '');
      return /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s;
    };
    const filas = [cols.join(','), ...store.songs.map(s => cols.map(c => esc(s[c])).join(','))];
    descargar('dbsongs.csv', filas.join('\n'), 'text/csv');
    toast('CSV descargado', 'ok');
  }

  const totalJams = store.jams.filter(j => !j.historica).length;
  const pesoKB = Math.round((store.exportJSON().length / 1024));

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Datos'),
        h('p.sub', {}, 'Todo vive en este navegador. Exportá seguido para no perder nada — y para pasar la base a otro dispositivo.'))),

    h('div.stat-row', {},
      h('div.stat', {}, h('b', {}, store.songs.length), h('span', {}, 'temas')),
      h('div.stat', {}, h('b', {}, store.cantantes.length), h('span', {}, 'cantantes')),
      h('div.stat', {}, h('b', {}, store.musicos.length), h('span', {}, 'músicos')),
      h('div.stat', {}, h('b', {}, totalJams), h('span', {}, 'jams nuevas')),
      h('div.stat', {}, h('b', {}, store.jams.length - totalJams), h('span', {}, 'históricas')),
      h('div.stat', {}, h('b', {}, pesoKB + ' KB'), h('span', {}, 'guardados'))),

    h('div.card', {},
      h('div.card-head', {}, h('h3', {}, 'Respaldo completo')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } },
        'Un JSON con temas, cantantes y jams. Sirve de backup y para mover todo a otra máquina.'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button.btn.primary', { onclick: () => { descargar(`jamportal-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON()); toast('Respaldo descargado', 'ok'); } }, '⬇ Exportar todo (JSON)'),
        h('button.btn', { onclick: () => fileJSON.click() }, '⬆ Importar respaldo'),
        h('button.btn', { onclick: exportarCSV }, '⬇ DBSongs como CSV'),
        h('button.btn.ghost', { onclick: () => copiar(store.exportJSON()) }, '📋 Copiar JSON'),
        fileJSON)),

    tarjetaNube(),

    h('div.card', {},
      h('div.card-head', {}, h('h3', {}, 'Actualizar el repertorio')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } },
        'Trae la última versión del repertorio base (temas, cantantes y jams históricas) ',
        'sin tocar tus jams, tus ideas ni los temas que cargaste a mano.'),
      h('button.btn', {
        onclick: async e => {
          const b = e.currentTarget;
          b.disabled = true; b.textContent = 'Actualizando…';
          try {
            await store.actualizarSeed();
            toast(`Repertorio actualizado: ${store.repertorio.length} temas`, 'ok');
            refrescar();
          } catch (err) { toast('No se pudo actualizar: ' + err.message, 'err'); }
          b.disabled = false; b.textContent = '↻ Actualizar repertorio';
        },
      }, '↻ Actualizar repertorio')),

    h('div.card', {},
      h('div.card-head', {}, h('h3', {}, 'Importar temas (CSV o pegado)')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } },
        'Suma temas a DBSongs sin borrar nada: si el tema ya existe, completa los campos vacíos.'),
      ta,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
        h('button.btn', { onclick: previsualizar }, 'Previsualizar'),
        h('button.btn.ghost', { onclick: () => fileCSV.click() }, '📄 Elegir archivo CSV'),
        fileCSV),
      infoImport),

    h('div.card', {},
      h('div.card-head', {}, h('h3', {}, 'Zona peligrosa')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } },
        store.enLaNube
          ? 'Ojo: estás en la base compartida, así que esto afecta a todos.'
          : 'Vuelve al repertorio original y borra las jams que armaste.'),
      h('button.btn.danger', {
        onclick: async () => {
          const aviso = store.enLaNube
            ? 'Estás conectado a la base compartida: esto borra las jams PARA TODOS y recarga el repertorio original. ¿Seguro?'
            : 'Esto borra las jams que armaste y recarga el repertorio original. ¿Seguro?';
          if (await confirmar(aviso, { titulo: 'Reiniciar todo' })) {
            await store.reset(); toast('Base reiniciada'); refrescar();
          }
        },
      }, 'Reiniciar a la base original')),

    h('div.card', {},
      h('div.card-head', {}, h('h3', {}, 'Sobre el guardado')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px', lineHeight: '1.65' } },
        'Hoy los datos se guardan en el navegador (localStorage), así que son de este equipo y este navegador. ',
        'Toda la app habla con una sola capa de datos ', h('code.mono', {}, 'js/store.js'),
        ': para pasar a una base compartida en la nube alcanza con reemplazar ', h('code.mono', {}, 'LocalDriver'),
        ' por un driver de Supabase con los mismos métodos ', h('code.mono', {}, 'read/write'), ', sin tocar ninguna pantalla.')),
  );
}
