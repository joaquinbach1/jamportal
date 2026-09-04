/* ============================================================
   app.js — arranque + router por hash
   ============================================================ */

import { store, alHaberCambiosAjenos, alChocarConOtro, realtimeConectado } from './store.js';
import { h, clear, $, $$, toast, modal } from './ui.js';
import { iniciarTema, botonTema } from './tema.js';

import { vistaJams }    from './views/jams.js';
import { vistaNueva }   from './views/nueva.js';
import { vistaEditor }  from './views/jam-editor.js';
import { vistaLive }    from './views/live.js';
import { vistaMovil }   from './views/movil.js';
import { vistaLyrics, vistaLetrasCompartidas } from './views/lyrics.js';
import { desempaquetar } from './compartir.js';
import { vistaSongs }   from './views/songs.js';
import { vistaEnsayosAdmin } from './views/ensayos-admin.js';
import { vistaIdeas }   from './views/ideas.js';
import { vistaSingers } from './views/singers.js';
import { vistaStats }   from './views/stats.js';
import { vistaData }    from './views/data.js';
import { vistaLogin, hayQueEntrar } from './views/login.js';
import { montarUsuario } from './views/usuario.js';
import { cargarNotas } from './notas.js';

const view = $('#view');

/** En el celular la jam se abre como lista para leer, no como editor. */
export const enCelular = () => window.matchMedia('(max-width: 820px)').matches;

const RUTAS = [
  [/^\/live\/(.+)$/,  (m) => vistaLive(m[1]),   'jams'],
  [/^\/lyrics\/(.+)$/, (m) => vistaLyrics(m[1]), 'jams'],
  /* El editor completo tiene ruta propia: así se llega desde el celular
     a propósito, y el link se puede compartir sin depender de la pantalla.
     Y la lista minimalista también: es cómo se mira la jam desde la compu
     sin abrir el editor entero. */
  [/^\/jams\/(.+)\/editar$/, (m) => vistaEditor(m[1]), 'jams'],
  [/^\/jams\/(.+)\/lista$/,  (m) => vistaMovil(m[1]),  'jams'],
  [/^\/jams\/(.+)$/, (m) => (enCelular() ? vistaMovil(m[1]) : vistaEditor(m[1])), 'jams'],
  [/^\/jams$/,       () => vistaJams(),        'jams'],
  [/^\/nueva$/,      () => vistaNueva(),       'jams'],  // sin ítem propio: se llega desde Jams
  [/^\/ensayos\/(.+)$/, (m) => vistaEnsayosAdmin(m[1]), 'ensayos'],
  [/^\/ensayos$/,    () => vistaEnsayosAdmin(),   'ensayos'],
  [/^\/songs$/,      () => vistaSongs(),       'songs'],
  [/^\/ideas$/,      () => vistaIdeas(),       'ideas'],
  [/^\/singers$/,    () => vistaSingers(),     'singers'],
  [/^\/stats$/,      () => vistaStats(),       'stats'],
  [/^\/data$/,       () => vistaData(),        'data'],
];

let rutaActual = '';

export function ir(hash) { location.hash = hash; }

/* ============================================================
   Barra de arriba (solo en pantalla chica)
   ------------------------------------------------------------
   El ☰ saca el menú lateral, que en el celular vive escondido a
   la izquierda. El ⋯ es de la pantalla que está abierta: cada
   vista pone ahí sus acciones con accionesDePagina() y el router
   lo vacía antes de dibujar la siguiente.
   ============================================================ */
const btnMas = $('#btnMas');

export function abrirMenu(abierto) {
  document.body.classList.toggle('menu-abierto', abierto);
  $('#menuBack').hidden = !abierto;
  $('#btnMenu').setAttribute('aria-expanded', String(abierto));
}

/** La vista actual declara qué hay detrás del ⋯. null lo esconde. */
export function accionesDePagina(fn) {
  btnMas.onclick = fn || null;
  btnMas.hidden = !fn;
}

$('#btnMenu').onclick = () => abrirMenu(!document.body.classList.contains('menu-abierto'));
$('#menuBack').onclick = () => abrirMenu(false);

/* ---------- achicar el menú lateral (solo compu) ----------
   Colapsado queda una tirita con el botón para volver. La elección se
   guarda en este navegador; en el celular no aplica, ahí el menú ya
   vive detrás del ☰. */
const CLAVE_SB = 'jamportal.sidebar';
function aplicarSidebar() {
  const cerrada = localStorage.getItem(CLAVE_SB) === 'cerrada';
  document.body.classList.toggle('sidebar-cerrada', cerrada);
  const b = $('#btnSidebar');
  b.textContent = cerrada ? '›' : '‹';
  b.title = cerrada ? 'Agrandar el menú' : 'Achicar el menú';
}
$('#btnSidebar').onclick = () => {
  localStorage.setItem(CLAVE_SB,
    document.body.classList.contains('sidebar-cerrada') ? '' : 'cerrada');
  aplicarSidebar();
};
aplicarSidebar();
/* Elegir a dónde ir es terminar con el menú: si quedara abierto, taparía
   la pantalla a la que acabás de entrar. */
$('#nav').addEventListener('click', e => { if (e.target.closest('a')) abrirMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') abrirMenu(false); });

/** Vuelve a dibujar la vista actual (lo usan las vistas después de mutar datos). */
export function refrescar() { render(true); }

/** El link de letras compartido: no pasa por las rutas normales. */
async function pintarCompartido(paquete) {
  document.body.classList.add('modo-compartido');
  const datos = await desempaquetar(paquete);
  clear(view);
  view.appendChild(vistaLetrasCompartidas(datos));
  if (datos && datos.n) document.title = datos.n + ' — Letras';
  window.scrollTo({ top: 0 });
}

function render(forzar = false) {
  const ruta = (location.hash || '#/jams').slice(1);
  if (!forzar && ruta === rutaActual) return;
  rutaActual = ruta;

  /* Puede llegar acá navegando dentro de la app (el hash cambia y la
     página no recarga), así que se atiende también desde el router. */
  const compartido = ruta.match(/^\/l\/(.+)$/);
  if (compartido) { pintarCompartido(compartido[1]); return; }
  document.body.classList.remove('modo-compartido');

  const match = RUTAS.map(([re, fn, nav]) => {
    const m = ruta.match(re);
    return m ? { fn: () => fn(m), nav } : null;
  }).find(Boolean);

  $$('#nav a').forEach(a => a.classList.toggle('active', match && a.dataset.route === match.nav));
  document.body.classList.toggle('en-vivo', ruta.startsWith('/live/'));

  abrirMenu(false);
  accionesDePagina(null);                       // lo vuelve a poner la vista, si tiene
  const activo = $$('#nav a').find(a => a.classList.contains('active'));
  $('#tbTitulo').textContent = activo ? activo.textContent : 'JAM PORTAL';

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

/* Choque: otro guardó la misma jam mientras vos la editabas y la base
   frenó tu escritura. Antes esto abría una ventana a decidir; ahora no
   interrumpe: queda tu versión, que es la que tenés delante y estás
   mirando, y el aviso cuenta qué pasó por si querés ir a buscar lo del
   otro. Es una decisión tomada a conciencia: lo que la otra persona
   había guardado en esa jam se pisa. */
alChocarConOtro(e => {
  store.pisarJam(e.jamId);
  toast(`Guardé lo tuyo en ${e.jamNombre || 'esa jam'} — pisó lo que había guardado otra persona`);
});

/**
 * La pantalla de "no se pudo". Dice qué pasó y no inventa datos: mostrar
 * un repertorio que no es el de la banda es peor que no mostrar nada.
 */
function pintarProblema(tipo = null) {
  const p = store.problema || {};
  const textos = {
    red: ['No llego a la base', 'Puede ser tu conexión o que Supabase esté caído. '
          + 'Nada se perdió: los datos están en la base, no en este teléfono.'],
    vacia: ['La base está vacía', 'Contesta bien, pero no tiene nada cargado. '
          + 'Se llena corriendo los archivos de db/ (mirá el README).'],
    config: ['Falta configurar la base', 'js/config.js no tiene la URL ni la clave del proyecto.'],
    link: ['Este link ya no sirve', 'O lo revocaron, o está mal copiado. '
          + 'Pedile uno nuevo a alguien de la banda.'],
  };
  const cual = tipo || p.tipo;
  const [titulo, detalle] = textos[cual] || ['Algo salió mal', ''];
  document.body.classList.add('en-login');
  clear(view);
  view.appendChild(h('div.empty', { style: { maxWidth: '460px', margin: '14vh auto 0' } },
    h('b', {}, titulo),
    h('p', {}, detalle),
    p.mensaje ? h('code.mono', {}, p.mensaje) : null,
    h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '14px' } },
      h('button.btn.sm.primary', { onclick: () => location.reload() }, '↻ Reintentar'),
      /* "Salir" solo tiene sentido si hay sesión de la que salir. Al que
         entró por un link no le sobra nada que cerrar. */
      (store.publico || cual === 'link') ? null : h('button.btn.sm.ghost', {
        onclick: () => { store.cerrarSesion(); location.reload(); },
      }, 'Salir'))));
}

iniciarTema();
$('#temaSlot').appendChild(botonTema(h));

(async function main() {
  /* ============================================================
     El link de letras compartido va antes que todo: se lleva la
     lista y las letras adentro del hash, así que no necesita
     cuenta, ni base, ni internet. Si entrás por ahí, la app no
     carga nada más.
     ============================================================ */
  const compartido = location.hash.match(/^#\/l\/(.+)$/);
  if (compartido) {
    rutaActual = location.hash.slice(1);
    await pintarCompartido(compartido[1]);
    return;
  }

  /* ============================================================
     El link de una jam. Va antes de la puerta a propósito: el
     punto entero es que se abra sin cuenta. La base decide qué
     se ve y qué se puede tocar; acá solo se dibuja.
     ============================================================ */
  const link = location.hash.match(/^#\/v\/([^/]+)/);
  if (link) {
    document.body.classList.add('modo-link');
    await store.initPublico(link[1]);
    if (store.problema) { pintarProblema(); return; }
    const jam = store.jams[0];
    if (!jam) { pintarProblema('link'); return; }
    /* Siempre la vista de lista, ancha o angosta: es lo que un invitado
       necesita, y el editor completo trae media app que no le toca. */
    $('#tbTitulo').textContent = jam.nombre || 'Jam';
    clear(view);
    view.appendChild(vistaMovil(jam.id));
    alHaberCambiosAjenos(() => {
      const escribiendo = document.activeElement &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (escribiendo || document.querySelector('.modal-back, .hoja-back')) return;
      clear(view);
      view.appendChild(vistaMovil(jam.id));
    });
    return;
  }

  /* La puerta va antes que todo: sin sesión no tiene sentido cargar nada,
     el RLS no va a devolver ni una fila. */
  try {
    if (await hayQueEntrar()) {
      document.body.classList.add('en-login');
      await vistaLogin(view, () => location.reload());
      return;
    }
  } catch (e) {
    console.error('No pude preparar la sesión:', e);
  }

  await store.init();

  /* Si la base no contestó, la app frena acá y lo dice. Antes caía sin
     avisar al repertorio guardado en este navegador —otro repertorio,
     otras jams— y todo lo que se editaba desde ahí se perdía. Mostrar
     datos que no son los de la banda es peor que no mostrar nada. */
  if (store.problema) {
    if (store.problema.tipo === 'sesion') {
      /* Vencida de verdad: la sesión ya se borró sola. Recargar cae en la
         pantalla de entrada, que es lo único que puede arreglarlo. */
      document.body.classList.add('en-login');
      await vistaLogin(view, () => location.reload());
      return;
    }
    pintarProblema();
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

  /* Las notas privadas, para tenerlas al dibujar. Si la base todavía
     no tiene la tabla, sigue con las de este navegador. */
  cargarNotas().then(r => { if (r.origen === 'base') render(true); });

  function pintarBadge() {
    // El punto va como título y no como texto: escrito entero no entra en
    // el ancho del sidebar y parte el badge en dos renglones.
    const vivo = realtimeConectado();
    $('#storageBadge').innerHTML = '';
    $('#storageBadge').append(
      `${store.repertorio.length} temas`
      + (store.ideas.length ? ` · ${store.ideas.length} ideas` : ''),
      h('span.vivo' + (vivo ? '.on' : ''), {
        title: vivo
          ? 'En vivo: los cambios de los demás llegan al instante'
          : 'Sin conexión en vivo: se consulta cada 8 segundos',
      }, vivo ? ' ●' : ' ○'));
  }
  pintarBadge();
  setInterval(pintarBadge, 4000);
  if (!location.hash) location.hash = '#/jams';
  render(true);
})();
