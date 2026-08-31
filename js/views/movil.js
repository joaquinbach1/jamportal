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

   Editar también se puede, sin salir: se arrastra de la manija
   para reordenar, se toca el horario para correrlo, y el ⋯ abre
   la lista entera como texto a pantalla completa. El editor
   completo sigue existiendo: #/jams/:id/editar
   ============================================================ */

import { store } from '../store.js';
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
   El horario: de qué hora a qué hora, y el break en el medio
   ============================================================ */
function tira(plan, alTocar) {
  const barra = h('div.mv-tl-barra');
  if (plan.total > 0) {
    plan.filas.forEach(f => {
      if (f.tipo === 'bloque' || !f.seg) return;
      barra.appendChild(h('div.mv-tl-seg' + (f.tipo === 'break' ? '.brk' : ''), {
        style: { width: (f.seg / plan.total) * 100 + '%' },
      }));
    });
  }

  /* Sin hora de arranque no hay reloj que mostrar, pero el largo total
     sigue sirviendo: es lo que dura la jam, empiece cuando empiece. Y
     que diga "poné la hora" es justamente dónde se toca para ponerla. */
  return h('button.mv-timeline', {
    onclick: alTocar,
    title: 'Tocar para cambiar la fecha, la hora de arranque y el lugar',
  },
    h('div.mv-tl-horas', {},
      h('span.mv-tl-hora' + (plan.inicio ? '' : '.vacia'), {}, plan.inicio || 'poné la hora'),
      h('span.mv-tl-largo', {}, largoLindo(plan.total)),
      h('span.mv-tl-hora', {}, plan.fin || '')),
    barra,
    h('div.mv-tl-pie', {},
      `${plan.temas} tema${plan.temas === 1 ? '' : 's'}`,
      plan.breaks ? ` · ${Math.round(plan.breaks / 60)}′ de break` : '',
      plan.sinDato ? ` · ${plan.sinDato} estimado${plan.sinDato === 1 ? '' : 's'}` : ''));
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

  const cont = h('div.movil', { dataset: { d: densidad() } });
  const lista = h('div.mv-lista');

  function guardar() { store.commit(); }

  /* ============================================================
     Detalle de un tema — lo que no entra en el renglón
     ============================================================ */
  function hojaTema(f, indice) {
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
          : h('b', { style: { color: 'var(--err)' } }, 'nunca — es nueva')),
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
      editable() && !store.publico
        ? { icono: '✎', texto: 'Editar el tema', onClick: () => dialogoCancion(s, pintar) } : null,
      editable() && indice != null
        ? { icono: '✕', texto: 'Sacar de la lista', peligro: true,
            onClick: () => { jam.items.splice(indice, 1); guardar(); pintar(); toast('Sacado de la lista'); } }
        : null,
    ], { detalle });
  }

  /* ============================================================
     Sumar un tema a esta jam
     ------------------------------------------------------------
     El ＋ antes anotaba en Ideas, y adentro de una jam eso es lo
     que nadie espera: agregás un tema, volvés a la lista y no
     está. Ahora suma acá, que es lo que se estaba pidiendo. Para
     el cuaderno de ideas quedó su entrada propia en el ⋯.
     ============================================================ */
  function sumarAlFinal(item, aviso) {
    jam.items = [...jam.items, item];
    guardar(); pintar();
    toast(aviso, 'ok');
    /* que baje hasta lo recién puesto, si no quedó a la vista */
    const ultima = lista.lastElementChild;
    if (ultima) ultima.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const sumarTema = song => sumarAlFinal(
    { tipo: 'song', songId: song.id, cantantes: [], notas: '' },
    `«${song.titulo}» al final de la lista`);

  /** Un medley que ya se armó antes, entero: sus temas y sus cantantes. */
  const sumarMedley = m => sumarAlFinal(
    { tipo: 'medley', titulo: m.titulo, notas: '',
      songs: m.songs.map(x => ({ songId: x.songId, cantantes: [...(x.cantantes || [])] })) },
    `Medley de ${m.temas.length} temas al final de la lista`);

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
      const todos = store.medleys('', jam.id);
      const lista = h('div.ac-menu.bf-lista');
      const busca = h('input', {
        type: 'search', placeholder: 'Filtrar medleys…',
        autocomplete: 'off', spellcheck: false,
      });

      function pintarLista() {
        clear(lista);
        const hay = store.medleys(busca.value, jam.id);
        if (!hay.length) {
          lista.appendChild(h('div.ac-loading', {}, todos.length
            ? 'Ningún medley con ese filtro'
            : 'Todavía no armaron ningún medley en otra jam. '
              + 'Los que armes acá van a aparecer la próxima vez.'));
          return;
        }
        hay.forEach(m => lista.appendChild(h('div.ac-item.ac-medley', {
          onclick: () => { cerrar(); alElegirMedley(m); },
        },
          h('div', { style: { minWidth: 0 } },
            h('div.ac-t', {}, '⛓ ' + m.titulo),
            h('div.ac-s', {}, m.temas.map(t => t.titulo).join(' · '))),
          h('div.ac-r', {},
            h('span.chip', {}, m.temas.length + ' temas'),
            m.veces > 1 ? h('span.chip', {}, m.veces + '×') : null))));
      }

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

  function dialogoAgregar() {
    panelBuscar({
      titulo: 'Sumar a ' + (jam.nombre || 'la jam'),
      ayuda: 'Busco en el repertorio y después en internet; si no aparece, se '
           + 'agrega con lo que escribas. Para sumar un medley entero, tocá Medleys.',
      alElegir: sumarTema,
      alElegirMedley: sumarMedley,
      alCrearWeb: r => {
        const s = store.addSong(webAResultado(r));
        sumarTema(s);
        if (!s.bpm) asegurarTempo(s, { alTerminar: pintar });   // el tempo llega solo
      },
      /* Si no está en ningún lado, entra igual con lo que escribiste: en el
         celular, frenar la carga para pedir artista y categoría es perder el
         tema. Los datos que falten se completan después. */
      alEscribir: q => sumarTema(store.addSong({ titulo: q, artista: '' })),
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
  function renglon(f, num, indice) {
    const s = f.song;
    const cantantes = (f.cantantes || []).join(', ');
    /* Nunca tocada: va en rojo clarito. `jams` es la lista de jams en las que
       sonó, así que vacía quiere decir que para la banda es nueva. */
    const nueva = s && !(s.jams || []).length;

    return h('div.mv-fila' + (nueva ? '.nueva' : ''), {
      onclick: e => {
        if (e.target.closest('.mv-handle')) return;
        if (performance.now() - finArrastre < 300) return;
        hojaTema(f, indice);
      },
    },
      editable() && indice != null ? manija() : null,
      h('span.mv-n', {}, num),
      h('span.mv-txt', {},
        h('b', {}, s ? s.titulo : 'Tema borrado'),
        cantantes ? h('span.mv-quien', {}, ` (${cantantes})`) : null),
      s && notaDe(jam.id, s.id) ? h('span.mv-nota', {}, '📝') : null,
      h('span.mv-dur', {}, duracionLinda(f.seg)));
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
      tira(plan, dialogoHorario));

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

      if (f.tipo === 'bloque') {
        lista.appendChild(marcar(h('div.mv-bloque', {},
          editable() ? manija() : null,
          h('span', {}, f.label || 'BLOQUE'))));
        return;
      }
      if (f.tipo === 'break') {
        lista.appendChild(marcar(h('div.mv-break', {},
          editable() ? manija() : null,
          h('span.mv-break-txt', {}, `${f.label} · ${f.minutos}′`),
          f.hora ? h('span.mv-break-hora', {}, f.hora) : null)));
        return;
      }
      if (f.tipo === 'medley') {
        lista.appendChild(marcar(h('div.mv-medley', {},
          h('div.mv-medley-cab', {},
            editable() ? manija() : null,
            h('span.mv-n', {}, f.n),
            h('span.mv-txt', {}, h('b', {}, 'MEDLEY'),
              /^medley$/i.test(f.titulo.trim()) ? null : h('span.mv-art', {}, ' ' + f.titulo)),
            h('span.mv-dur', {}, duracionLinda(f.seg))),
          ...f.songs.map((x, k) => renglon(x, `${f.n}${String.fromCharCode(97 + k)}`, null)))));
        return;
      }
      lista.appendChild(marcar(renglon(f, f.n, pos)));
    });
    cont.appendChild(lista);
  }

  pintar();
  /* El ⋯ de la barra de arriba es de la vista, no del chrome: cada
     pantalla pone ahí lo suyo y el router lo limpia al navegar. */
  accionesDePagina(menu);

  return frag(
    cont,
    /* En una jam cerrada no hay nada que sumar; el ＋ sería un botón que
       miente. El cuaderno de ideas sigue estando en el ⋯. */
    editable()
      ? h('button.fab', {
          title: 'Sumar un tema a esta jam',
          onclick: dialogoAgregar,
        }, '＋')
      : null);
}
