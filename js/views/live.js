/* ============================================================
   views/live.js — LIVE VIEW: la lista para mirar durante la jam
   ------------------------------------------------------------
   Pantalla completa, tipografía grande y alto contraste. Marca en
   qué tema van, muestra el que sigue, y se navega con la barra
   espaciadora / flechas o tocando la pantalla.

   Adentro está la descarga del setlist en .docx.
   ============================================================ */

import { store } from '../store.js';
import { notaDe } from '../notas.js';
import { h, clear, frag, toast, fechaLinda, descargarBlob } from '../ui.js';
import { PUESTOS, puestosOcupados, iconoDe } from '../musicos.js';
import { setlistDocx } from '../docx.js';

/** Aplana el setlist a filas dibujables, numerando solo los temas. */
export function filas(jam) {
  const out = [];
  let n = 0;
  (jam.items || []).forEach((it, i) => {
    if (it.tipo === 'bloque') { out.push({ tipo: 'bloque', label: it.label, i }); return; }
    if (it.tipo === 'break') { out.push({ tipo: 'break', label: it.label, minutos: it.minutos, i }); return; }
    if (it.tipo === 'medley') {
      n++;
      out.push({ tipo: 'medley', n, titulo: it.titulo, i,
        songs: (it.songs || []).map(ms => ({
          song: store.song(ms.songId), cantantes: ms.cantantes || [],
          musicos: ms.musicos || null })) });
      return;
    }
    n++;
    out.push({ tipo: 'song', n, i, song: store.song(it.songId),
      cantantes: it.cantantes || [], musicos: it.musicos || null });
  });
  return out;
}

function puestosEnVivo(m, chica) {
  return puestosOcupados(m).map(p => h(
    'span.live-guitarra' + (chica ? '.chica' : '') + (m[p.clave].solo ? '.solo' : ''), {},
    iconoDe(p),
    ' ' + m[p.clave].nombre + (m[p.clave].solo ? ' · solo' : '')));
}

/* ============================================================
   Los cambios de músico
   ------------------------------------------------------------
   Parado frente a la gente, lo que hay que saber no es la
   formación entera —esa casi siempre es la misma— sino qué
   cambia respecto del tema anterior: quién entra, quién sale y
   a quién le toca el solo ahora.

   Se compara contra el tema anterior de verdad, salteando
   bloques y breaks, y entrando a los medleys tema por tema: en
   un medley se turnan más que en ningún otro lado. El primero
   no avisa nada: esa es la formación de arranque, no un cambio.
   ============================================================ */

function diferencias(antes, ahora) {
  if (!antes || !ahora) return [];
  const out = [];
  for (const p of PUESTOS) {
    const a = antes[p.clave] || {}, b = ahora[p.clave] || {};
    if ((a.nombre || '') === (b.nombre || '')) {
      /* mismo músico: solo avisamos si le movieron el solo */
      if (b.nombre && !!a.solo !== !!b.solo) {
        out.push({ p, texto: b.solo ? `${b.nombre} hace el solo` : `${b.nombre} ya no hace el solo` });
      }
      continue;
    }
    if (!b.nombre) out.push({ p, texto: `sale ${a.nombre}` });
    else if (!a.nombre) out.push({ p, texto: `entra ${b.nombre}` });
    else out.push({ p, texto: `${b.nombre} por ${a.nombre}` });
  }
  return out;
}

/** Anota en cada tema qué cambia respecto del anterior. */
function marcarCambios(lista) {
  let previo = null;
  for (const f of lista) {
    if (f.tipo === 'medley') {
      for (const x of f.songs) {
        x.cambios = diferencias(previo, x.musicos);
        if (x.musicos) previo = x.musicos;
      }
      continue;
    }
    if (f.tipo !== 'song') continue;          // bloques y breaks no cortan la cuenta
    f.cambios = diferencias(previo, f.musicos);
    if (f.musicos) previo = f.musicos;
  }
  return lista;
}

function avisoDeCambio(cambios, chica) {
  if (!cambios || !cambios.length) return null;
  return h('div.live-cambio' + (chica ? '.chica' : ''), {},
    h('span.live-cambio-tag', {}, 'CAMBIO'),
    cambios.map(c => h('span.live-cambio-item', {}, iconoDe(c.p), ' ', c.p.label + ': ' + c.texto)));
}

export function vistaLive(jamId) {
  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver'));
  }

  const lista = marcarCambios(filas(jam));
  const tocables = lista.filter(f => f.tipo !== 'bloque');       // sobre las que se puede parar
  let actual = Math.min(jam.vivoIndice ?? 0, Math.max(tocables.length - 1, 0));

  const cuerpo = h('div.live-body');
  const barra = h('div.live-progress');
  const contador = h('span.live-count');

  /* ---------- mantener la pantalla encendida ---------- */
  let wakeLock = null;
  async function pedirWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* el navegador puede negarlo, no pasa nada */ }
  }
  pedirWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !wakeLock) pedirWakeLock();
  });

  /* ---------- navegación ---------- */
  function irA(k) {
    actual = Math.max(0, Math.min(k, tocables.length - 1));
    jam.vivoIndice = actual;
    store.commit();
    pintar();
    const el = cuerpo.querySelector('.live-row.actual');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const teclas = e => {
    // si se fueron de la vista sin usar el botón, el listener se saca solo
    if (!location.hash.startsWith('#/live/')) { document.removeEventListener('keydown', teclas); return; }
    if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); irA(actual + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); irA(actual - 1); }
    else if (e.key === 'Escape') salir();
  };
  document.addEventListener('keydown', teclas);

  function salir() {
    document.removeEventListener('keydown', teclas);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    document.body.classList.remove('en-vivo');
    location.hash = '#/jams/' + jam.id;
  }

  /* ---------- descarga .docx ---------- */
  function bajarDocx() {
    const ahora = new Date();
    const sub = [jam.fecha ? fechaLinda(jam.fecha) : '', jam.hora, jam.lugar].filter(Boolean).join('  ·  ');
    const sello = 'JAM PORTAL · generado el ' +
      ahora.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' a las ' + ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    try {
      const blob = setlistDocx(jam, id => store.song(id), sub, sello);
      const nombre = (jam.nombre || 'setlist').replace(/[^\w\sÁ-ú-]/g, '').trim().replace(/\s+/g, '-');
      descargarBlob(`${nombre}${jam.fecha ? '-' + jam.fecha : ''}.docx`, blob);
      toast('Setlist descargado en Word', 'ok');
    } catch (e) {
      console.error(e);
      toast('No se pudo generar el .docx', 'err');
    }
  }

  /* ---------- dibujado ---------- */
  function pintar() {
    clear(cuerpo);
    let k = -1;

    lista.forEach(f => {
      if (f.tipo === 'bloque') {
        cuerpo.appendChild(h('div.live-bloque', {}, f.label || ''));
        return;
      }
      k++;
      const idx = k;
      const esActual = idx === actual;
      const esProximo = idx === actual + 1;
      const clase = '.live-row' + (esActual ? '.actual' : '') + (esProximo ? '.proximo' : '') + (idx < actual ? '.pasado' : '');

      if (f.tipo === 'break') {
        cuerpo.appendChild(h('div' + clase + '.live-break', { onclick: () => irA(idx) },
          h('span', {}, (f.label || 'BREAK') + (f.minutos ? `  ·  ${f.minutos}'` : ''))));
        return;
      }

      if (f.tipo === 'medley') {
        cuerpo.appendChild(h('div' + clase + '.live-medley', { onclick: () => irA(idx) },
          h('div.live-num', {}, f.n),
          h('div.live-main', {},
            h('div.live-titulo', {}, h('span.live-tag', {}, 'MEDLEY'), ' ', f.titulo || ''),
            h('div.live-medley-songs', {}, f.songs.map(x =>
              h('div.live-sub-song', {},
                h('span', {}, x.song ? x.song.titulo : '—'),
                x.cantantes.length ? h('span.live-cantante', {}, x.cantantes.join(', ')) : null,
                ...puestosEnVivo(x.musicos, true),
                x.song && x.song.bpm ? h('span.live-bpm', {}, x.song.bpm) : null,
                x.song && notaDe(jam.id, x.song.id)
                  ? h('span.live-nota.chica', {}, notaDe(jam.id, x.song.id)) : null,
                avisoDeCambio(x.cambios, true)))))));
        return;
      }

      const s = f.song;
      cuerpo.appendChild(h('div' + clase, { onclick: () => irA(idx) },
        h('div.live-num', {}, f.n),
        h('div.live-main', {},
          h('div.live-titulo', {}, s ? s.titulo : '—'),
          h('div.live-meta', {},
            s ? h('span.live-artista', {}, s.artista) : null,
            f.cantantes.length ? h('span.live-cantante', {}, '🎤 ' + f.cantantes.join(', ')) : null,
            /* quién toca qué, con el que hace el solo destacado: parado
               frente a la gente eso es lo que hay que saber de un vistazo */
            ...puestosEnVivo(f.musicos),
            s && s.bpm ? h('span.live-bpm' + (s.bpmFuente === 'sugerido' ? '.sug' : ''), {}, s.bpm + ' bpm') : null,
            s && (s.patches || []).length ? h('span.live-patch', {}, '🎹 ' + s.patches.join(' ')) : null,
            s && s.cifraUrl
              ? h('a.live-cifra', { href: s.cifraUrl, target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, '🎸 cifra')
              : null),
          avisoDeCambio(f.cambios),
          /* la nota es tuya y de esta máquina: nadie más la ve */
          s && notaDe(jam.id, s.id) ? h('div.live-nota', {}, notaDe(jam.id, s.id)) : null)));
    });

    contador.textContent = `${Math.min(actual + 1, tocables.length)} / ${tocables.length}`;
    barra.style.setProperty('--avance', `${tocables.length ? ((actual + 1) / tocables.length) * 100 : 0}%`);
  }

  pintar();
  document.body.classList.add('en-vivo');
  setTimeout(() => {
    const el = cuerpo.querySelector('.live-row.actual');
    if (el) el.scrollIntoView({ block: 'center' });
  }, 60);

  return frag(
    h('div.live-head', {},
      h('div', { style: { minWidth: 0 } },
        h('div.live-jam', {}, jam.nombre || 'Jam'),
        h('div.live-fecha', {}, [jam.fecha ? fechaLinda(jam.fecha) : '', jam.hora, jam.lugar].filter(Boolean).join(' · '))),
      contador,
      h('div.live-acciones', {},
        h('button.btn.sm', { onclick: () => irA(actual - 1), title: 'Anterior (↑)' }, '↑'),
        h('button.btn.sm.primary', { onclick: () => irA(actual + 1), title: 'Siguiente (espacio o ↓)' }, '↓ Siguiente'),
        h('button.btn.sm', { onclick: bajarDocx, title: 'Bajar el setlist en Word' }, '⬇ Word'),
        h('button.btn.sm', { onclick: () => window.print(), title: 'Imprimir o guardar como PDF' }, '🖨'),
        h('button.btn.sm', { onclick: salir, title: 'Salir (Esc)' }, '✕'))),
    barra,
    cuerpo,
    h('div.live-pie', {}, 'Espacio o ↓ para avanzar · ↑ para volver · Esc para salir · tocá cualquier tema para saltar ahí'),
  );
}
