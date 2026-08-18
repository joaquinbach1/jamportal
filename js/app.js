/* ============================================================
   app.js — arranque + router por hash
   ============================================================ */

import { store, alHaberCambiosAjenos, alFallarNube } from './store.js';
import { h, clear, $, $$, toast } from './ui.js';
import { iniciarTema, botonTema } from './tema.js';

import { vistaJams }    from './views/jams.js';
import { vistaNueva }   from './views/nueva.js';
import { vistaEditor }  from './views/jam-editor.js';
import { vistaLive }    from './views/live.js';
import { vistaSongs }   from './views/songs.js';
import { vistaIdeas }   from './views/ideas.js';
import { vistaSingers } from './views/singers.js';
import { vistaStats }   from './views/stats.js';
import { vistaData }    from './views/data.js';

const view = $('#view');

const RUTAS = [
  [/^\/live\/(.+)$/,  (m) => vistaLive(m[1]),   'jams'],
  [/^\/jams\/(.+)$/, (m) => vistaEditor(m[1]), 'jams'],
  [/^\/jams$/,       () => vistaJams(),        'jams'],
  [/^\/nueva$/,      () => vistaNueva(),       'nueva'],
  [/^\/songs$/,      () => vistaSongs(),       'songs'],
  [/^\/ideas$/,      () => vistaIdeas(),       'ideas'],
  [/^\/singers$/,    () => vistaSingers(),     'singers'],
  [/^\/stats$/,      () => vistaStats(),       'stats'],
  [/^\/data$/,       () => vistaData(),        'data'],
];

let rutaActual = '';

export function ir(hash) { location.hash = hash; }

/** Vuelve a dibujar la vista actual (lo usan las vistas después de mutar datos). */
export function refrescar() { render(true); }

function render(forzar = false) {
  const ruta = (location.hash || '#/jams').slice(1);
  if (!forzar && ruta === rutaActual) return;
  rutaActual = ruta;

  const match = RUTAS.map(([re, fn, nav]) => {
    const m = ruta.match(re);
    return m ? { fn: () => fn(m), nav } : null;
  }).find(Boolean);

  $$('#nav a').forEach(a => a.classList.toggle('active', match && a.dataset.route === match.nav));
  document.body.classList.toggle('en-vivo', ruta.startsWith('/live/'));

  clear(view);
  if (!match) {
    view.appendChild(h('div.empty', {},
      h('b', {}, 'No encontramos esa página'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver a Jams')));
    return;
  }

  try {
    view.appendChild(match.fn());
  } catch (err) {
    console.error(err);
    view.appendChild(h('div.empty', {}, h('b', {}, 'Se rompió algo al dibujar esta vista'), h('code.mono', {}, err.message)));
  }
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => render());

/* Cuando alguien más cambia algo en la base compartida, refrescamos la vista.
   Si estás escribiendo en un campo no te interrumpimos: avisamos y listo. */
alHaberCambiosAjenos(() => {
  const escribiendo = document.activeElement &&
    /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  const enModal = !!document.querySelector('.modal-back');
  if (escribiendo || enModal) { toast('Hay cambios de otro dispositivo — se aplican al terminar'); return; }
  toast('Actualizado desde otro dispositivo');
  render(true);
});

alFallarNube(msg => setTimeout(() =>
  toast('No pude entrar a la base compartida, sigo con los datos de este navegador. ' + msg, 'err'), 800));

iniciarTema();
$('#temaSlot').appendChild(botonTema(h));

(async function main() {
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    view.appendChild(h('div.empty', {},
      h('b', {}, 'No se pudo cargar el repertorio'),
      h('p', {}, 'Revisá que data/seed.json exista y que estés abriendo el sitio por http (no file://).'),
      h('code.mono', {}, e.message)));
    return;
  }
  // lo que quedó en jams cuya fecha ya pasó, cuenta como tocado
  const grad = store.consolidarJamsPasadas();
  if (grad.promovidas) {
    setTimeout(() => toast(
      `${grad.promovidas} idea${grad.promovidas > 1 ? 's pasaron' : ' pasó'} al repertorio: ` +
      grad.graduados.slice(0, 3).join(', ') + (grad.graduados.length > 3 ? '…' : ''), 'ok'), 700);
  }

  $('#storageBadge').textContent = `${store.driverName} · ${store.repertorio.length} temas`
    + (store.ideas.length ? ` · ${store.ideas.length} ideas` : '');
  if (!location.hash) location.hash = '#/jams';
  render(true);
})();
