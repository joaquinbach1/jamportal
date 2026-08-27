/* ============================================================
   views/ideas.js — Ideas: temas que todavía no tocamos
   ------------------------------------------------------------
   El cuaderno de temas anotados para probar. Se cargan por
   nombre y la app completa sola artista, categoría, año y
   tempo (siempre marcado como sugerido). Cuando una idea entra
   a una lista, deja de ser idea y pasa a ser repertorio.
   ============================================================ */

import { store, norm } from '../store.js';
import {
  h, frag, clear, modal, field, input, select, toast, confirmar,
  catPill, catCorta, franjaDot, debounce, descargar, poner,
} from '../ui.js';
import { buscarEnWeb, webAResultado } from '../lookup.js';
import { songAutocomplete } from '../ui.js';
import { chipTempo, asegurarTempo } from '../tempo.js';
import { dialogoCancion } from './song-form.js';
import { botonCifra } from './jam-editor.js';
import { refrescar } from '../app.js';

/* ============================================================
   Alta de una idea: nombre → metadata completa
   ============================================================ */

/**
 * Anota un tema en Ideas y le busca el tempo sin bloquear.
 * La usan el diálogo de acá y el buscador del celular.
 */
export async function anotarIdea(datos, alGuardar = () => {}) {
  const song = store.addSong({ ...datos, esIdea: true });
  alGuardar(song);
  toast(`«${song.titulo}» anotada en Ideas`, 'ok');

  if (!song.bpm) {                                   // el tempo llega solo, sin bloquear
    toast('Buscando el tempo…');
    await asegurarTempo(song, { alTerminar: s => {
      toast(s.bpm ? `Tempo sugerido para «${s.titulo}»: ${s.bpm} bpm` : `Sin tempo para «${s.titulo}»`,
        s.bpm ? 'ok' : '');
      alGuardar(s);
    } });
  }
}

/**
 * @param {function} alGuardar   recibe la idea creada
 * @param {object}  [opts]
 * @param {boolean} [opts.simple] En el celular no se abre el formulario
 *   largo: si el tema no aparece ni en la base ni en internet, se anota
 *   con el texto tal como se escribió y listo. Los datos que falten se
 *   completan después, desde la compu.
 */
export function dialogoNuevaIdea(alGuardar, { simple = false } = {}) {
  const estado = h('div.method-hint', {},
    'Escribí el nombre del tema. Lo busco en internet y completo artista, categoría y año; ',
    'el tempo lo traigo aparte y queda marcado como sugerido hasta que lo confirmes vos.');

  const alta = datos => anotarIdea(datos, alGuardar);

  const ac = songAutocomplete({
    placeholder: 'Nombre del tema…',
    buscar: q => store.searchSongs(q, 6),
    onPick: s => {
      if (s.esIdea) { toast(`«${s.titulo}» ya está en Ideas`); return; }
      toast(`«${s.titulo}» ya está en el repertorio: se tocó ${(s.jams || []).length} vez(ces)`, 'err');
    },
    buscarWeb: buscarEnWeb,
    onPickWeb: r => { m.close(); alta(webAResultado(r)); },
    onNew: q => {
      m.close();
      if (simple) { alta({ titulo: q, artista: '' }); return; }
      dialogoCancion({ titulo: q, esIdea: true }, s => s && alGuardar && alGuardar(s));
    },
  });

  const m = modal({
    title: 'Nueva idea',
    body: [estado, ac],
    footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cerrar')],
  });
  setTimeout(() => ac.focusInput && ac.focusInput(), 80);
  return m;
}

/* ============================================================
   Vista
   ============================================================ */
/* la jam elegida como destino se recuerda entre visitas */
let ultimoDestino = null;

export function vistaIdeas() {
  let q = '', cat = '';
  const grid = h('div.ideas-grid');
  const contador = h('span.count');
  const barraEnvio = h('div.enviar');

  const enPreparacion = () => store.jams.filter(j => !j.historica);

  /** Suma la idea al setlist de una jam. Sigue siendo idea hasta que la jam pase. */
  function aLaJam(idea) {
    const jam = store.jam(ultimoDestino);
    if (!jam || jam.historica) return;
    jam.items = [...(jam.items || []),
      { tipo: 'song', songId: idea.id, cantantes: [], notas: '' }];
    store.commit();
    pintar();
    toast(`«${idea.titulo}» sumada a ${jam.nombre} — sigue en Ideas hasta que la jam pase`, 'ok');
  }

  function pintarBarra() {
    clear(barraEnvio);
    const jams = enPreparacion();
    if (!jams.length) {
      barraEnvio.appendChild(h('div.method-hint', {},
        'Las ideas se prueban en una jam: creá una y acá vas a poder mandarlas directo. ',
        h('a', { href: '#/nueva', style: { color: 'var(--acc)', textDecoration: 'underline' } }, 'Armar nueva Jam')));
      return;
    }
    if (!ultimoDestino || !jams.some(j => j.id === ultimoDestino)) ultimoDestino = jams[0].id;

    poner(barraEnvio,
      h('span.dim', { style: { fontSize: '12.5px' } }, 'Probar en'),
      h('div', { style: { flex: '0 1 260px' } },
        select(jams.map(j => ({ value: j.id, label: `${j.nombre || 'Jam sin nombre'} (${(j.items || []).length})` })),
          { value: ultimoDestino, onchange: e => { ultimoDestino = e.target.value; pintarBarra(); } })),
      h('span.dim', { style: { fontSize: '11.5px' } }, 'y usá el 🎵 de cada idea'));
  }

  function tarjeta(s) {
    return h('div.idea-card', {},
      h('div.idea-top', {},
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div.idea-titulo', {}, s.titulo),
          h('div.idea-artista', {}, s.artista + (s.anio ? ` · ${s.anio}` : ''))),
        catPill(s.categoria)),

      h('div.idea-meta', {},
        franjaDot(s.franja),
        chipTempo(s, pintar),
        s.generoWeb ? h('span.chip', {}, s.generoWeb) : null,
        (s.cantantes || []).length ? h('span.chip.sel', {}, '🎤 ' + s.cantantes.join(', ')) : null),

      s.notas ? h('div.idea-notas', {}, s.notas) : null,

      // si ya está en el setlist de una jam que todavía no pasó
      (() => {
        const prog = store.programadoEn(s.id);
        if (!prog.length) return null;
        return h('div.idea-programada', {},
          '📅 en ',
          prog.map((j, i) => frag(
            i ? ', ' : '',
            h('a', { href: '#/jams/' + j.id }, j.nombre || 'jam sin nombre'),
            j.fecha ? ` (${j.fecha.split('-').reverse().slice(0, 2).join('/')})` : ' (sin fecha)')),
          h('div.dim', { style: { fontSize: '10.5px', marginTop: '3px' } },
            'Pasa al repertorio sola cuando esa fecha quede atrás'));
      })(),

      h('div.idea-acciones', {},
        botonCifra(s, pintar),
        h('button.icon-btn', { title: 'Editar la idea', onclick: () => dialogoCancion(s, pintar) }, '✎'),
        enPreparacion().length
          ? h('button.btn.xs', {
              title: 'Sumarla al setlist de la jam elegida arriba',
              style: { marginLeft: 'auto' },
              onclick: () => aLaJam(s),
            }, '🎵 A la jam')
          : null,
        h('button.btn.xs.ghost', {
          title: 'Pasarla al repertorio ahora, sin esperar a que se toque',
          onclick: () => {
            store.promoverIdea(s.id);
            toast(`«${s.titulo}» pasó al repertorio`, 'ok');
            pintar();
          },
        }, '→ Repertorio'),
        h('button.icon-btn.danger', {
          title: 'Borrar la idea',
          onclick: async () => {
            if (await confirmar(`¿Borrar «${s.titulo}» de Ideas?`, { titulo: 'Borrar idea' })) {
              store.removeSong(s.id); toast('Idea borrada'); pintar();
            }
          },
        }, '✕')),
    );
  }

  function pintar() {
    const n = norm(q);
    const res = store.ideas
      .filter(s => (!n || norm(s.titulo).includes(n) || norm(s.artista).includes(n))
                && (!cat || s.categoria === cat))
      .sort((a, b) => a.artista.localeCompare(b.artista) || a.titulo.localeCompare(b.titulo));

    contador.textContent = `${res.length} / ${store.ideas.length}`;
    clear(grid);

    if (!res.length) {
      grid.appendChild(h('div.empty', { style: { gridColumn: '1 / -1' } },
        h('b', {}, store.ideas.length ? 'Nada con ese filtro' : 'Todavía no anotaste ninguna idea'),
        h('div', {}, 'Acá van los temas que querés probar y nunca tocaron.'),
        h('button.btn.primary', { style: { marginTop: '14px' }, onclick: () => dialogoNuevaIdea(pintar) },
          '＋ Anotar una idea')));
      return;
    }
    res.forEach(s => grid.appendChild(tarjeta(s)));
    pintarBarra();
  }

  const buscador = h('input', { type: 'search', placeholder: 'Buscar entre las ideas…' });
  buscador.addEventListener('input', debounce(() => { q = buscador.value; pintar(); }, 120));

  /* --- traer de vuelta el banco archivado --- */
  async function importarBanco(btn) {
    btn.disabled = true; btn.textContent = 'Cargando…';
    try {
      const res = await fetch('data/descartados.json');
      if (!res.ok) throw new Error('no se encontró data/descartados.json');
      const data = await res.json();

      const yaEstan = new Set(store.songs.map(s => norm(s.titulo) + '|' + norm(s.artista)));
      const nuevas = (data.songs || []).filter(s => !yaEstan.has(norm(s.titulo) + '|' + norm(s.artista)));

      const ok = await confirmar(
        `El banco archivado tiene ${data.total} temas que nunca se tocaron: el backlog del documento original. ` +
        `${nuevas.length} todavía no están cargados. ¿Los sumo a Ideas?`,
        { titulo: 'Importar banco archivado', danger: false, okText: `Sumar ${nuevas.length} ideas` });

      if (ok) {
        nuevas.forEach(s => store.addSong({ ...s, id: undefined, jams: [], esIdea: true }));
        toast(`${nuevas.length} ideas importadas`, 'ok');
        pintar(); refrescar();
      }
    } catch (e) {
      toast('No se pudo leer el banco: ' + e.message, 'err');
    }
    btn.disabled = false; btn.textContent = '📥 Traer el banco archivado';
  }
  const btnBanco = h('button.btn', { onclick: () => importarBanco(btnBanco) }, '📥 Traer el banco archivado');

  pintar();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Canciones Ideas'),
        h('p.sub', {}, 'Temas anotados para probar algún día. Al sumarlos a una lista pasan al repertorio.')),
      h('div.page-actions', {},
        h('button.btn.primary', { onclick: () => dialogoNuevaIdea(pintar) }, '＋ Nueva idea'),
        btnBanco,
        h('button.btn.ghost', {
          onclick: () => {
            if (!store.ideas.length) { toast('No hay ideas para exportar', 'err'); return; }
            descargar('ideas.json', JSON.stringify(store.ideas, null, 1));
            toast('Ideas exportadas', 'ok');
          },
        }, '⬇ Exportar'))),

    h('div.filters', {},
      h('div.search', {}, buscador),
      select([{ value: '', label: 'Todas las categorías' }, ...store.categorias.map(c => ({ value: c, label: catCorta(c) }))],
        { onchange: e => { cat = e.target.value; pintar(); } }),
      contador),

    barraEnvio,
    grid,
  );
}
