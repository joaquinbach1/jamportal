/* ============================================================
   views/jams.js — listado de jams (próximas + históricas)
   ============================================================ */

import { store } from '../store.js';
import { h, frag, clear, fechaLinda, confirmar, toast, modal, field, input } from '../ui.js';
import { refrescar } from '../app.js';

/* ============================================================
   Edición rápida de nombre / fecha / lugar
   ------------------------------------------------------------
   Las jams históricas vienen sin fecha: el nombre suele traerla
   ("JAM Nostalgia 15/8"), así que la ofrecemos precargada y solo
   hay que elegir el año.
   ============================================================ */
export function dialogoDatosJam(jam, onOk) {
  const fNombre = input({ value: jam.nombre || '', placeholder: 'Nombre de la jam' });
  const fFecha  = h('input', { type: 'date', value: jam.fecha || '' });
  const fHora   = h('input', { type: 'time', value: jam.hora || '' });
  const fLugar  = input({ value: jam.lugar || '', placeholder: 'Makena, Serena, casa de…' });

  /* sugerencia de fecha a partir del día/mes que trae el nombre */
  let pista = null;
  if (!jam.fecha && jam.mes) {
    const dia = jam.dia || 1;
    const hoy = new Date().getFullYear();
    const dosDig = n => String(n).padStart(2, '0');
    pista = h('div.method-hint', {},
      `El nombre dice ${jam.dia ? `${jam.dia}/${jam.mes}` : `mes ${jam.mes}`}. ¿De qué año fue?`,
      h('div.seg', { style: { marginTop: '8px' } },
        [hoy, hoy - 1, hoy - 2].map(anio =>
          h('button', {
            onclick: () => { fFecha.value = `${anio}-${dosDig(jam.mes)}-${dosDig(dia)}`; },
          }, `${jam.dia ? `${jam.dia}/${jam.mes}/` : ''}${anio}`))));
  }

  const m = modal({
    title: 'Datos de la jam',
    body: [
      field('Nombre', fNombre),
      pista,
      h('div.grid-2', {}, field('Fecha', fFecha), field('Horario', fHora)),
      field('Lugar', fLugar),
    ],
    footer: [
      h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
      h('button.btn.primary', {
        onclick: () => {
          const nombre = fNombre.value.trim();
          if (!nombre) { toast('Falta el nombre', 'err'); fNombre.focus(); return; }
          store.updateJam(jam.id, { nombre, fecha: fFecha.value, hora: fHora.value, lugar: fLugar.value.trim() });
          m.close(); toast('Guardado', 'ok');
          onOk && onOk();
        },
      }, 'Guardar'),
    ],
  });
  setTimeout(() => fNombre.focus(), 60);
  return m;
}

function contarItems(jam) {
  let temas = 0, breaks = 0, medleys = 0, bloques = 0;
  for (const it of jam.items || []) {
    if (it.tipo === 'break') breaks++;
    else if (it.tipo === 'bloque') bloques++;
    else if (it.tipo === 'medley') { medleys++; temas += (it.songs || []).length; }
    else temas++;
  }
  return { temas, breaks, medleys, bloques };
}

function barraFranjas(jam) {
  const cuenta = { low: 0, mid: 0, high: 0, none: 0 };
  for (const it of jam.items || []) {
    if (it.tipo === 'bloque' || it.tipo === 'break') continue;
    const ids = it.tipo === 'medley' ? (it.songs || []).map(s => s.songId) : [it.songId];
    for (const id of ids) {
      const s = store.song(id);
      cuenta[(s && s.franja) || 'none']++;
    }
  }
  const total = Object.values(cuenta).reduce((a, b) => a + b, 0) || 1;
  return h('div.jc-bar', {},
    ['low', 'mid', 'high', 'none'].map(k => cuenta[k]
      ? h('div', { style: { flex: cuenta[k], background: k === 'none' ? 'var(--rayado)' : `var(--${k})` }, title: `${k}: ${cuenta[k]}` })
      : null));
}

function tarjeta(jam, onCambio) {
  const { temas, breaks, medleys } = contarItems(jam);
  return h('div.jam-card' + (jam.historica ? '.hist' : ''), {
    onclick: () => location.hash = '#/jams/' + jam.id,
  },
    h('div.jc-tools', {},
      // las históricas están cerradas: se abren desde adentro, a propósito
      jam.historica
        ? h('span.jc-tag', { title: 'Cerrada: es el registro de lo que se tocó' }, '🔒 histórica')
        : h('button.icon-btn', {
            title: 'Editar nombre y fecha',
            onclick: e => { e.stopPropagation(); dialogoDatosJam(jam, onCambio); },
          }, '✎')),
    h('h3', {}, jam.nombre || 'Jam sin nombre'),
    h('div.jc-date', {}, jam.fecha ? fechaLinda(jam.fecha) + (jam.hora ? ' · ' + jam.hora : '') : (jam.historica ? 'Sin fecha registrada' : 'Sin fecha')),
    h('div.jc-meta', {},
      h('span', {}, h('b', {}, temas), ' temas'),
      medleys ? h('span', {}, h('b', {}, medleys), ' medley' + (medleys > 1 ? 's' : '')) : null,
      breaks ? h('span', {}, h('b', {}, breaks), ' break' + (breaks > 1 ? 's' : '')) : null,
      (jam.musicos || []).length ? h('span', {}, h('b', {}, jam.musicos.length), ' músicos') : null),
    barraFranjas(jam),
  );
}

export function vistaJams() {
  const gridProx = h('div.jam-grid');
  const gridHist = h('div.jam-grid');
  const resumen = h('p.sub');
  const vacío = h('div');

  /** Las que tienen fecha primero (más recientes arriba); el resto por tamaño. */
  const ordenar = arr => [...arr].sort((a, b) => {
    if (a.fecha && b.fecha) return b.fecha.localeCompare(a.fecha);
    if (a.fecha) return -1;
    if (b.fecha) return 1;
    return (b.items || []).length - (a.items || []).length;
  });

  function pintar() {
    const proximas = ordenar(store.jams.filter(j => !j.historica));
    const historicas = ordenar(store.jams.filter(j => j.historica));

    resumen.textContent = `${proximas.length} en preparación · ${historicas.length} históricas · ${store.repertorio.length} temas en Canciones DB`;

    clear(gridProx);
    proximas.forEach(j => gridProx.appendChild(tarjeta(j, pintar)));
    gridProx.style.display = proximas.length ? '' : 'none';

    clear(vacío);
    if (!proximas.length) {
      vacío.appendChild(h('div.empty', {},
        h('b', {}, 'Todavía no armaste ninguna jam nueva'),
        h('div', {}, 'Empezá cargando nombre, fecha y a quién convocás.'),
        h('a.btn.primary', { href: '#/nueva', style: { marginTop: '14px' } }, '＋ Armar nueva Jam')));
    }

    clear(gridHist);
    historicas.forEach(j => gridHist.appendChild(tarjeta(j, pintar)));
  }

  pintar();

  return frag(
    h('div.page-head', {},
      h('div', {}, h('h1', {}, 'Jams'), resumen),
      h('div.page-actions', {},
        h('a.btn.primary', { href: '#/nueva' }, '＋ Armar nueva Jam'))),

    h('h2.sec', {}, 'En preparación'),
    vacío,
    gridProx,

    store.jams.some(j => j.historica) ? h('div', { style: { marginTop: '32px' } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '12px' } },
        h('h2.sec', { style: { margin: 0 } }, 'Jams anteriores'),
        h('span.dim', { style: { fontSize: '12px' } }, 'cerradas para no romper el registro · duplicalas para usarlas de base')),
      gridHist) : null,
  );
}

/** Acciones compartidas con el editor. */
export async function borrarJam(jam) {
  const ok = await confirmar(`¿Borrar «${jam.nombre || 'sin nombre'}»? No se puede deshacer.`, { titulo: 'Borrar jam' });
  if (!ok) return false;
  store.removeJam(jam.id);
  toast('Jam borrada');
  location.hash = '#/jams';
  refrescar();
  return true;
}
