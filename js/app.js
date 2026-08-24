/* ============================================================
   app.js — arranque + router por hash
   ============================================================ */

import { store, alHaberCambiosAjenos, alFallarNube, alChocarConOtro, realtimeConectado } from './store.js';
import { h, clear, $, $$, toast, modal } from './ui.js';
import { iniciarTema, botonTema } from './tema.js';

import { vistaJams }    from './views/jams.js';
import { vistaNueva }   from './views/nueva.js';
import { vistaEditor }  from './views/jam-editor.js';
import { vistaLive }    from './views/live.js';
import { vistaLyrics }  from './views/lyrics.js';
import { vistaSongs }   from './views/songs.js';
import { vistaIdeas }   from './views/ideas.js';
import { vistaSingers } from './views/singers.js';
import { vistaStats }   from './views/stats.js';
import { vistaData }    from './views/data.js';
import { vistaLogin, hayQueEntrar } from './views/login.js';
import { montarUsuario } from './views/usuario.js';

const view = $('#view');

const RUTAS = [
  [/^\/live\/(.+)$/,  (m) => vistaLive(m[1]),   'jams'],
  [/^\/lyrics\/(.+)$/, (m) => vistaLyrics(m[1]), 'jams'],
  [/^\/jams\/(.+)$/, (m) => vistaEditor(m[1]), 'jams'],
  [/^\/jams$/,       () => vistaJams(),        'jams'],
  [/^\/nueva$/,      () => vistaNueva(),       'jams'],  // sin ítem propio: se llega desde Jams
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

/* Choque: otro guardó la misma jam mientras vos la editabas. La base
   frenó tu escritura en vez de aceptarla y perder lo del otro, así que
   acá hay que decidir cuál de las dos versiones queda. No hay respuesta
   automática buena: la elige quien está editando. */
alChocarConOtro(e => {
  const nombre = e.jamNombre || 'esa jam';
  const m = modal({
    title: '⚠ Chocaron los cambios',
    body: h('div', { style: { display: 'grid', gap: '10px', color: 'var(--txt-2)', lineHeight: '1.6' } },
      h('p', { style: { margin: 0 } },
        'Alguien más guardó ', h('b', {}, nombre), ' mientras vos la editabas. ',
        'No guardé lo tuyo para no borrar lo de esa persona.'),
      h('p', { style: { margin: 0, fontSize: '13.5px' } },
        'Si traés lo de ellos, perdés los cambios que hiciste desde la última vez. ',
        'Si guardás lo tuyo, se pierde lo que hizo la otra persona.')),
    footer: [
      h('button.btn.ghost', {
        onclick: async () => {
          m.close();
          await store.sincronizar();
          toast('Traje la versión de la otra persona');
          render(true);
        },
      }, '↓ Traer lo de ellos'),
      h('button.btn.danger', {
        onclick: () => {
          m.close();
          store.pisarJam(e.jamId);
          toast('Guardado: quedó tu versión', 'ok');
        },
      }, '↑ Que quede lo mío'),
    ],
  });
});

iniciarTema();
$('#temaSlot').appendChild(botonTema(h));

(async function main() {
  /* La puerta va antes que todo: si la app está contra la base compartida
     y no hay sesión, no tiene sentido cargar nada — el RLS no va a
     devolver ni una fila. En modo local esto no se ejecuta nunca. */
  try {
    if (await hayQueEntrar()) {
      document.body.classList.add('en-login');
      await vistaLogin(view, () => location.reload());
      return;
    }
  } catch (e) {
    console.error('No pude preparar la sesión:', e);
  }

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
  /* Entraste bien, pero tu mail no está habilitado. No es un error de
     conexión: la base contesta perfecto, simplemente no te muestra nada. */
  if (store.sinPermiso) {
    document.body.classList.add('en-login');
    view.appendChild(h('div.empty', { style: { maxWidth: '460px', margin: '14vh auto 0' } },
      h('b', {}, 'Falta que te habiliten'),
      h('p', {}, 'Tu cuenta está creada y entraste bien, pero ',
        h('code.mono', {}, store.email || 'tu mail'),
        ' todavía no está en la lista de la banda, así que la base no te '
        + 'muestra nada. Pedile a alguien que te agregue y volvé a entrar.'),
      h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '14px' } },
        h('button.btn.sm', { onclick: () => location.reload() }, '↻ Reintentar'),
        h('button.btn.sm.ghost', {
          onclick: () => { store.cerrarSesion(); location.reload(); },
        }, 'Salir'))));
    return;
  }

  montarUsuario($('#usuarioSlot'));

  function pintarBadge() {
    // El punto va como título y no como texto: escrito entero no entra en
    // el ancho del sidebar y parte el badge en dos renglones.
    const vivo = realtimeConectado();
    $('#storageBadge').innerHTML = '';
    $('#storageBadge').append(
      `${store.driverName} · ${store.repertorio.length} temas`
      + (store.ideas.length ? ` · ${store.ideas.length} ideas` : ''),
      store.enLaNube
        ? h('span.vivo' + (vivo ? '.on' : ''), {
            title: vivo
              ? 'En vivo: los cambios de los demás llegan al instante'
              : 'Sin conexión en vivo: se consulta cada 8 segundos',
          }, vivo ? ' ●' : ' ○')
        : '');
  }
  pintarBadge();
  if (store.enLaNube) setInterval(pintarBadge, 4000);
  if (!location.hash) location.hash = '#/jams';
  render(true);
})();
