/* ============================================================
   views/songs.js — DBSongs: la base de canciones
   ============================================================ */

import { store, norm, FRANJA_LABEL } from '../store.js';
import { h, frag, clear, poner, select, catPill, catCorta, franjaDot, toast, debounce, modal, songAutocomplete } from '../ui.js';
import { dialogoCancion } from './song-form.js';
import { botonCifra } from './jam-editor.js';
import { chipTempo } from '../tempo.js';
import { buscarEnWeb, webAResultado } from '../lookup.js';

/* la última jam elegida como destino se recuerda entre visitas */
let ultimoDestino = null;

export function vistaSongs() {
  const f = { q: '', categoria: '', franja: '', cantante: '', historial: '' };
  let orden = { campo: 'artista', dir: 1 };

  const cuerpo = h('tbody');
  const contador = h('span.count');
  const barraEnvio = h('div.enviar');
  const seleccion = new Set();

  /* Solo se puede mandar temas a una jam en preparación: las históricas son
     el registro de lo que ya pasó y no se tocan desde acá. */
  const enPreparacion = () => store.jams.filter(j => !j.historica);

  function agregarA(jamId, songs) {
    const jam = store.jam(jamId);
    if (!jam || jam.historica || !songs.length) return;
    jam.items = [...(jam.items || []),
      ...songs.map(s => ({ tipo: 'song', songId: s.id, cantantes: [], notas: '' }))];
    store.commit();
    seleccion.clear();
    pintar();
    toast(songs.length === 1
      ? `«${songs[0].titulo}» agregada a ${jam.nombre}`
      : `${songs.length} temas agregados a ${jam.nombre}`, 'ok');
  }

  function pintarBarra() {
    clear(barraEnvio);
    const jams = enPreparacion();

    if (!jams.length) {
      barraEnvio.appendChild(h('div.method-hint', {},
        'Para mandar temas a una jam primero creá una — las históricas no se modifican desde acá. ',
        h('a', { href: '#/nueva', style: { color: 'var(--acc)', textDecoration: 'underline' } }, 'Armar nueva Jam')));
      return;
    }

    if (!ultimoDestino || !jams.some(j => j.id === ultimoDestino)) ultimoDestino = jams[0].id;

    const sel = select(jams.map(j => ({
      value: j.id,
      label: `${j.nombre || 'Jam sin nombre'} (${(j.items || []).length})`,
    })), { value: ultimoDestino, onchange: e => { ultimoDestino = e.target.value; pintarBarra(); } });

    const elegidos = [...seleccion].map(id => store.song(id)).filter(Boolean);

    poner(barraEnvio,
      h('span.dim', { style: { fontSize: '12.5px' } }, 'Agregar a'),
      h('div', { style: { flex: '0 1 260px' } }, sel),
      elegidos.length
        ? h('button.btn.sm.primary', { onclick: () => agregarA(ultimoDestino, elegidos) },
            `＋ Agregar ${elegidos.length} tema${elegidos.length > 1 ? 's' : ''}`)
        : h('span.dim', { style: { fontSize: '11.5px' } },
            'Tildá los temas de la lista, o usá el ＋ de cada fila'),
      elegidos.length
        ? h('button.btn.sm.ghost', { onclick: () => { seleccion.clear(); pintar(); } }, 'Limpiar')
        : null);
  }

  function filtrar() {
    let res = store.repertorio;
    if (f.q) {
      const n = norm(f.q);
      res = res.filter(s => norm(s.titulo).includes(n) || norm(s.artista).includes(n) || (s.cantantes || []).some(c => norm(c).includes(n)));
    }
    if (f.categoria) res = res.filter(s => s.categoria === f.categoria);
    if (f.franja) res = res.filter(s => s.franja === f.franja);
    if (f.cantante) res = res.filter(s => (s.cantantes || []).includes(f.cantante));
    if (f.historial === 'tocados') res = res.filter(s => (s.jams || []).length);
    if (f.historial === 'nuevos') res = res.filter(s => !(s.jams || []).length);

    const dir = orden.dir;
    const val = s => {
      switch (orden.campo) {
        case 'titulo': return norm(s.titulo);
        case 'bpm': return s.bpm || 0;
        case 'jams': return (s.jams || []).length;
        case 'cifra': return s.cifraUrl ? 1 : 0;
        case 'categoria': return s.categoria || '';
        default: return norm(s.artista) + ' ' + norm(s.titulo);
      }
    };
    return [...res].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }

  function pintar() {
    const res = filtrar();
    clear(cuerpo);
    contador.textContent = `${res.length} / ${store.repertorio.length}`;

    if (!res.length) {
      cuerpo.appendChild(h('tr', {}, h('td', { colspan: 10 },
        h('div.empty', { style: { border: 'none' } }, h('b', {}, 'Nada con esos filtros')))));
      pintarBarra();
      return;
    }

    res.forEach(s => {
      cuerpo.appendChild(h('tr' + (seleccion.has(s.id) ? '.elegida' : ''), { onclick: () => dialogoCancion(s, () => pintar()) },
        h('td.col-check', { onclick: e => e.stopPropagation() },
          h('input', {
            type: 'checkbox', checked: seleccion.has(s.id), style: { width: 'auto' },
            onchange: e => { e.target.checked ? seleccion.add(s.id) : seleccion.delete(s.id); pintar(); },
          })),
        h('td', {}, h('div.t-title', {}, s.titulo),
          (s.notas || '') ? h('div.dim', { style: { fontSize: '11px' } }, s.notas) : null),
        h('td.t-art', {}, s.artista),
        h('td', {}, catPill(s.categoria)),
        h('td', { onclick: e => e.stopPropagation() },
          chipTempo(s, pintar),
          s.bpmRaw ? h('span.dim', { title: 'Dos mediciones en el doc original', style: { fontSize: '10px' } }, ' *') : null),
        h('td', {}, s.franja ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, franjaDot(s.franja), s.franja) : h('span.dim', {}, '—')),
        h('td', {}, (s.cantantes || []).length
          ? h('div.chips', {}, s.cantantes.slice(0, 3).map(c => h('span.chip', {}, c)), s.cantantes.length > 3 ? h('span.chip', {}, '+' + (s.cantantes.length - 3)) : null)
          : h('span.dim', {}, '—')),
        h('td.mono', { title: (s.jams || []).join('\n') }, (s.jams || []).length || h('span.dim', {}, '0')),
        h('td', { onclick: e => e.stopPropagation() }, botonCifra(s, pintar)),
        h('td', { onclick: e => e.stopPropagation() },
          h('button.icon-btn', {
            title: 'Agregar este tema a la jam elegida arriba',
            disabled: !enPreparacion().length,
            onclick: () => agregarA(ultimoDestino, [s]),
          }, '＋')),
      ));
    });
    pintarBarra();
  }

  const th = (label, campo) => h('th' + (campo ? '.sortable' : ''), {
    onclick: campo ? () => { orden = { campo, dir: orden.campo === campo ? -orden.dir : 1 }; pintar(); } : null,
  }, label + (orden.campo === campo ? (orden.dir > 0 ? ' ↑' : ' ↓') : ''));

  const buscador = h('input', { type: 'search', placeholder: 'Buscar tema, artista o cantante…' });
  buscador.addEventListener('input', debounce(() => { f.q = buscador.value; pintar(); }, 120));

  const cantantesConTemas = [...new Set(store.repertorio.flatMap(s => s.cantantes || []))].sort((a, b) => a.localeCompare(b));

  /* --- alta rápida con búsqueda en internet --- */
  function altaRapida() {
    const ac = songAutocomplete({
      placeholder: 'Nombre del tema… lo busco en DBSongs y en internet',
      buscar: q => store.searchSongs(q, 8),
      onPick: s => { toast(`«${s.titulo}» ya está en DBSongs`); dialogoCancion(s, () => pintar()); },
      buscarWeb: buscarEnWeb,
      onPickWeb: r => dialogoCancion(webAResultado(r), () => pintar()),
      onNew: q => dialogoCancion({ titulo: q }, () => pintar()),
    });
    const m = modal({
      title: 'Agregar tema a DBSongs',
      body: [h('div.method-hint', {}, 'Escribí el nombre: si no está en la base, lo busco en internet y traigo banda, género y año.'), ac],
      footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cerrar')],
    });
    setTimeout(() => ac.focusInput && ac.focusInput(), 80);
  }

  pintar();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Canciones DB'),
        h('p.sub', {}, `${store.repertorio.length} temas tocados · ${store.artistas().length} artistas · ${store.repertorio.filter(s => s.bpm).length} con tempo` + (store.ideas.length ? ` · ${store.ideas.length} ideas sin tocar` : ''))),
      h('div.page-actions', {},
        h('button.btn.primary', { onclick: altaRapida }, '＋ Agregar tema'),
        h('a.btn.ghost', { href: '#/data' }, 'Importar / exportar'))),

    h('div.filters', {},
      h('div.search', {}, buscador),
      select([{ value: '', label: 'Todas las categorías' }, ...store.categorias.map(c => ({ value: c, label: catCorta(c) }))],
        { onchange: e => { f.categoria = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Toda franja' },
        { value: 'low', label: FRANJA_LABEL.low }, { value: 'mid', label: FRANJA_LABEL.mid }, { value: 'high', label: FRANJA_LABEL.high }],
        { onchange: e => { f.franja = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Cualquier cantante' }, ...cantantesConTemas.map(c => ({ value: c, label: c }))],
        { onchange: e => { f.cantante = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Todo el historial' }, { value: 'tocados', label: 'Ya tocados' }, { value: 'nuevos', label: 'Nunca tocados' }],
        { onchange: e => { f.historial = e.target.value; pintar(); } }),
      contador),

    barraEnvio,

    h('div.tbl-wrap', {},
      h('table.tbl', {},
        h('thead', {}, h('tr', {},
          h('th.col-check', {}), th('Tema', 'titulo'), th('Artista', 'artista'), th('Cat.', 'categoria'),
          th('BPM', 'bpm'), th('Franja'), th('Cantantes'), th('Jams', 'jams'), th('Cifra', 'cifra'), h('th', {}))),
        cuerpo)),

    store.porConfirmar.length ? h('div.card', { style: { marginTop: '18px' } },
      h('div.card-head', {}, h('h3', {}, 'Por confirmar'),
        h('span.dim', { style: { fontSize: '12px' } }, 'venían sin artista claro en el documento original')),
      h('div.chips', {}, store.porConfirmar.map(t => h('span.chip', {}, t)))) : null,
  );
}
