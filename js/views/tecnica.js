/* ============================================================
   views/tecnica.js — la planilla técnica
   ------------------------------------------------------------
   Un tema por renglón y un puesto por columna. Es la hoja que se
   imprime y se pega en el atril, o se manda por WhatsApp antes
   de la jam: de un vistazo se ve quién toca qué en toda la
   noche.

   Lo que la hace útil no es la grilla sino lo que resalta. En
   una jam la formación es casi siempre la misma; lo que hay que
   ver es dónde cambia, porque ahí es donde alguien entra, sale o
   se cruza de instrumento. Así que toda celda distinta de la del
   tema anterior va marcada, y el resto se apaga.

   Eso deja la hoja llena de gris con unas pocas marcas: exacto,
   esas pocas son el trabajo de la noche.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, poner, toast, fechaLinda, copiar } from '../ui.js';

/* El orden y los nombres son los de la planilla, no los de la app: acá
   se lee de corrido y «Bass» o «Drums» es como los nombra la banda. */
const COLUMNAS = [
  { clave: 'g1',    titulo: 'Guit 1' },
  { clave: 'g2',    titulo: 'Guit 2' },
  { clave: 't1',    titulo: 'Key 1' },
  { clave: 't2',    titulo: 'Key 2' },
  { clave: 'bajo',  titulo: 'Bass' },
  { clave: 'percu', titulo: 'Percu' },
  { clave: 'saxo',  titulo: 'Vientos' },
  { clave: 'bat',   titulo: 'Drums' },
];

const nombreEn = (musicos, clave) => {
  const m = musicos;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return '';
  return (m[clave] && m[clave].nombre) || '';
};

/**
 * Aplana la jam a renglones de planilla. Los temas de un medley entran
 * uno por uno —cada uno tiene su propia formación y es lo que hay que
 * leer— con el medley arriba como separador.
 */
function renglones(jam) {
  const out = [];
  let n = 0;
  for (const it of jam.items || []) {
    if (it.tipo === 'bloque') { out.push({ tipo: 'corte', texto: (it.label || 'BLOQUE').toUpperCase() }); continue; }
    if (it.tipo === 'break') { out.push({ tipo: 'corte', texto: `BREAK ${it.minutos || ''}′`.trim() }); continue; }

    if (it.tipo === 'medley') {
      n++;
      out.push({ tipo: 'corte', texto: `MEDLEY ${it.titulo || ''}`.trim(), n });
      for (const ms of it.songs || []) {
        const s = store.song(ms.songId);
        out.push({
          tipo: 'tema', dentro: true,
          titulo: s ? s.titulo : '(tema borrado)',
          vientos: !!(s && s.vientos),
          cantantes: (ms.cantantes || []).join(', '),
          musicos: ms.musicos,
        });
      }
      continue;
    }

    if (it.tipo !== 'song') continue;
    n++;
    const s = store.song(it.songId);
    out.push({
      tipo: 'tema', n,
      titulo: s ? s.titulo : '(tema borrado)',
      vientos: !!(s && s.vientos),
      cantantes: (it.cantantes || []).join(', '),
      musicos: it.musicos,
    });
  }

  /* Marcar los cambios. Se compara contra el tema anterior de verdad,
     salteando bloques y breaks: un break no cambia quién toca. El
     primero no marca nada —no hay contra qué compararlo. */
  let previo = null;
  for (const r of out) {
    if (r.tipo !== 'tema') continue;
    r.cambia = {};
    if (previo) {
      for (const c of COLUMNAS) {
        r.cambia[c.clave] = nombreEn(r.musicos, c.clave) !== nombreEn(previo.musicos, c.clave);
      }
      r.cambiaCanta = r.cantantes !== previo.cantantes;
    }
    r.cuantosCambios = Object.values(r.cambia).filter(Boolean).length;
    previo = r;
  }
  return out;
}

/** La planilla en texto, con tabulaciones: se pega en una hoja de cálculo. */
function comoTexto(jam, filas) {
  const L = [[jam.nombre || 'Jam', ...COLUMNAS.map(c => c.titulo)].join('\t')];
  L[0] = ['#', 'Tema', 'Canta', ...COLUMNAS.map(c => c.titulo)].join('\t');
  for (const r of filas) {
    if (r.tipo === 'corte') { L.push('', r.texto); continue; }
    L.push([r.n || '', r.titulo, r.cantantes || '',
      ...COLUMNAS.map(c => nombreEn(r.musicos, c.clave) || '—')].join('\t'));
  }
  return L.join('\n');
}

export function vistaTecnica(jamId) {
  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver'));
  }

  const filas = renglones(jam);
  const temas = filas.filter(r => r.tipo === 'tema');
  const conCambios = temas.filter(r => r.cuantosCambios > 0).length;

  const tabla = h('table.tec-tabla', {},
    h('thead', {}, h('tr', {},
      h('th.tec-n', {}, '#'),
      h('th.tec-tema', {}, 'Tema'),
      h('th', {}, 'Canta'),
      COLUMNAS.map(c => h('th', {}, c.titulo)))),

    h('tbody', {}, filas.map(r => {
      if (r.tipo === 'corte') {
        return h('tr.tec-corte', {}, h('td', { colSpan: 3 + COLUMNAS.length }, r.texto));
      }
      return h('tr' + (r.dentro ? '.dentro' : ''), {},
        h('td.tec-n', {}, r.n || ''),
        h('td.tec-tema', {},
          r.titulo,
          /* El tema pide vientos pero el puesto está vacío: eso es un
             agujero de la planilla, no un dato de color. */
          r.vientos && !nombreEn(r.musicos, 'saxo')
            ? h('span.tec-falta', { title: 'Lleva vientos y no hay nadie puesto' }, '🎺') : null),
        h('td' + (r.cambiaCanta ? '.cambia' : ''), {}, r.cantantes || '—'),
        COLUMNAS.map(c => {
          const nombre = nombreEn(r.musicos, c.clave);
          return h('td' + (r.cambia[c.clave] ? '.cambia' : '') + (nombre ? '' : '.vacio'), {},
            nombre || '—');
        }));
    })));

  return h('div.tec', {},
    h('div.tec-head', {},
      h('a.btn.sm', { href: `#/jams/${jam.id}/editar` }, '← Volver'),
      h('div', {},
        h('h1', {}, jam.nombre || 'Jam'),
        h('div.dim', {}, [
          jam.fecha ? fechaLinda(jam.fecha) : '',
          `${temas.length} temas`,
          conCambios ? `${conCambios} con cambio de músico` : 'sin cambios de músico',
        ].filter(Boolean).join(' · '))),
      h('div.tec-acciones', {},
        h('button.btn.sm', {
          onclick: () => { copiar(comoTexto(jam, filas)); toast('Copiada — se pega en una planilla', 'ok'); },
        }, '📋 Copiar'),
        h('button.btn.sm', { onclick: () => window.print() }, '🖨 Imprimir'))),

    temas.length
      ? h('div.tec-scroll', {}, tabla)
      : h('div.empty', {}, h('b', {}, 'Esta jam no tiene temas todavía')),

    h('p.tec-pie', {},
      h('span.tec-muestra', {}, 'así'), ' se marca cuando alguien cambia respecto del tema anterior. ',
      'El resto de la planilla es la misma formación de siempre.'));
}
