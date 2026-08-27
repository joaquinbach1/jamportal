/* ============================================================
   views/data.js — importar / exportar / respaldo
   ============================================================ */

import { store, norm } from '../store.js';
import { h, frag, clear, poner, toast, confirmar, descargar, copiar } from '../ui.js';
import { dialogoClave } from './usuario.js';
import { tarjetaMiembros } from './miembros.js';
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
   La base — con qué cuenta estás y cómo traer cambios
   ------------------------------------------------------------
   Ya no hay nada que elegir acá: la app habla siempre con la
   base de la banda. Antes esta tarjeta servía para conectarse,
   desconectarse y "trabajar solo en este navegador", y esa
   última opción era una trampa — el que caía ahí seguía
   editando, pero contra datos que no eran los de nadie más.
   ============================================================ */
function tarjetaNube() {
  const cfg = store.configNube() || {};

  return h('div.card', {},
    h('div.card-head', {}, h('h3', {}, 'La base'),
      h('span.dim', { style: { fontSize: '12px' } }, 'todos editan lo mismo')),

    h('div.nube-ok', {}, '● Conectada ',
      h('span.dim', {}, `· ${(cfg.url || '').replace(/^https?:\/\//, '')}`)),

    store.email
      ? h('div.nube-sesion', {},
          h('span', {}, 'Entraste como ', h('b', {}, store.email)),
          h('button.btn.xs.ghost', { onclick: dialogoClave }, 'Cambiar contraseña'),
          h('button.btn.xs.ghost', {
            onclick: async () => {
              if (await confirmar('Cerrás la sesión en este navegador. Para volver a entrar vas a necesitar tu contraseña.',
                { titulo: 'Salir', okText: 'Salir' })) {
                store.cerrarSesion();
                location.reload();
              }
            },
          }, 'Salir'))
      : null,

    h('div', { style: { marginTop: '12px' } },
      h('button.btn', {
        onclick: async e => {
          const b = e.currentTarget; b.disabled = true;
          try { await store.sincronizar(); toast('Sincronizado', 'ok'); refrescar(); }
          catch (err) { toast('No se pudo sincronizar: ' + err.message, 'err'); }
          b.disabled = false;
        },
      }, '↻ Traer cambios ahora')),

    h('div.dim', { style: { fontSize: '11.5px', marginTop: '12px', lineHeight: '1.5' } },
      'Para levantar una base propia, los archivos de ', h('code.mono', {}, 'db/'),
      ' en orden y la URL + clave publicable en ', h('code.mono', {}, 'js/config.js'),
      '. Está todo en el README.'));
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

  /* --- categorías --- */
  const infoCats = h('div');

  function pintarCategorias() {
    clear(infoCats);
    const uso = store.usoDeCategorias();
    const sobran = uso.filter(u => u.enLaLista && !u.temas);

    poner(infoCats,
      h('div.paste-result', {}, uso.map(u => h('div.paste-row.' + (u.temas ? 'ok' : 'new'), {},
        h('div.pr-main', {},
          h('div.pr-t', {}, u.categoria),
          h('div.pr-s', {}, u.temas
            ? `${u.temas} tema${u.temas > 1 ? 's' : ''}`
            : (u.enLaLista ? 'sin temas — se puede sacar' : 'no está en la lista'))),
        u.enLaLista && !u.temas
          ? h('button.btn.xs.danger', {
              onclick: async () => {
                const r = store.quitarCategoria(u.categoria);
                if (!r.ok) { toast('No se pudo: ' + r.motivo, 'err'); return; }
                toast('Categoría sacada', 'ok');
                pintarCategorias(); refrescar();
              },
            }, '✕ sacar')
          : h('span.chip', {}, u.temas ? 'en uso' : '—')))),

      sobran.length
        ? h('div.method-hint', { style: { marginTop: '10px' } },
            `${sobran.length} categoría${sobran.length > 1 ? 's' : ''} sin ningún tema. `,
            'Sacarlas no toca ninguna canción.')
        : h('div.method-hint', { style: { marginTop: '10px' } },
            'Todas las categorías tienen temas. No hay nada para sacar.'));
  }

  /* --- juntar duplicados --- */
  const infoDup = h('div');

  function pintarDuplicados() {
    clear(infoDup);
    const grupos = store.duplicados();

    if (!grupos.length) {
      infoDup.appendChild(h('div.method-hint', {}, 'No hay temas repetidos.'));
      return;
    }

    const cuantos = grupos.reduce((a, g) => a + g.sobran.length, 0);
    poner(infoDup,
      h('div.method-hint', {},
        grupos.length === 1
          ? `Hay 1 tema cargado ${cuantos + 1} veces. `
          : `${grupos.length} temas están cargados más de una vez (${cuantos} de más). `,
        'Se queda el que más historia y datos tiene, y el resto se funde adentro: ',
        'lo que al que queda le falte se lo lleva del otro, y las jams que apuntaban al repetido pasan a apuntar al que queda.'),
      h('div.paste-result', {}, grupos.slice(0, 15).map(g => h('div.paste-row.ok', {},
        h('div.pr-main', {},
          h('div.pr-t', {}, g.queda.titulo),
          h('div.pr-s', {},
            `queda: ${g.queda.artista || 'sin artista'}`
            + ((g.queda.jams || []).length ? ` · ${g.queda.jams.length} jams` : '')
            + '  ←  se funden: '
            + g.sobran.map(x => x.artista || 'sin artista').join(', '))),
        h('span.chip', {}, `${g.sobran.length + 1} copias`)))),
      grupos.length > 15
        ? h('div.dim', { style: { fontSize: '12px', marginTop: '6px' } }, `…y ${grupos.length - 15} más`)
        : null,
      h('button.btn.primary', {
        style: { marginTop: '12px' },
        onclick: async () => {
          if (!await confirmar(`Se van a juntar ${cuantos} temas repetidos. No se pierde nada: los datos se suman en el que queda.`,
            { titulo: 'Juntar duplicados', danger: false, okText: 'Juntarlos' })) return;
          const r = store.fusionarDuplicados();
          toast(`${r.fusionados} temas repetidos se fundieron`, 'ok');
          pintarDuplicados(); refrescar();
        },
      }, `Juntar los ${cuantos} repetidos`));
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

    tarjetaMiembros(),

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
      h('div.card-head', {}, h('h3', {}, 'Categorías')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } },
        'Las que quedaron sin ningún tema se pueden sacar. Las que tienen temas no: '
        + 'primero hay que mover esos temas a otra categoría.'),
      h('button.btn', { onclick: pintarCategorias }, '🏷 Ver categorías'),
      infoCats),

    h('div.card', {},
      h('div.card-head', {}, h('h3', {}, 'Temas repetidos')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } },
        'Junta los que están cargados dos veces. Solo toca los que tienen el mismo título y '
        + 'el mismo artista, o uno de los dos sin artista: dos temas distintos que se llamen '
        + 'igual quedan como están.'),
      h('button.btn', { onclick: pintarDuplicados }, '🔍 Buscar repetidos'),
      infoDup),

    h('div.card', {},
      h('div.card-head', {}, h('h3', {}, 'Sobre el guardado')),
      h('p.muted', { style: { marginTop: 0, fontSize: '13.5px', lineHeight: '1.65' } },
        'Todo vive en la base compartida: lo que edita cualquiera lo ven todos, al instante. ',
        'En este navegador solo quedan tu sesión, el tema claro/oscuro y tus notas privadas. ',
        'Toda la app habla con una sola capa de datos, ', h('code.mono', {}, 'js/store.js'),
        ', y del otro lado hay doce tablas: la traducción la hace Postgres.')),
  );
}
