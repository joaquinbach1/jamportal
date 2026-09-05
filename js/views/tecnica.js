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

   Y durante la jam se toca cada tema que ya pasó: queda apagado,
   así se ve de un vistazo por dónde va la noche sin perder el
   renglón. Se guarda en este equipo, no en la base: es cómo va
   siguiendo la lista quien la mira, no un dato de la banda.

   La nota técnica sí va a la base, y es una tercera nota: no es
   la de la banda ni la de cada uno. Acá se anota lo que pasa
   fuera del escenario.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, poner, toast, fechaLinda, copiar, modal } from '../ui.js';

/* Los que ya pasaron, por jam. Se guardan por número y no por tema: es
   una marca de por dónde va la lista esta noche, y si mañana se
   reordena la jam, la marca ya no quiere decir nada. Por eso también
   está el botón de limpiar. */
const CLAVE_PASADOS = 'jamportal.tecnica.pasados';

function pasadosDe(jamId) {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE_PASADOS) || '{}')[jamId] || []); }
  catch { return new Set(); }
}

function guardarPasados(jamId, set) {
  let todo = {};
  try { todo = JSON.parse(localStorage.getItem(CLAVE_PASADOS) || '{}'); } catch { /* vacío */ }
  if (set.size) todo[jamId] = [...set]; else delete todo[jamId];
  try { localStorage.setItem(CLAVE_PASADOS, JSON.stringify(todo)); } catch { /* lleno */ }
}

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
  (jam.items || []).forEach((it, i) => {
    if (it.tipo === 'bloque') { out.push({ tipo: 'corte', texto: (it.label || 'BLOQUE').toUpperCase() }); return; }
    if (it.tipo === 'break') { out.push({ tipo: 'corte', texto: `BREAK ${it.minutos || ''}′`.trim() }); return; }

    if (it.tipo === 'medley') {
      /* El medley encabeza pero no se lleva un número: los números son
         de los temas, y adentro del medley se tocan uno por uno. */
      out.push({ tipo: 'corte', texto: `MEDLEY ${it.titulo || ''}`.trim() });
      for (const ms of it.songs || []) {
        const s = store.song(ms.songId);
        n++;
        out.push({
          tipo: 'tema', dentro: true, n, i, k: (it.songs || []).indexOf(ms),
          songId: ms.songId,
          titulo: s ? s.titulo : '(tema borrado)',
          vientos: !!(s && s.vientos),
          cantantes: (ms.cantantes || []).join(', '),
          musicos: ms.musicos,
          nota: ms.notaTecnica || '',
        });
      }
      return;
    }

    if (it.tipo !== 'song') return;
    n++;
    const s = store.song(it.songId);
    out.push({
      tipo: 'tema', n, i, k: null,
      songId: it.songId,
      titulo: s ? s.titulo : '(tema borrado)',
      vientos: !!(s && s.vientos),
      cantantes: (it.cantantes || []).join(', '),
      musicos: it.musicos,
      nota: it.notaTecnica || '',
    });
  });

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
  L[0] = ['#', 'Tema', 'Canta', ...COLUMNAS.map(c => c.titulo), 'Nota técnica'].join('\t');
  for (const r of filas) {
    if (r.tipo === 'corte') { L.push('', r.texto); continue; }
    L.push([r.n || '', r.titulo, r.cantantes || '',
      ...COLUMNAS.map(c => nombreEn(r.musicos, c.clave) || '—'),
      (r.nota || '').replace(/\n/g, ' ')].join('\t'));
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

  const pasados = pasadosDe(jamId);
  const cont = h('div.tec');

  /* El ítem se busca contra el store al momento de escribir, no al de
     dibujar: entre que se abre la ventana y se guarda pudo entrar una
     sincronización, y el store reemplaza las jams por objetos nuevos. */
  const alDia = () => store.jam(jamId) || jam;
  const traer = r => {
    const it = (alDia().items || [])[r.i];
    if (!it) return null;
    return r.k == null ? it : (it.songs || [])[r.k];
  };

  /* ============================================================
     La nota técnica
     ------------------------------------------------------------
     Es una tercera nota, distinta de las dos que ya había, y por
     eso vive en su propia columna:

       la de la banda    lo musical, «corte seco al final»
       la tuya           la de cada uno, con su mail
       esta              lo que pasa fuera del escenario: canal
                         del saxo, monitores, luces, playback

     Meterlas en la misma era perder las dos. Quien lee la
     planilla técnica no quiere leer «entro en el segundo
     estribillo», y quien canta no quiere leer «monitor 3 al 60».
     ============================================================ */
  function dialogoNota(r) {
    const area = h('textarea', {
      value: (traer(r) || {}).notaTecnica || '',
      placeholder: 'Saxo por el canal 7 · monitores arriba en el estribillo · arranca a oscuras…',
      style: { minHeight: '110px' },
    });

    const m = modal({
      title: `Nota técnica de « ${r.titulo} »`,
      body: [
        h('div.method-hint', {},
          'Lo que hay que hacer fuera del escenario. La ve toda la banda y ',
          'sale impresa en la planilla, debajo del título.'),
        h('div', { style: { marginTop: '12px' } }, area),
      ],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        h('button.btn.primary', {
          onclick: () => {
            /* El ítem se busca recién ahora: entre que se abrió la
               ventana y se aprieta Guardar pudo entrar una sync. */
            const it = traer(r);
            if (it) { it.notaTecnica = area.value.trim(); r.nota = it.notaTecnica; store.commit(); }
            m.close(); pintar();
            toast(area.value.trim() ? 'Nota guardada' : 'Nota borrada', 'ok');
          },
        }, 'Guardar'),
      ],
    });
    setTimeout(() => area.focus(), 60);
  }

  function tabla() {
    return h('table.tec-tabla', {},
      h('thead', {}, h('tr', {},
        h('th.tec-nota', {}, ''),
        h('th.tec-n', {}, '#'),
        h('th.tec-tema', {}, 'Tema'),
        h('th', {}, 'Canta'),
        COLUMNAS.map(c => h('th', {}, c.titulo)))),

      h('tbody', {}, filas.map(r => {
        if (r.tipo === 'corte') {
          return h('tr.tec-corte', {}, h('td', { colSpan: 4 + COLUMNAS.length }, r.texto));
        }
        const tr = h('tr' + (r.dentro ? '.dentro' : '') + (pasados.has(r.n) ? '.pasado' : ''), {
          title: pasados.has(r.n) ? 'Ya pasó — tocá para desmarcarlo' : 'Tocá cuando el tema ya pasó',
          onclick: () => {
            if (pasados.has(r.n)) pasados.delete(r.n); else pasados.add(r.n);
            guardarPasados(jamId, pasados);
            pintar();
          },
        });
        const hay = !!r.nota;
        return poner(tr,
          h('td.tec-nota', {},
            h('button.tec-nota-btn' + (hay ? '.tiene' : ''), {
              title: hay ? r.nota : 'Escribir una nota técnica',
              /* sin esto el clic también marcaría el tema como pasado */
              onclick: e => { e.stopPropagation(); dialogoNota(r); },
            }, '📝')),
          h('td.tec-n', {}, r.n || ''),
          h('td.tec-tema', {},
            r.titulo,
            /* En papel el ícono no dice nada: ahí va el texto. */
            r.nota ? h('span.tec-nota-papel', {}, r.nota) : null,
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
  }

  function pintar() {
    clear(cont);
    poner(cont,
      h('div.tec-head', {},
        h('a.btn.sm', { href: `#/jams/${jam.id}/editar` }, '← Volver'),
        h('div.tec-titulo', {},
          h('h1', {}, jam.nombre || 'Jam'),
          h('div.dim', {}, [
            jam.fecha ? fechaLinda(jam.fecha) : '',
            `${temas.length} temas`,
            conCambios ? `${conCambios} con cambio de músico` : 'sin cambios de músico',
            pasados.size ? `${pasados.size} ya pasaron` : '',
          ].filter(Boolean).join(' · '))),
        h('div.tec-acciones', {},
          /* Limpiar solo aparece si hay algo que limpiar: el resto de las
             noches el botón sería ruido. */
          pasados.size
            ? h('button.btn.sm', {
                onclick: () => { pasados.clear(); guardarPasados(jamId, pasados); pintar(); },
              }, '↺ Empezar de nuevo')
            : null,
          h('button.btn.sm', {
            onclick: () => { copiar(comoTexto(jam, filas)); toast('Copiada — se pega en una planilla', 'ok'); },
          }, '📋 Copiar'),
          h('button.btn.sm', { onclick: () => window.print() }, '🖨 Imprimir'))),

      temas.length
        ? h('div.tec-scroll', {}, tabla())
        : h('div.empty', {}, h('b', {}, 'Esta jam no tiene temas todavía')),

      h('p.tec-pie', {},
        h('span.tec-muestra', {}, 'así'), ' se marca cuando alguien cambia respecto del tema anterior. ',
        'Tocá un renglón para apagarlo cuando el tema ya pasó.'));
  }

  pintar();
  return cont;
}
