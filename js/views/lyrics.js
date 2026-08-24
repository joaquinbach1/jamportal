/* ============================================================
   views/lyrics.js — las letras de la jam, en orden
   ------------------------------------------------------------
   A la izquierda el setlist completo, a la derecha la letra del
   tema que toques. Pensado para leerlo desde el escenario: letra
   grande, y el tamaño se ajusta con A- / A+.

   Las letras se traen de internet en el momento y quedan en
   memoria; el que sigue se va cargando solo mientras leés.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, frag, poner } from '../ui.js';
import { buscarLetra, urlBusquedaLetra, precargar } from '../letras.js';
import { filas } from './live.js';

const CLAVE_TAM = 'jamportal.letras.tam';
const tamGuardado = () => {
  const n = parseFloat(localStorage.getItem(CLAVE_TAM));
  return Number.isFinite(n) ? Math.min(2.4, Math.max(0.8, n)) : 1.15;
};

export function vistaLyrics(jamId) {
  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver'));
  }

  /* solo los temas: los bloques y breaks se dibujan pero no se eligen */
  const todas = filas(jam);
  const cantables = [];
  for (const f of todas) {
    if (f.tipo === 'song' && f.song) cantables.push({ song: f.song, n: f.n });
    if (f.tipo === 'medley') for (const ms of f.songs) if (ms.song) cantables.push({ song: ms.song, n: f.n });
  }

  let elegida = cantables.length ? 0 : -1;
  let tam = tamGuardado();

  const listaCont = h('div.ly-lista');
  const panel = h('div.ly-panel');

  /* ---------- panel de la derecha ---------- */

  async function pintarLetra() {
    clear(panel);
    if (elegida < 0) {
      panel.appendChild(h('div.empty', {}, h('b', {}, 'Esta jam no tiene temas todavía')));
      return;
    }
    const { song } = cantables[elegida];

    const cabecera = h('div.ly-head', {},
      h('div', {},
        h('h2', {}, song.titulo),
        h('div.ly-artista', {}, song.artista || '')),
      h('div.ly-tam', {},
        h('button.btn.xs', { title: 'Más chica', onclick: () => cambiarTam(-0.12) }, 'A−'),
        h('button.btn.xs', { title: 'Más grande', onclick: () => cambiarTam(+0.12) }, 'A+')));

    const cuerpo = h('div.ly-texto', { style: { fontSize: tam + 'rem' } }, 'Buscando la letra…');
    poner(panel, cabecera, cuerpo);

    const res = await buscarLetra(song);
    /* mientras se buscaba pudiste haber cambiado de tema */
    if (!cantables[elegida] || cantables[elegida].song !== song) return;

    clear(cuerpo);
    if (res.ok) {
      cuerpo.textContent = res.texto;
    } else {
      cuerpo.classList.add('sin');
      poner(cuerpo,
        h('div', {}, 'No encontré la letra de este tema.'),
        h('div.dim', { style: { fontSize: '13px', marginTop: '6px' } },
          'La base que uso es floja con cumbia y tropical.'),
        h('a.btn.sm', {
          href: urlBusquedaLetra(song), target: '_blank', rel: 'noopener',
          style: { marginTop: '14px' },
        }, '🔎 Buscarla en internet'));
    }

    // la que sigue, para que esté lista cuando llegues
    const prox = cantables[elegida + 1];
    if (prox) precargar(prox.song);
  }

  function cambiarTam(delta) {
    tam = Math.min(2.4, Math.max(0.8, tam + delta));
    localStorage.setItem(CLAVE_TAM, String(tam));
    const t = panel.querySelector('.ly-texto');
    if (t) t.style.fontSize = tam + 'rem';
  }

  /* ---------- lista de la izquierda ---------- */

  function ir(i) {
    if (i < 0 || i >= cantables.length) return;
    elegida = i;
    pintarLista();
    pintarLetra();
    const activo = listaCont.querySelector('.ly-item.on');
    if (activo) activo.scrollIntoView({ block: 'nearest' });
  }

  function pintarLista() {
    clear(listaCont);
    let iCantable = 0;

    for (const f of todas) {
      if (f.tipo === 'bloque') {
        listaCont.appendChild(h('div.ly-bloque', {}, (f.label || '').toUpperCase()));
        continue;
      }
      if (f.tipo === 'break') {
        listaCont.appendChild(h('div.ly-break', {}, f.label || 'BREAK'));
        continue;
      }
      if (f.tipo === 'medley') {
        listaCont.appendChild(h('div.ly-medley', {}, `${f.n} · ${f.titulo || 'Medley'}`));
        for (const ms of f.songs) {
          if (!ms.song) continue;
          listaCont.appendChild(item(ms.song, iCantable++, true));
        }
        continue;
      }
      if (f.tipo === 'song' && f.song) listaCont.appendChild(item(f.song, iCantable++, false, f.n));
    }
  }

  function item(song, i, enMedley, n) {
    return h('button.ly-item' + (i === elegida ? '.on' : '') + (enMedley ? '.dentro' : ''), {
      onclick: () => ir(i),
    },
      h('span.ly-n', {}, enMedley ? '·' : String(n)),
      h('span.ly-t', {}, song.titulo),
      h('span.ly-a', {}, song.artista || ''));
  }

  /* ---------- teclado ---------- */

  const alTeclado = e => {
    if (e.key === 'Escape') { location.hash = '#/jams/' + jamId; return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); ir(elegida + 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); ir(elegida - 1); }
  };
  document.addEventListener('keydown', alTeclado);
  window.addEventListener('hashchange', function limpiar() {
    document.removeEventListener('keydown', alTeclado);
    window.removeEventListener('hashchange', limpiar);
  });

  pintarLista();
  pintarLetra();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('div.titulo-jam', {},
          h('a.btn.sm.ghost', { href: '#/jams/' + jamId, title: 'Volver a la jam' }, '← Volver'),
          h('h1', {}, 'Letras')),
        h('p.sub', {}, `${jam.nombre || 'Jam'} · ${cantables.length} temas · ↑ ↓ para moverte, Esc para salir`))),
    h('div.ly-grid', {}, listaCont, panel),
  );
}
