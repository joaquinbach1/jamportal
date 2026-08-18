/* ============================================================
   views/nueva.js — paso 1: metadatos de la jam
   ============================================================ */

import { store } from '../store.js';
import { h, frag, field, input, personPicker, toast, clear, franjaDot } from '../ui.js';
import { estadoInicial, filtrosMagicList, generarPropuesta, propuestaAItems } from '../magiclist.js';

export function vistaNueva() {
  const datos = {
    nombre: '', fecha: '', hora: '21:00', lugar: 'Portal',
    ensayos: [{ fecha: '', hora: '', horaFin: '', lugar: '', convocados: [] }],
    musicosExtra: [], notas: '',
  };

  /* ---- ensayos ---- */
  const ensayosCont = h('div');
  function pintarEnsayos() {
    clear(ensayosCont);
    datos.ensayos.forEach((e, i) => {
      ensayosCont.appendChild(h('div.rehearsal', {},
        h('input', { type: 'date', value: e.fecha, oninput: ev => e.fecha = ev.target.value }),
        h('input', { type: 'time', value: e.hora, title: 'Desde', oninput: ev => e.hora = ev.target.value }),
        h('span.dim', { style: { flex: 'none', fontSize: '12px' } }, 'a'),
        h('input', { type: 'time', value: e.horaFin, title: 'Hasta', oninput: ev => e.horaFin = ev.target.value }),
        input({ placeholder: 'Dónde ensayan', value: e.lugar, oninput: ev => e.lugar = ev.target.value }),
        h('button.icon-btn.danger', {
          title: 'Quitar ensayo',
          onclick: () => { datos.ensayos.splice(i, 1); if (!datos.ensayos.length) datos.ensayos.push({ fecha: '', hora: '', horaFin: '', lugar: '', convocados: [] }); pintarEnsayos(); },
        }, '✕')));
    });
    ensayosCont.appendChild(h('button.btn.sm.ghost', {
      onclick: () => { datos.ensayos.push({ fecha: '', hora: '', horaFin: '', lugar: '', convocados: [] }); pintarEnsayos(); },
    }, '＋ Otro ensayo'));
  }
  pintarEnsayos();

  /* ---- convocatoria ---- */
  const gente = [
    ...store.cantantes.filter(c => c.activo !== false).map(c => c.nombre),
    ...store.musicos.map(m => m.nombre),
  ];
  const picker = personPicker({
    opciones: [...new Set(gente)].sort((a, b) => a.localeCompare(b)),
    seleccionados: datos.musicosExtra,
    onChange: v => datos.musicosExtra = v,
    placeholder: 'Batería, saxo, invitados… (o escribí uno nuevo)',
  });

  /* ============================================================
     Punto de partida del setlist: vacía, MagicList o copiar otra jam
     ============================================================ */
  let modo = 'vacia';
  const gen = estadoInicial();
  let propuesta = [];

  const anteriores = store.jams.filter(j => (j.items || []).length);
  const copiarDe = h('select', {},
    ...anteriores.map(j => h('option', { value: j.id },
      `${j.nombre} — ${(j.items || []).length} ítems${j.historica ? ' (histórica)' : ''}`)));

  const panelInicio = h('div', { style: { marginTop: '14px' } });

  const botonModo = (id, titulo, bajada) => h('button.modo' + (modo === id ? '.on' : ''), {
    onclick: () => { modo = id; pintarModos(); },
  }, h('b', {}, titulo), h('span', {}, bajada));

  const modos = h('div.modos');

  function pintarModos() {
    clear(modos);
    modos.append(
      botonModo('vacia', 'Lista vacía', 'Arrancás de cero y vas cargando los temas a mano'),
      botonModo('magic', 'MagicList', 'Te genero la lista con filtros de género, tempo y energía'),
      botonModo('base', 'Usar de base otra jam', 'Copia el setlist de una jam anterior para editarlo'),
    );
    pintarPanelInicio();
  }

  function pintarPanelInicio() {
    clear(panelInicio);

    if (modo === 'magic') {
      const preview = h('div.preview-list');
      const btnGen = h('button.btn.sm', {
        onclick: async () => {
          btnGen.disabled = true;
          try { propuesta = await generarPropuesta(gen, new Set(), btnGen); }
          finally { btnGen.disabled = false; }
          pintarPreview();
        },
      }, '🎲 Previsualizar');

      function pintarPreview() {
        clear(preview);
        propuesta.forEach((s, i) => preview.appendChild(h('div.preview-row', {},
          h('span.pv-n', {}, i + 1),
          franjaDot(s.franja),
          h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.titulo),
          s.esWeb ? h('span.chip', {}, '🌐') : null,
          h('span.dim', { style: { fontSize: '11px' } }, s.artista))));
      }

      panelInicio.append(
        // los presets y los toggles necesitan repintar para verse aplicados
        filtrosMagicList(gen, () => pintarPanelInicio()),
        h('div', { style: { marginTop: '12px' } }, btnGen,
          h('span.dim', { style: { fontSize: '11.5px', marginLeft: '10px' } },
            'Opcional: si no previsualizás, la genero al crear la jam.')),
        preview);
      if (propuesta.length) setTimeout(pintarPreview, 0);
      return;
    }

    if (modo === 'base') {
      panelInicio.append(anteriores.length
        ? field('Copiar el setlist de', copiarDe)
        : h('div.method-hint', {}, 'Todavía no hay ninguna jam con temas para copiar.'));
      return;
    }

    panelInicio.append(h('div.method-hint', {},
      'La jam se crea con la lista en blanco. Después la armás con el buscador, arrastrando temas o con MagicList.'));
  }

  pintarModos();

  /* ---- crear ---- */
  const nombreInput = input({ placeholder: 'JAM de Septiembre, JAM Bizarra, JAM 90s…', autofocus: true });
  const btnCrear = h('button.btn.primary', { onclick: () => crear(btnCrear) }, 'Crear jam y armar la lista →');

  async function crear(btn) {
    const nombre = nombreInput.value.trim();
    if (!nombre) { toast('Poné un nombre para la jam', 'err'); nombreInput.focus(); return; }

    let items = [];
    if (modo === 'base' && copiarDe.value) {
      const base = store.jam(copiarDe.value);
      if (base) items = structuredClone(base.items || []);
    } else if (modo === 'magic') {
      btn.disabled = true;
      try {
        if (!propuesta.length) propuesta = await generarPropuesta(gen, new Set(), btn);
        items = propuestaAItems(propuesta);
      } finally { btn.disabled = false; btn.textContent = 'Crear jam y armar la lista →'; }
    }

    const jam = store.createJam({
      nombre,
      fecha: datos.fecha, hora: datos.hora, lugar: datos.lugar,
      ensayos: datos.ensayos.filter(e => e.fecha || e.lugar),
      musicosExtra: datos.musicosExtra,
      musicos: [...datos.musicosExtra],
      notas: datos.notas,
      items,
    });
    toast('Jam creada — ahora armá la lista', 'ok');
    location.hash = '#/jams/' + jam.id;
  }

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Armar nueva Jam'),
        h('p.sub', {}, 'Primero los datos. Después armás la lista de temas con el método que quieras.')),
      h('div.page-actions', {}, h('a.btn.ghost', { href: '#/jams' }, 'Cancelar'))),

    h('div', { style: { maxWidth: '820px' } },
      h('div.card', {},
        h('div.card-head', {}, h('h3', {}, '1 · Datos de la jam')),
        h('div.meta-grid', {},
          field('Nombre de la jam', nombreInput),
          field('Fecha', h('input', { type: 'date', oninput: e => datos.fecha = e.target.value })),
          field('Horario', h('input', { type: 'time', value: datos.hora, oninput: e => datos.hora = e.target.value }))),
        h('div', { style: { marginTop: '12px' } },
          field('Lugar', input({ value: datos.lugar, placeholder: 'Portal, Makena, Serena…', oninput: e => datos.lugar = e.target.value })))),

      h('div.card', {},
        h('div.card-head', {}, h('h3', {}, '2 · Ensayos'),
          h('span.dim', { style: { fontSize: '12px' } }, 'la convocatoria de cada uno se arma después, en la jam')),
        ensayosCont),

      h('div.card', {},
        h('div.card-head', {}, h('h3', {}, '3 · Músicos que no cantan'),
          h('span.dim', { style: { fontSize: '12px' } }, 'los cantantes salen solos de la lista de temas')),
        h('div.method-hint', {}, 'Batería, saxo, caños, invitados. A los cantantes los convocás asignándolos a cada tema en la lista, y la convocatoria se arma sola.'),
        picker),

      h('div.card', {},
        h('div.card-head', {}, h('h3', {}, '4 · Punto de partida del setlist')),
        modos,
        panelInicio),

      h('div.card', {},
        field('Notas', h('textarea', { placeholder: 'Temática, invitados, cosas a tener en cuenta…', oninput: e => datos.notas = e.target.value }))),

      h('div', { style: { display: 'flex', gap: '10px', marginTop: '18px' } },
        btnCrear,
        h('a.btn.ghost', { href: '#/jams' }, 'Cancelar'))),
  );
}
