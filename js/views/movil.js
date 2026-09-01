/* ============================================================
   views/movil.js — la jam en el celular
   ------------------------------------------------------------
   Un documento, no un editor. Se abre parado en el Portal, con
   una mano, para saber qué viene y a qué hora se termina.

   Por eso el renglón dice lo mínimo —número, título y quién
   canta— y nada más. El artista no entra sin comerse el nombre
   del cantante, que es el dato que se busca de verdad mirando
   la lista, así que vive en el detalle: se toca el tema y ahí
   están artista, duración, cantante y el link a Spotify.

   Se abre solo para leer: tocar un tema muestra su detalle y
   nada más se puede romper. "Editar", arriba, prende el modo
   edición —manijas para arrastrar, sacar cosas, tocar breaks y
   bloques— y el ＋ de al lado suma un tema o un medley. El ⋯
   sigue abriendo la lista entera como texto a pantalla
   completa, y el editor completo existe en #/jams/:id/editar
   ============================================================ */

import { store, esNueva } from '../store.js';
import {
  h, frag, clear, toast, fechaLinda, copiar, hojaAcciones, confirmar,
  descargarBlob, modal, field, input, poner,
} from '../ui.js';
import { agenda, duracionLinda, largoLindo } from '../duracion.js';
import { linkSpotify } from '../spotify.js';
import { notaDe } from '../notas.js';
import { anotarIdea } from './ideas.js';
import { dialogoCancion } from './song-form.js';
import { songAutocomplete } from '../ui.js';
import { buscarEnWeb, webAResultado } from '../lookup.js';
import { asegurarTempo } from '../tempo.js';
import { accionesDePagina, refrescar } from '../app.js';
import { setlistDocx } from '../docx.js';
import { setlistATexto, textoASetlist } from '../setlist-texto.js';
import { dialogoLink, dialogoRespaldos } from './compartir-jam.js';
import { buscarCifra, urlBusqueda } from '../cifra.js';

/* ============================================================
   Qué tan apretada va la lista
   ------------------------------------------------------------
   Arranca compacta porque el uso real es mirar la jam entera de
   un vistazo, no leer un tema. Quien prefiera renglones grandes
   lo cambia una vez desde el ⋯ y queda así en ese teléfono.
   ============================================================ */
const CLAVE_D = 'jamportal.movil.densidad';
const DENSIDADES = [
  { v: 'comoda',   label: 'Cómoda',   hint: 'renglones grandes, para leer de lejos' },
  { v: 'normal',   label: 'Normal',   hint: 'el punto medio' },
  { v: 'compacta', label: 'Compacta', hint: 'entra toda la jam de una' },
];

function densidad() {
  const v = localStorage.getItem(CLAVE_D);
  return DENSIDADES.some(d => d.v === v) ? v : 'compacta';
}

/* ============================================================
   Ver los instrumentos de cada tema
   ------------------------------------------------------------
   Al lado del título, en el mismo renglón: la trompeta si lleva
   vientos, los guitarristas de esta jam (con quién hace el
   solo), el patch de teclado y los invitados. Se prende con el
   🎸 de arriba y queda guardado en este teléfono.
   ============================================================ */
const CLAVE_I = 'jamportal.movil.instrumentos';
const verInstrumentos = () => localStorage.getItem(CLAVE_I) === '1';

function instrumentosDe(f, s) {
  const partes = [];
  if (s.vientos) partes.push('🎺');
  (f.guitarras || []).filter(g => g && g.nombre).forEach(g =>
    partes.push('🎸 ' + g.nombre + (g.solo ? ' (solo)' : '')));
  if ((s.patches || []).length) partes.push('🎹 ' + s.patches.join(' '));
  (s.invitados || []).forEach(x => partes.push(x));
  if (!partes.length) return null;
  return h('span.mv-instr', {}, ' ' + partes.join(' · '));
}

/* ============================================================
   El horario: de qué hora a qué hora, y el break en el medio
   ------------------------------------------------------------
   La barra se toca: cada segmento dice qué tema (o qué sección)
   es y cuánto dura. Y tiene dos modos —tema por tema, o por
   sección usando los bloques de la lista— que se cambian desde
   el botoncito del pie y quedan guardados en este teléfono.
   ============================================================ */
const CLAVE_TL = 'jamportal.movil.timeline';
const modoTimeline = () => localStorage.getItem(CLAVE_TL) === 'secciones' ? 'secciones' : 'temas';

/** La barra agrupada por sección: de cada bloque hasta el siguiente. */
function tramosPorSeccion(filas) {
  const tramos = [];
  let actual = null, ultimoLabel = 'Arranque';
  for (const f of filas) {
    if (f.tipo === 'bloque') {
      ultimoLabel = f.label || 'BLOQUE';
      actual = { tipo: 'seccion', label: ultimoLabel, hora: f.hora, seg: 0 };
      tramos.push(actual);
      continue;
    }
    if (!f.seg) continue;
    /* el break corta la sección en dos: si se sumara al tramo, el dibujo
       quedaría con la sección entera antes del break, que no es lo que pasa */
    if (f.tipo === 'break') {
      tramos.push({ tipo: 'break', label: f.label, minutos: f.minutos, hora: f.hora, seg: f.seg });
      actual = null;
      continue;
    }
    if (!actual) {
      actual = { tipo: 'seccion', label: ultimoLabel, hora: f.hora, seg: 0 };
      tramos.push(actual);
    }
    actual.seg += f.seg;
  }
  return tramos.filter(tr => tr.seg > 0);
}

function tira(plan, alTocar, alCambiarModo) {
  const hayBloques = plan.filas.some(f => f.tipo === 'bloque');
  const modo = hayBloques ? modoTimeline() : 'temas';

  const tramos = modo === 'secciones'
    ? tramosPorSeccion(plan.filas)
    : plan.filas.filter(f => f.tipo !== 'bloque' && f.seg > 0);

  /* qué dice el pie cuando tocás un segmento */
  const leyenda = tr => {
    const hora = tr.hora ? ` · ${tr.hora}` : '';
    if (tr.tipo === 'seccion') return `${tr.label} — ${largoLindo(tr.seg)}${hora}`;
    if (tr.tipo === 'break')   return `${tr.label || 'BREAK'} — ${tr.minutos}′${hora}`;
    if (tr.tipo === 'medley') {
      const nums = (tr.songs || []).map(x => x.numero).filter(Boolean);
      const rango = nums.length ? `${nums[0]}–${nums[nums.length - 1]}. ` : '';
      return `${rango}MEDLEY`
        + (/^medley$/i.test((tr.titulo || '').trim()) ? '' : ` ${tr.titulo}`)
        + ` — ${duracionLinda(tr.seg)}${hora}`;
    }
    return `${tr.numero}. ${tr.song ? tr.song.titulo : '—'} — ${duracionLinda(tr.seg)}${hora}`;
  };

  const info = h('div.mv-tl-info', { hidden: true });
  const barra = h('div.mv-tl-barra');
  if (plan.total > 0) {
    let seccionN = 0;
    tramos.forEach(tr => {
      if (tr.tipo === 'seccion') seccionN++;
      const seg = h('button.mv-tl-seg'
        + (tr.tipo === 'break' ? '.brk' : '')
        + (tr.tipo === 'seccion' && seccionN % 2 === 0 ? '.s2' : ''), {
        style: { width: (tr.seg / plan.total) * 100 + '%' },
        onclick: () => {
          const otra = !seg.classList.contains('on');
          barra.querySelectorAll('.on').forEach(el => el.classList.remove('on'));
          info.hidden = !otra;
          if (otra) { seg.classList.add('on'); info.textContent = leyenda(tr); }
        },
      });
      barra.appendChild(seg);
    });
  }

  /* Cada canción cuenta, también las de adentro de un medley: es lo mismo
     que dice la numeración de la lista. */
  const nTemas = plan.temas;

  /* Sin hora de arranque no hay reloj que mostrar, pero el largo total
     sigue sirviendo: es lo que dura la jam, empiece cuando empiece. Y
     que diga "poné la hora" es justamente dónde se toca para ponerla. */
  return h('div.mv-timeline', {},
    h('button.mv-tl-horas', {
      onclick: alTocar,
      title: 'Tocar para cambiar la fecha, la hora de arranque y el lugar',
    },
      h('span.mv-tl-hora' + (plan.inicio ? '' : '.vacia'), {}, plan.inicio || 'poné la hora'),
      h('span.mv-tl-largo', {}, largoLindo(plan.total)),
      h('span.mv-tl-hora', {}, plan.fin || '')),
    barra,
    info,
    h('div.mv-tl-pie', {},
      h('span', {},
        `${nTemas} tema${nTemas === 1 ? '' : 's'}`,
        plan.breaks ? ` · ${Math.round(plan.breaks / 60)}′ de break` : '',
        plan.sinDato ? ` · ${plan.sinDato} estimado${plan.sinDato === 1 ? '' : 's'}` : ''),
      hayBloques
        ? h('button.mv-tl-toggle', {
            onclick: () => {
              localStorage.setItem(CLAVE_TL, modo === 'secciones' ? 'temas' : 'secciones');
              alCambiarModo();
            },
          }, modo === 'secciones' ? '▤ por sección' : '♪ por tema')
        : null));
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
  if (!Array.isArray(jam.items)) jam.items = [];

  /* Las históricas y las cerradas son el registro de lo que ya pasó: no se
     reordenan desde acá. Para abrirlas está el candado del editor completo,
     que es donde vive esa decisión y pide confirmación. */
  const editable = () => !(jam.historica || jam.cerrada);

  /* La vista arranca solo para leer: nada de manijas ni de sacar cosas por
     accidente con el teléfono en el bolsillo. "Editar", arriba, prende el
     modo edición; "Listo" lo apaga. El ＋ de arriba suma un tema o un
     medley sin pasar por el modo edición: apretarlo ya es querer editar. */
  let editando = false;
  const puedeTocar = () => editable() && editando;

  const cont = h('div.movil', { dataset: { d: densidad() } });
  const lista = h('div.mv-lista');

  function guardar() { store.commit(); }

  /* ============================================================
     Detalle de un tema — lo que no entra en el renglón
     ============================================================ */
  function hojaTema(f, sacar) {
    const s = f.song;
    if (!s) return;
    const cantantes = (f.cantantes || []).join(', ');
    const url = linkSpotify(s);
    const nota = notaDe(jam.id, s.id);

    const detalle = h('div.hoja-detalle', {},
      h('div.hd-fila', {}, h('span', {}, 'Artista'), h('b', {}, s.artista || '—')),
      h('div.hd-fila', {}, h('span', {}, 'Dura'),
        h('b', {}, duracionLinda(f.seg)),
        s.duracionSec ? null : h('em', {}, ' estimado')),
      h('div.hd-fila', {}, h('span', {}, 'Canta'), h('b', {}, cantantes || '—')),
      h('div.hd-fila', {}, h('span', {}, 'Tocada'),
        (s.jams || []).length
          ? h('b', {}, `${s.jams.length} ${s.jams.length === 1 ? 'vez' : 'veces'}`)
          : esNueva(s)
            ? h('b', { style: { color: 'var(--err)' } }, 'nunca — es nueva')
            : h('b', {}, 'nunca — pero ya la saben')),
      s.bpm ? h('div.hd-fila', {}, h('span', {}, 'Tempo'),
        h('b', {}, `${s.bpmFuente === 'sugerido' ? '≈ ' : ''}${s.bpm} bpm`)) : null,
      nota ? h('div.hd-nota', {}, '📝 ' + nota) : null);

    hojaAcciones(s.titulo, [
      url ? { icono: '♫', clase: 'spotify',
              texto: s.spotifyUrl ? 'Escuchar en Spotify' : 'Buscar en Spotify',
              onClick: () => window.open(url, '_blank', 'noopener') } : null,
      { icono: '🎸', texto: s.cifraUrl ? 'Abrir la cifra' : 'Buscar la cifra',
        onClick: async () => {
          if (s.cifraUrl) { window.open(s.cifraUrl, '_blank', 'noopener'); return; }
          const r = await buscarCifra(s.titulo, s.artista).catch(() => null);
          if (r) {
            store.updateSong(s.id, { cifraUrl: r.url, cifraArtista: r.artista, cifraConfianza: r.confianza });
            window.open(r.url, '_blank', 'noopener');
          } else {
            store.updateSong(s.id, { cifraUrl: '', cifraConfianza: 'no' });
            window.open(urlBusqueda(s.titulo, s.artista), '_blank', 'noopener');
          }
        } },
      /* Editar el tema toca el catálogo de la banda, y por el link eso no
         viaja: crear_song_publica solo da de alta, nunca renombra. */
      puedeTocar() && !store.publico
        ? { icono: '✎', texto: 'Editar el tema', onClick: () => dialogoCancion(s, pintar) } : null,
      puedeTocar() && sacar
        ? { icono: '✕', texto: sacar.texto, peligro: true, onClick: sacar.hacer }
        : null,
    ], { detalle });
  }

  /* ============================================================
     Lo que no es un tema suelto: medley, break y bloque
     ------------------------------------------------------------
     Los tres se podían agregar y no se podían sacar: la fila no
     tenía dónde tocar. Ahora cada uno abre su propia hoja, con lo
     poco que hay para hacerle y el sacar al final.
     ============================================================ */
  function hojaMedley(f, pos, quitar) {
    const detalle = h('div.hoja-detalle', {},
      ...f.songs.map((x, k) => h('div.hd-fila', {},
        h('span', {}, String(x.numero || k + 1)),
        h('b', {}, x.song ? x.song.titulo : '—'),
        (x.cantantes || []).length ? h('em', {}, ' ' + x.cantantes.join(', ')) : null)),
      h('div.hd-fila', {}, h('span', {}, 'Dura'), h('b', {}, duracionLinda(f.seg))));

    hojaAcciones(f.titulo || 'Medley', [
      { icono: '⊟', texto: 'Desarmarlo y dejar los temas sueltos', onClick: () => {
          jam.items.splice(pos, 1, ...f.songs.map(x => ({
            tipo: 'song', songId: x.songId, cantantes: x.cantantes || [], notas: '' })));
          guardar(); pintar();
          toast(`${f.songs.length} temas sueltos`, 'ok');
        } },
      { icono: '✕', texto: 'Sacar el medley de la lista', peligro: true, onClick: quitar },
    ], { detalle });
  }

  function hojaBreak(f, pos, quitar) {
    hojaAcciones(f.label || 'BREAK', [
      { icono: '⏱', texto: 'Cambiar los minutos', onClick: () => dialogoBreak(pos) },
      { icono: '✕', texto: 'Sacar el break de la lista', peligro: true, onClick: quitar },
    ], { detalle: h('div.hoja-detalle', {},
      h('div.hd-fila', {}, h('span', {}, 'Dura'), h('b', {}, `${f.minutos} minutos`)),
      f.hora ? h('div.hd-fila', {}, h('span', {}, 'Cae'), h('b', {}, f.hora)) : null) });
  }

  function dialogoBreak(pos) {
    const it = jam.items[pos];
    const fMin = h('input', { type: 'number', min: 1, max: 90, value: it.minutos || 15 });
    const fNom = input({ value: it.label || 'BREAK' });
    const m = modal({
      title: 'El break',
      body: [field('Nombre', fNom), field('Minutos', fMin)],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        h('button.btn.primary', { onclick: () => {
            it.label = fNom.value.trim() || 'BREAK';
            it.minutos = parseInt(fMin.value, 10) || 0;
            guardar(); m.close(); pintar(); toast('Break actualizado', 'ok');
          } }, 'Guardar'),
      ],
    });
    setTimeout(() => fMin.focus(), 80);
  }

  function dialogoBloque(pos) {
    const it = jam.items[pos];
    const fNom = input({ value: it.label || '', placeholder: 'ROCK NACIONAL, 2000s, PIANO BAR…' });
    const m = modal({
      title: 'El bloque',
      body: [field('Nombre', fNom)],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        h('button.btn.primary', { onclick: () => {
            it.label = fNom.value.trim();
            guardar(); m.close(); pintar(); toast('Bloque actualizado', 'ok');
          } }, 'Guardar'),
      ],
    });
    setTimeout(() => { fNom.focus(); fNom.select(); }, 80);
  }

  function hojaBloque(f, pos, quitar) {
    hojaAcciones(f.label || 'Bloque', [
      { icono: '✎', texto: 'Cambiarle el nombre', onClick: () => dialogoBloque(pos) },
      { icono: '✕', texto: 'Sacar el bloque de la lista', peligro: true, onClick: quitar },
    ]);
  }

  /* ============================================================
     Sumar a esta jam: al final con el ＋ de arriba, o justo abajo
     de una línea con su ＋ (solo en modo edición)
     ------------------------------------------------------------
     El ＋ antes anotaba en Ideas, y adentro de una jam eso es lo
     que nadie espera: agregás un tema, volvés a la lista y no
     está. Ahora suma acá, que es lo que se estaba pidiendo. Para
     el cuaderno de ideas quedó su entrada propia en el ⋯.
     ============================================================ */
  /** Mete el ítem en `pos` (o al final) y baja hasta lo recién puesto. */
  function insertarItem(item, aviso, pos = null) {
    const idx = (pos == null || pos > jam.items.length) ? jam.items.length : pos;
    jam.items = [...jam.items.slice(0, idx), item, ...jam.items.slice(idx)];
    guardar(); pintar();
    toast(aviso, 'ok');
    const el = lista.querySelector(`[data-i="${idx}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return idx;
  }

  const sumarTema = (song, pos = null) => insertarItem(
    { tipo: 'song', songId: song.id, cantantes: [], notas: '' },
    pos == null ? `«${song.titulo}» al final de la lista` : `«${song.titulo}» agregada`,
    pos);

  /** Un medley que ya se armó antes, entero: sus temas y sus cantantes. */
  const sumarMedley = (m, pos = null) => insertarItem(
    { tipo: 'medley', titulo: m.titulo, notas: '',
      songs: m.songs.map(x => ({ songId: x.songId, cantantes: [...(x.cantantes || [])] })) },
    pos == null ? `Medley de ${m.temas.length} temas al final de la lista`
                : `Medley de ${m.temas.length} temas agregado`,
    pos);

  /** El ＋ de una línea: qué va justo abajo — tema/medley, break o bloque. */
  function hojaInsertar(pos) {
    hojaAcciones('Agregar justo abajo', [
      { icono: '♪', texto: 'Un tema o un medley', onClick: () => dialogoAgregar(pos + 1) },
      { icono: '⏱', texto: 'Un break', onClick: () => {
          const idx = insertarItem({ tipo: 'break', label: 'BREAK', minutos: 15 },
            'Break de 15′ — tocalo para cambiarlo', pos + 1);
          dialogoBreak(idx);
        } },
      { icono: '▭', texto: 'Un bloque — el rótulo de una sección', onClick: () => {
          const idx = insertarItem({ tipo: 'bloque', label: '' }, 'Bloque agregado', pos + 1);
          dialogoBloque(idx);
        } },
    ]);
  }

  function botonInsertar(pos) {
    return h('button.mv-sumar', {
      title: 'Agregar justo abajo',
      onclick: e => {
        e.stopPropagation();
        if (performance.now() - finArrastre < 300) return;
        hojaInsertar(pos);
      },
    }, '＋');
  }

  /**
   * Buscador a pantalla completa.
   *
   * Adentro de un diálogo no entra: el `.modal` tiene alto máximo y
   * `overflow: auto`, y el desplegable va posicionado absoluto, así que
   * se cortaba a los tres resultados. Acá el desplegable deja de flotar
   * y pasa a ser el cuerpo de la pantalla: se lleva todo el alto que
   * quede libre, que con el teclado abierto es justo el que hay.
   */
  function panelBuscar({ titulo, ayuda, alElegir, alCrearWeb, alEscribir, alElegirMedley }) {
    const cerrar = () => { panel.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') cerrar(); };

    /* Dos modos, no una lista mezclada. Los medleys son otra cosa que un tema
       suelto —entran de a cinco canciones— y buscarlos es una decisión que se
       toma antes de escribir, no algo que uno espera encontrar entre los
       resultados. */
    let modo = 'temas';
    const cuerpo = h('div.bf-cuerpo');

    const pill = (v, texto) => h('button.bf-pill' + (modo === v ? '.on' : ''), {
      onclick: () => { if (modo !== v) { modo = v; pintar(); } },
    }, texto);

    const pills = h('div.bf-pills');
    function pintarPills() {
      poner(clear(pills), pill('temas', '♪ Temas'), pill('medleys', '⛓ Medleys'));
    }

    /* ---- modo temas: el buscador de siempre ---- */
    function vistaTemas() {
      const ac = songAutocomplete({
        placeholder: 'Nombre del tema…',
        buscar: q => store.searchSongs(q, 25),
        onPick: s => { cerrar(); alElegir(s); },
        buscarWeb: buscarEnWeb,
        onPickWeb: r => { cerrar(); alCrearWeb(r); },
        onNew: q => { cerrar(); alEscribir(q); },
        /* acá el desplegable es la pantalla: bajar el teclado no la cierra */
        cerrarAlSalir: false,
      });
      setTimeout(() => ac.focusInput && ac.focusInput(), 60);
      return ac;
    }

    /* ---- modo medleys: la lista entera, filtrable ---- */
    function vistaMedleys() {
      /* Todos, incluidos los de esta jam: si querés repetir un medley que ya
         está en la lista, es una decisión tuya y no algo que haya que
         esconder. Solo se juntan los que tienen exactamente los mismos temas,
         que son el mismo medley escrito dos veces. */
      const todos = store.medleys();
      const lista = h('div.ac-menu.bf-lista');
      const busca = h('input', {
        type: 'search', placeholder: 'Filtrar medleys…',
        autocomplete: 'off', spellcheck: false,
      });

      function pintarLista() {
        clear(lista);
        const hay = store.medleys(busca.value);
        if (!hay.length) {
          lista.appendChild(h('div.ac-loading', {}, todos.length
            ? 'Ningún medley con ese filtro'
            : 'Todavía no armaron ningún medley. Los que armes acá van a '
              + 'aparecer la próxima vez.'));
          return;
        }
        hay.forEach(m => lista.appendChild(h('div.ac-item.ac-medley', {
          onclick: () => { cerrar(); alElegirMedley(m); },
        },
          h('div', { style: { minWidth: 0 } },
            /* Los temas van enteros y no cortados con puntos suspensivos:
               el título casi siempre es "Medley" a secas, así que lo único
               que distingue a uno de otro es qué tiene adentro. */
            h('div.ac-t', {}, '⛓ ' + m.titulo),
            h('div.ac-s.entera', {}, m.temas.map(t => t.titulo).join(' · '))),
          h('div.ac-r', {},
            h('span.chip', {}, m.temas.length + ' temas'),
            m.veces > 1 ? h('span.chip', {}, m.veces + '×') : null))));
      }

      busca.placeholder = `Filtrar ${todos.length} medleys…`;
      busca.addEventListener('input', pintarLista);
      pintarLista();
      setTimeout(() => busca.focus(), 60);
      return h('div.ac-wrap', {}, busca, lista);
    }

    function pintar() {
      pintarPills();
      poner(clear(cuerpo), modo === 'temas' ? vistaTemas() : vistaMedleys());
    }

    const panel = h('div.buscador-full', {},
      h('div.mv-ed-barra', {},
        h('button.tb-btn', { onclick: cerrar, title: 'Cerrar' }, '✕'),
        h('div.mv-ed-tit', {}, titulo)),
      h('div.bf-ayuda', {}, ayuda),
      alElegirMedley ? pills : null,
      cuerpo);

    pintar();
    clear(document.getElementById('modalRoot')).appendChild(panel);
    document.addEventListener('keydown', esc);
  }

  /** @param pos dónde meter lo elegido; null = al final */
  function dialogoAgregar(pos = null) {
    panelBuscar({
      titulo: 'Sumar a ' + (jam.nombre || 'la jam'),
      ayuda: 'Busco en el repertorio y después en internet; si no aparece, se '
           + 'agrega con lo que escribas. Para sumar un medley entero, tocá Medleys.',
      alElegir: s => sumarTema(s, pos),
      alElegirMedley: m => sumarMedley(m, pos),
      alCrearWeb: r => {
        const s = store.addSong(webAResultado(r));
        sumarTema(s, pos);
        if (!s.bpm) asegurarTempo(s, { alTerminar: pintar });   // el tempo llega solo
      },
      /* Si no está en ningún lado, entra igual con lo que escribiste: en el
         celular, frenar la carga para pedir artista y categoría es perder el
         tema. Los datos que falten se completan después. */
      alEscribir: q => sumarTema(store.addSong({ titulo: q, artista: '' }), pos),
    });
  }

  function dialogoIdea() {
    panelBuscar({
      titulo: 'Anotar en Ideas',
      ayuda: 'Queda en el cuaderno de ideas, sin entrar en esta jam.',
      alElegir: s => toast(s.esIdea ? `«${s.titulo}» ya está en Ideas`
        : `«${s.titulo}» ya está en el repertorio`, s.esIdea ? '' : 'err'),
      alCrearWeb: r => anotarIdea(webAResultado(r)),
      alEscribir: q => anotarIdea({ titulo: q, artista: '' }),
    });
  }

  /* ============================================================
     Fecha, hora y lugar — se llega tocando el timeline
     ============================================================ */
  function dialogoHorario() {
    const fFecha = h('input', { type: 'date', value: jam.fecha || '' });
    const fHora  = h('input', { type: 'time', value: jam.hora || '' });
    const fLugar = input({ value: jam.lugar || '', placeholder: 'Portal' });

    const m = modal({
      title: 'Cuándo y dónde',
      body: [
        h('div.method-hint', {},
          'La hora de arranque es la que manda en el horario de la lista: de ahí para '
          + 'abajo se van sumando los temas, los respiros y los breaks.'),
        field('Fecha', fFecha),
        field('Hora de arranque', fHora),
        field('Lugar', fLugar),
      ],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        h('button.btn.primary', {
          onclick: () => {
            jam.fecha = fFecha.value || '';
            jam.hora = fHora.value || '';
            jam.lugar = fLugar.value.trim();
            guardar(); m.close(); pintar();
            toast(jam.hora ? `Arranca ${jam.hora}` : 'Guardado', 'ok');
          },
        }, 'Guardar'),
      ],
    });
    setTimeout(() => fHora.focus(), 80);
  }

  /* ============================================================
     La lista como texto, a pantalla completa
     ------------------------------------------------------------
     Es la forma de editar que sirve con el dedo: se ve todo junto,
     se corta y se pega, se agrega escribiendo. Guardar vuelve acá.
     ============================================================ */
  function editorTexto() {
    const ta = h('textarea.mv-ta', {
      value: setlistATexto(jam, store), spellcheck: false,
      autocapitalize: 'off', autocorrect: 'off',
    });
    const pie = h('div.mv-ed-pie');
    let analisis = { items: [], lineas: [] };

    function analizar() {
      analisis = textoASetlist(ta.value, store);
      const enMedleys = analisis.items.filter(it => it.tipo === 'medley')
        .reduce((a, m) => a + m.songs.length, 0);
      const temas = analisis.items.filter(it => it.tipo === 'song').length + enMedleys;
      const falt = analisis.lineas.filter(l => l.tipo === 'tema' && !l.match && l.titulo);
      clear(pie);
      pie.append(h('b', {}, `${temas} temas`),
        falt.length
          ? h('span.mv-ed-falta', {},
              ` · ${falt.length} sin reconocer: ${falt.slice(0, 3).map(l => l.titulo).join(', ')}`
              + (falt.length > 3 ? '…' : '') + ' — se guardan sin esas')
          : h('span', {}, ' · todo reconocido'));
    }

    const cerrar = () => { pantalla.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') cerrar(); };

    const pantalla = h('div.mv-editor', {},
      h('div.mv-ed-barra', {},
        h('button.tb-btn', { onclick: cerrar, title: 'Salir sin guardar' }, '✕'),
        h('div.mv-ed-tit', {}, 'Editar como texto'),
        h('button.btn.sm.primary', {
          onclick: () => {
            if (!analisis.items.length) { toast('La lista quedaría vacía', 'err'); return; }
            jam.items = analisis.items;
            guardar(); cerrar(); pintar();
            toast('Lista actualizada', 'ok');
          },
        }, 'Guardar')),
      ta,
      pie);

    ta.addEventListener('input', () => {
      clearTimeout(ta._t);
      ta._t = setTimeout(analizar, 250);
    });
    analizar();

    clear(document.getElementById('modalRoot')).appendChild(pantalla);
    document.addEventListener('keydown', esc);
  }

  /* ============================================================
     Reordenar con el dedo
     ------------------------------------------------------------
     El drag-and-drop de HTML5 no existe en el celular, así que va
     con eventos de puntero y una manija propia: `touch-action:none`
     solo en la manija, para que el resto de la lista siga scrolleando
     normalmente.

     Mientras arrastrás, la fila se mueve en el DOM en cuanto cruza el
     medio de su vecina. Eso le cambia la posición de layout, así que
     después de cada movida se corrige el punto de origen: sin eso la
     fila pega un salto justo cuando la estás soltando.
     ============================================================ */
  let arrastre = null;
  /* Cuándo terminó el último arrastre. Es una marca de tiempo y no un
     "ignorá el próximo click": al soltar se redibuja la lista, así que el
     click que había que tragarse nunca llega a la fila nueva — y la bandera
     quedaba puesta, comiéndose el toque siguiente, que sí era de verdad. */
  let finArrastre = 0;

  function manija() {
    const asa = h('span.mv-handle', { title: 'Arrastrar para mover' }, '⠿');

    /* La manija no sabe de antemano a quién mueve: la fila todavía no
       existe cuando se la crea. La resuelve al agarrarla, subiendo hasta
       el primer ancestro con `data-i`, que es la unidad que se reordena
       —el tema, el bloque, el break o el medley entero. */
    asa.addEventListener('pointerdown', e => {
      if (arrastre) return;                 // dos dedos a la vez: gana el primero
      const fila = asa.closest('[data-i]');
      if (!fila) return;
      e.preventDefault();
      e.stopPropagation();
      /* La captura es lo que hace que el dedo siga mandando aunque se salga
         de la manija. Si el navegador la niega, el arrastre igual arranca. */
      try { asa.setPointerCapture(e.pointerId); } catch { /* seguimos igual */ }
      arrastre = { fila, y0: e.clientY, y: e.clientY, movio: false };
      fila.classList.add('mv-arrastrando');
      document.body.classList.add('mv-arrastrando-algo');
      autoScroll();
    });

    asa.addEventListener('pointermove', e => {
      if (!arrastre) return;
      arrastre.y = e.clientY;
      acomodar();
    });

    const soltar = () => {
      if (!arrastre) return;
      const fila = arrastre.fila;
      fila.style.transform = '';
      fila.classList.remove('mv-arrastrando');
      document.body.classList.remove('mv-arrastrando-algo');
      const movio = arrastre.movio;
      arrastre = null;
      if (!movio) return;
      /* el orden nuevo sale del DOM, que es lo que la persona vio */
      const orden = [...lista.children]
        .filter(el => el.dataset.i !== undefined)
        .map(el => jam.items[+el.dataset.i]);
      jam.items = orden;
      guardar();
      finArrastre = performance.now();
      pintar();
      toast('Lista reordenada', 'ok');
    };
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);

    return asa;
  }

  /** Mueve la fila y, si cruzó a una vecina, la reubica en el DOM. */
  function acomodar() {
    const { fila } = arrastre;
    fila.style.transform = `translateY(${arrastre.y - arrastre.y0}px)`;

    const r = fila.getBoundingClientRect();
    const centro = r.top + r.height / 2;

    const reubicar = (ref, antes) => {
      const y1 = fila.getBoundingClientRect().top;
      lista.insertBefore(fila, antes ? ref : ref.nextSibling);
      /* corrige el origen para que la fila no salte al cambiar de lugar */
      arrastre.y0 += fila.getBoundingClientRect().top - y1;
      arrastre.movio = true;
      fila.style.transform = `translateY(${arrastre.y - arrastre.y0}px)`;
    };

    const prev = fila.previousElementSibling;
    if (prev) {
      const rp = prev.getBoundingClientRect();
      if (centro < rp.top + rp.height / 2) { reubicar(prev, true); return; }
    }
    const sig = fila.nextElementSibling;
    if (sig) {
      const rs = sig.getBoundingClientRect();
      if (centro > rs.top + rs.height / 2) reubicar(sig, false);
    }
  }

  /** Con el dedo quieto contra el borde, la lista tiene que seguir bajando. */
  function autoScroll() {
    if (!arrastre) return;
    const margen = 90;
    const alto = window.innerHeight;
    let d = 0;
    if (arrastre.y < margen) d = -Math.ceil((margen - arrastre.y) / 6);
    else if (arrastre.y > alto - margen) d = Math.ceil((arrastre.y - (alto - margen)) / 6);
    if (d) {
      const antes = window.scrollY;
      window.scrollBy(0, d);
      /* la pantalla se movió pero el dedo no: el origen se corre con ella */
      arrastre.y0 -= window.scrollY - antes;
      acomodar();
    }
    requestAnimationFrame(autoScroll);
  }

  /* ============================================================
     El ⋯ de la barra de arriba
     ============================================================ */
  function menu() {
    const conCuenta = !store.publico;
    hojaAcciones(jam.nombre || 'Jam', [
      editable()
        ? { icono: '✎', texto: 'Editar la lista como texto', onClick: editorTexto }
        : { icono: '🔒', texto: 'Está cerrada — abrirla en el editor',
            onClick: () => { location.hash = `#/jams/${jam.id}/editar`; } },
      { icono: '🕘', texto: 'Fecha, hora y lugar', onClick: dialogoHorario },
      { icono: '▤', texto: 'Tamaño de la lista: ' + DENSIDADES.find(d => d.v === densidad()).label.toLowerCase(),
        onClick: hojaDensidad },
      { icono: '📋', texto: 'Copiar la lista como texto', onClick: () => copiar(comoTexto()) },
      { icono: '⬇', texto: 'Bajar el setlist en Word', onClick: bajarDocx },

      /* Lo de abajo es de la banda. Por el link no aparece: LIVE VIEW y las
         letras van por rutas normales, que sin sesión no devuelven nada, y
         duplicar o borrar la jam entera no es algo que deba poder hacer
         cualquiera que reciba el link por WhatsApp. */
      ...(conCuenta ? [
        { icono: '💡', texto: 'Anotar un tema en Ideas (sin sumarlo acá)', onClick: dialogoIdea },
        { icono: '🔗', texto: 'Link para compartir esta jam', onClick: () => dialogoLink(jam) },
        /* refrescar() y no pintar(): sincronizar() reemplaza los objetos del
           estado y la `jam` de esta vista queda apuntando a la versión vieja. */
        { icono: '↩', texto: 'Versiones anteriores de la lista',
          onClick: () => dialogoRespaldos(jam, refrescar) },
        { icono: '▶', texto: 'LIVE VIEW — pasarla en la jam', onClick: () => { location.hash = '#/live/' + jam.id; } },
        { icono: '📖', texto: 'Las letras, en orden', onClick: () => { location.hash = '#/lyrics/' + jam.id; } },
        { icono: '⛶', texto: 'Abrir el editor completo', onClick: () => { location.hash = `#/jams/${jam.id}/editar`; } },
        { icono: '⧉', texto: 'Duplicar la jam', onClick: () => {
            const j = store.duplicateJam(jam.id);
            if (j) { toast('Jam duplicada', 'ok'); location.hash = '#/jams/' + j.id; }
          } },
        { icono: '✕', texto: 'Borrar la jam', peligro: true, onClick: async () => {
            if (await confirmar(`¿Borrar «${jam.nombre || 'esta jam'}»?`, { titulo: 'Borrar jam' })) {
              store.removeJam(jam.id); toast('Jam borrada'); location.hash = '#/jams';
            }
          } },
      ] : []),
    ]);
  }

  function hojaDensidad() {
    const actual = densidad();
    hojaAcciones('Tamaño de la lista', DENSIDADES.map(d => ({
      icono: d.v === actual ? '✓' : ' ',
      texto: `${d.label} — ${d.hint}`,
      onClick: () => {
        localStorage.setItem(CLAVE_D, d.v);
        cont.dataset.d = d.v;
      },
    })));
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

  /* ============================================================
     Un renglón: número, título y quién canta. Nada más.
     ------------------------------------------------------------
     El texto va en un solo nodo con ellipsis. Partirlo en varios
     flex hace que el navegador recorte el título antes que el
     cantante, y con el cantante puesto a mano en esa jam, el que
     no puede faltar es él.
     ============================================================ */
  /**
   * @param {object} f       la fila que devolvió agenda()
   * @param {string|number} num
   * @param {object} [opts]
   * @param {function} [opts.alTocar]  qué abre el toque
   * @param {boolean} [opts.conManija] si se puede arrastrar (solo el 1er nivel)
   */
  function renglon(f, num, { alTocar, conManija = false, pos = null } = {}) {
    const s = f.song;
    const cantantes = (f.cantantes || []).join(', ');

    /* Nunca tocada: lleva una pill de "nueva" al lado del título. Tocarla
       la apaga para siempre —quedó marcada como sabida— así que por el
       link no se puede: ese cambio es del catálogo y no viaja. */
    const pill = s && esNueva(s)
      ? h('button.mv-pill-nueva', {
          title: 'Nunca sonó en una jam. Tocá para marcar que ya la saben.',
          onclick: async e => {
            e.stopPropagation();
            if (store.publico) { toast('Nunca sonó en una jam: hay que ensayarla'); return; }
            if (await confirmar(`«${s.titulo}» nunca sonó en una jam. ¿Marcarla como que ya la saben, para que deje de figurar como nueva?`,
                { titulo: 'Tema nuevo', danger: false, okText: 'Ya no es nueva' })) {
              store.updateSong(s.id, { noEsNueva: true });
              pintar();
              toast(`«${s.titulo}» ya no figura como nueva`, 'ok');
            }
          },
        }, 'nueva')
      : null;

    const instr = verInstrumentos() && s ? instrumentosDe(f, s) : null;

    return h('div.mv-fila', {
      onclick: e => {
        if (e.target.closest('.mv-handle')) return;
        if (performance.now() - finArrastre < 300) return;
        alTocar && alTocar();
      },
    },
      puedeTocar() && conManija ? manija() : null,
      h('span.mv-n', {}, num),
      h('span.mv-txt', {},
        h('b', {}, s ? s.titulo : 'Tema borrado'),
        cantantes ? h('span.mv-quien', {}, ` (${cantantes})`) : null,
        instr),
      pill,
      s && notaDe(jam.id, s.id) ? h('span.mv-nota', {}, '📝') : null,
      h('span.mv-dur', {}, duracionLinda(f.seg)),
      puedeTocar() && pos != null ? botonInsertar(pos) : null);
  }

  function pintar() {
    clear(cont);
    fab.style.display = puedeTocar() ? '' : 'none';
    const plan = agenda(jam, id => store.song(id));

    /* Numeración corrida: cada canción lleva su número, también las de
       adentro de un medley — nada de 4a/4b/4c. agenda() numera el medley
       como una unidad (así lo usan el editor y el texto de WhatsApp), así
       que acá se recorre de nuevo y cada tema recibe el suyo. */
    let numero = 0;
    plan.filas.forEach(f => {
      if (f.tipo === 'song') f.numero = ++numero;
      else if (f.tipo === 'medley') f.songs.forEach(x => { x.numero = ++numero; });
    });

    cont.append(
      h('div.mv-cab', {},
        h('div.mv-cab-txt', {},
          h('h1', {}, jam.nombre || 'Jam sin nombre'),
          h('div.mv-cab-sub', {},
            [jam.fecha ? fechaLinda(jam.fecha) : '', jam.lugar].filter(Boolean).join(' · ')
            || 'sin fecha')),
        h('div.mv-cab-acc', {},
          /* ver instrumentos es leer, así que va aunque la jam esté cerrada */
          h('button.mv-btn-cab.icono' + (verInstrumentos() ? '.on' : ''), {
            title: 'Mostrar los instrumentos de cada tema',
            onclick: () => {
              localStorage.setItem(CLAVE_I, verInstrumentos() ? '' : '1');
              pintar();
            },
          }, '🎸'),
          editable() ? h('button.mv-btn-cab', {
            title: 'Sumar un tema o un medley',
            onclick: () => dialogoAgregar(),
          }, '＋') : null,
          editable() ? h('button.mv-btn-cab' + (editando ? '.on' : ''), {
            onclick: () => { editando = !editando; pintar(); },
          }, editando ? 'Listo' : 'Editar') : null)),
      tira(plan, dialogoHorario, pintar));

    if (!plan.filas.length) {
      cont.appendChild(h('div.empty', {},
        h('b', {}, 'La lista está vacía'),
        editable()
          ? h('button.btn.sm', { style: { marginTop: '12px' }, onclick: editorTexto }, 'Escribirla')
          : h('a.btn.sm', { href: `#/jams/${jam.id}/editar`, style: { marginTop: '12px' } }, 'Abrir el editor')));
      return;
    }

    clear(lista);
    plan.filas.forEach((f, pos) => {
      const marcar = el => { el.dataset.i = pos; return el; };
      /* Sacar cualquier cosa de la lista es lo mismo: correr un ítem del
         arreglo. Antes solo los temas sueltos tenían cómo, así que un
         medley, un break o un bloque entraban y no salían más. */
      const quitar = () => {
        jam.items.splice(pos, 1);
        guardar(); pintar();
        toast('Sacado de la lista');
      };

      if (f.tipo === 'bloque') {
        lista.appendChild(marcar(h('div.mv-bloque', {
          onclick: e => {
            if (e.target.closest('.mv-handle') || !puedeTocar()) return;
            if (performance.now() - finArrastre < 300) return;
            hojaBloque(f, pos, quitar);
          },
        },
          puedeTocar() ? manija() : null,
          h('span', {}, f.label || 'BLOQUE'),
          puedeTocar() ? botonInsertar(pos) : null)));
        return;
      }

      if (f.tipo === 'break') {
        lista.appendChild(marcar(h('div.mv-break', {
          onclick: e => {
            if (e.target.closest('.mv-handle') || !puedeTocar()) return;
            if (performance.now() - finArrastre < 300) return;
            hojaBreak(f, pos, quitar);
          },
        },
          puedeTocar() ? manija() : null,
          h('span.mv-break-txt', {}, `${f.label} · ${f.minutos}′`),
          f.hora ? h('span.mv-break-hora', {}, f.hora) : null,
          puedeTocar() ? botonInsertar(pos) : null)));
        return;
      }

      if (f.tipo === 'medley') {
        lista.appendChild(marcar(h('div.mv-medley', {},
          h('div.mv-medley-cab', {
            onclick: e => {
              if (e.target.closest('.mv-handle') || !puedeTocar()) return;
              if (performance.now() - finArrastre < 300) return;
              hojaMedley(f, pos, quitar);
            },
          },
            puedeTocar() ? manija() : null,
            /* sin número —los llevan sus canciones— y sin la columna del
               número: vacía dejaba a MEDLEY con un margen raro */
            h('span.mv-txt', {}, h('b', {}, 'MEDLEY'),
              /^medley$/i.test(f.titulo.trim()) ? null : h('span.mv-art', {}, ' ' + f.titulo)),
            h('span.mv-dur', {}, duracionLinda(f.seg)),
            puedeTocar() ? botonInsertar(pos) : null),
          ...f.songs.map((x, k) => renglon(x, x.numero, {
            alTocar: () => hojaTema(x, puedeTocar() ? {
              texto: 'Sacar del medley',
              hacer: () => {
                const m = jam.items[pos];
                m.songs.splice(k, 1);
                /* un medley de un solo tema no es un medley: se deshace */
                if (m.songs.length === 1) {
                  jam.items.splice(pos, 1, { tipo: 'song', songId: m.songs[0].songId,
                    cantantes: m.songs[0].cantantes || [], notas: '' });
                } else if (!m.songs.length) {
                  jam.items.splice(pos, 1);
                }
                guardar(); pintar(); toast('Sacado del medley');
              },
            } : null),
          })))));
        return;
      }

      lista.appendChild(marcar(renglon(f, f.numero, {
        conManija: true, pos,
        alTocar: () => hojaTema(f, puedeTocar()
          ? { texto: 'Sacar de la lista', hacer: quitar } : null),
      })));
    });
    cont.appendChild(lista);
  }

  /* El ＋ flotante acompaña al modo edición: mientras solo se lee, con el
     ＋ de arriba alcanza y la lista queda limpia. pintar() lo prende. */
  const fab = h('button.fab', {
    title: 'Sumar un tema a esta jam',
    onclick: () => dialogoAgregar(),
  }, '＋');

  pintar();
  /* El ⋯ de la barra de arriba es de la vista, no del chrome: cada
     pantalla pone ahí lo suyo y el router lo limpia al navegar. */
  accionesDePagina(menu);

  return frag(cont, fab);
}
