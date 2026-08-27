/* ============================================================
   views/movil.js — la jam en el celular
   ------------------------------------------------------------
   Un documento, no un editor. Se abre parado en el Portal, con
   una mano, para saber qué viene y a qué hora se termina.

   Por eso: un renglón por tema y nada más —número, título,
   artista, quién canta—, los medleys agrupados, los breaks
   partiendo la lista, y arriba el horario estimado. Todo lo que
   se toca vive en el ⋯ de la barra o en el ＋ de abajo.

   El editor completo sigue existiendo, a un toque: #/jams/:id/editar
   ============================================================ */

import { store } from '../store.js';
import { h, frag, clear, toast, fechaLinda, copiar, hojaAcciones, confirmar, descargarBlob } from '../ui.js';
import { agenda, duracionLinda, largoLindo } from '../duracion.js';
import { linkSpotify } from '../spotify.js';
import { notaDe } from '../notas.js';
import { dialogoNuevaIdea } from './ideas.js';
import { accionesDePagina } from '../app.js';
import { setlistDocx } from '../docx.js';

/* ============================================================
   El horario: de qué hora a qué hora, y el break en el medio
   ============================================================ */
function tira(plan) {
  const barra = h('div.mv-tl-barra');
  if (plan.total > 0) {
    plan.filas.forEach(f => {
      if (f.tipo === 'bloque' || !f.seg) return;
      const pct = (f.seg / plan.total) * 100;
      barra.appendChild(h('div.mv-tl-seg' + (f.tipo === 'break' ? '.brk' : ''), {
        style: { width: pct + '%' },
        title: f.tipo === 'break'
          ? `${f.label} · ${f.minutos}′`
          : `${f.tipo === 'medley' ? f.titulo : (f.song ? f.song.titulo : '—')} · ${duracionLinda(f.seg)}`,
      }));
    });
  }

  /* Sin hora de arranque no hay reloj que mostrar, pero el largo total
     sigue sirviendo: es lo que dura la jam, empiece cuando empiece. */
  return h('div.mv-timeline', {},
    h('div.mv-tl-horas', {},
      h('span.mv-tl-hora', {}, plan.inicio || 'sin hora'),
      h('span.mv-tl-largo', {}, largoLindo(plan.total)),
      h('span.mv-tl-hora', {}, plan.fin || '')),
    barra,
    h('div.mv-tl-pie', {},
      `${plan.temas} tema${plan.temas === 1 ? '' : 's'}`,
      plan.breaks ? ` · ${Math.round(plan.breaks / 60)}′ de break` : '',
      plan.sinDato
        ? h('span.mv-tl-aprox', { title: `${plan.sinDato} temas sin duración cargada: se cuentan como 4 minutos` },
            ` · ${plan.sinDato} estimado${plan.sinDato === 1 ? '' : 's'}`)
        : ''));
}

/* ============================================================
   Un renglón: número, título, artista, (cantante) y ♫
   ------------------------------------------------------------
   Todo el texto va en un solo nodo con ellipsis. Partirlo en
   varios flex hace que el navegador recorte el título antes que
   el artista, y el título es lo único que no se puede perder.
   ============================================================ */
function renglon(f, num) {
  const s = f.song;
  const cantantes = (f.cantantes || []).join(', ');
  const url = s ? linkSpotify(s) : '';
  const nota = s && f.jamId ? notaDe(f.jamId, s.id) : '';

  return h('div.mv-fila', {},
    h('span.mv-n', {}, num),
    h('span.mv-txt', {},
      h('b', {}, s ? s.titulo : 'Tema borrado'),
      s && s.artista ? h('span.mv-art', {}, ' ' + s.artista) : null,
      cantantes ? h('span.mv-quien', {}, ` (${cantantes})`) : null),
    nota ? h('span.mv-nota', { title: nota }, '📝') : null,
    h('span.mv-dur', {}, duracionLinda(f.seg)),
    url ? h('a.mv-sp', { href: url, target: '_blank', rel: 'noopener',
                         title: s.spotifyUrl ? 'Escuchar en Spotify' : 'Buscar en Spotify' }, '♫') : null);
}

/* ============================================================
   Vista
   ============================================================ */
export function vistaMovil(jamId) {
  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver'));
  }

  const cont = h('div.movil');

  function menu() {
    hojaAcciones(jam.nombre || 'Jam', [
      { icono: '✎', texto: 'Editar la lista', onClick: () => { location.hash = `#/jams/${jam.id}/editar`; } },
      { icono: '▶', texto: 'LIVE VIEW — pasarla en la jam', onClick: () => { location.hash = '#/live/' + jam.id; } },
      { icono: '📖', texto: 'Las letras, en orden', onClick: () => { location.hash = '#/lyrics/' + jam.id; } },
      { icono: '📋', texto: 'Copiar la lista como texto', onClick: () => copiar(comoTexto()) },
      { icono: '⬇', texto: 'Bajar el setlist en Word', onClick: bajarDocx },
      { icono: '⧉', texto: 'Duplicar la jam', onClick: () => {
          const j = store.duplicateJam(jam.id);
          if (j) { toast('Jam duplicada', 'ok'); location.hash = '#/jams/' + j.id; }
        } },
      { icono: '✕', texto: 'Borrar la jam', peligro: true, onClick: async () => {
          if (await confirmar(`¿Borrar «${jam.nombre || 'esta jam'}»?`, { titulo: 'Borrar jam' })) {
            store.removeJam(jam.id); toast('Jam borrada'); location.hash = '#/jams';
          }
        } },
    ]);
  }

  /** La lista en texto plano, numerada, como se pega en el WhatsApp. */
  function comoTexto() {
    const plan = agenda(jam, id => store.song(id));
    const L = [jam.nombre || 'Jam'];
    const cab = [jam.fecha ? fechaLinda(jam.fecha) : '', jam.hora, jam.lugar].filter(Boolean).join(' · ');
    if (cab) L.push(cab);
    if (plan.inicio) L.push(`${plan.inicio} a ${plan.fin} (${largoLindo(plan.total)})`);
    L.push('');
    for (const f of plan.filas) {
      if (f.tipo === 'bloque') { L.push('', (f.label || '').toUpperCase()); continue; }
      if (f.tipo === 'break') { L.push(`— ${f.label} ${f.minutos}′ ${f.hora ? '· ' + f.hora : ''}`.trim()); continue; }
      const quien = c => (c && c.length ? ` (${c.join(', ')})` : '');
      if (f.tipo === 'medley') {
        L.push(`${f.n}. MEDLEY` + (/^medley$/i.test(f.titulo.trim()) ? '' : ` — ${f.titulo}`));
        f.songs.forEach((x, k) => L.push(
          `   ${f.n}${String.fromCharCode(97 + k)}. ${x.song ? x.song.titulo : '—'}`
          + (x.song && x.song.artista ? ` — ${x.song.artista}` : '') + quien(x.cantantes)));
        continue;
      }
      L.push(`${f.n}. ${f.song ? f.song.titulo : '—'}`
        + (f.song && f.song.artista ? ` — ${f.song.artista}` : '') + quien(f.cantantes));
    }
    return L.join('\n');
  }

  function bajarDocx() {
    const sub = [jam.fecha ? fechaLinda(jam.fecha) : '', jam.hora, jam.lugar].filter(Boolean).join('  ·  ');
    try {
      const blob = setlistDocx(jam, id => store.song(id), sub, 'JAM PORTAL');
      const nombre = (jam.nombre || 'setlist').replace(/[^\w\sÁ-ú-]/g, '').trim().replace(/\s+/g, '-');
      descargarBlob(`${nombre}${jam.fecha ? '-' + jam.fecha : ''}.docx`, blob);
      toast('Setlist descargado', 'ok');
    } catch (e) {
      console.error(e);
      toast('No se pudo generar el .docx', 'err');
    }
  }

  function pintar() {
    clear(cont);
    const plan = agenda(jam, id => store.song(id));

    cont.append(
      h('div.mv-cab', {},
        h('h1', {}, jam.nombre || 'Jam sin nombre'),
        h('div.mv-cab-sub', {},
          [jam.fecha ? fechaLinda(jam.fecha) : '', jam.lugar].filter(Boolean).join(' · ')
          || 'sin fecha')),
      tira(plan));

    if (!plan.filas.length) {
      cont.appendChild(h('div.empty', {},
        h('b', {}, 'La lista está vacía'),
        h('a.btn.sm', { href: `#/jams/${jam.id}/editar`, style: { marginTop: '12px' } }, 'Armarla')));
      return;
    }

    const lista = h('div.mv-lista');
    plan.filas.forEach(f => {
      if (f.tipo === 'bloque') {
        lista.appendChild(h('div.mv-bloque', {}, f.label || 'BLOQUE'));
        return;
      }
      if (f.tipo === 'break') {
        lista.appendChild(h('div.mv-break', {},
          h('span.mv-break-txt', {}, `${f.label} · ${f.minutos}′`),
          f.hora ? h('span.mv-break-hora', {}, f.hora) : null));
        return;
      }
      if (f.tipo === 'medley') {
        lista.appendChild(h('div.mv-medley', {},
          h('div.mv-medley-cab', {},
            h('span.mv-n', {}, f.n),
            /* casi todos los medleys se llaman "Medley": repetirlo al lado
               del cartel no agrega nada y se come el ancho del renglón */
            h('span.mv-txt', {}, h('b', {}, 'MEDLEY'),
              /^medley$/i.test(f.titulo.trim()) ? null : h('span.mv-art', {}, ' ' + f.titulo)),
            h('span.mv-dur', {}, duracionLinda(f.seg))),
          ...f.songs.map((x, k) => renglon({ ...x, jamId: jam.id },
            `${f.n}${String.fromCharCode(97 + k)}`))));
        return;
      }
      lista.appendChild(renglon({ ...f, jamId: jam.id }, f.n));
    });
    cont.appendChild(lista);
  }

  pintar();
  /* El ⋯ de la barra de arriba es de la vista, no del chrome: cada
     pantalla pone ahí lo suyo y el router lo limpia al navegar. */
  accionesDePagina(menu);

  return frag(
    cont,
    h('button.fab', {
      title: 'Anotar un tema en Ideas',
      onclick: () => dialogoNuevaIdea(() => {}, { simple: true }),
    }, '＋'));
}
