/* ============================================================
   views/jam-editor.js — editor de una jam + armado del setlist
   ------------------------------------------------------------
   Tres métodos de armado:
     1) Pegar o arrastrar desde DBSongs
     2) MagicList: generada por género, franja y curva de energía
     3) Sugerencias: nunca tocados de bandas que ya funcionan
   ============================================================ */

import { store, norm, FRANJA_LABEL } from '../store.js';
import {
  h, frag, clear, poner, field, input, select, personPicker, toast, modal, confirmar, songAutocomplete, hojaAcciones,
  catPill, catCorta, franjaDot, fechaLinda, copiar, debounce,
} from '../ui.js';
import { buscarEnWeb, webAResultado, temasDeArtista } from '../lookup.js';
import { buscarCifra, urlBusqueda } from '../cifra.js';
import { chipTempo } from '../tempo.js';
import { chipPatch } from '../patch.js';
import { notaDe, ponerNota } from '../notas.js';
import { dialogoCancion } from './song-form.js';
import { seccionEnsayos } from './ensayos.js';
import { borrarJam } from './jams.js';
import { setlistATexto, textoASetlist } from '../setlist-texto.js';
import { refrescar, accionesDePagina } from '../app.js';
import { dialogoLink, dialogoRespaldos } from './compartir-jam.js';
import { estadoInicial, filtrosMagicList, generarPropuesta, propuestaAItems } from '../magiclist.js';

/* ============================================================
   Botón de cifra (acordes) de un tema
   ------------------------------------------------------------
   Si el link ya está guardado en DBSongs, abre directo. Si no,
   lo busca en Cifra Club, lo guarda y recién ahí abre.
   ============================================================ */
export function botonCifra(song, alGuardar) {
  const btn = h('button.icon-btn.cifra', {
    title: 'Cifra / acordes en Cifra Club',
    onclick: async e => {
      e.stopPropagation();
      if (song.cifraUrl) { window.open(song.cifraUrl, '_blank', 'noopener'); return; }

      btn.textContent = '…'; btn.disabled = true;
      try {
        const r = await buscarCifra(song.titulo, song.artista);
        if (r) {
          store.updateSong(song.id, { cifraUrl: r.url, cifraArtista: r.artista, cifraConfianza: r.confianza });
          window.open(r.url, '_blank', 'noopener');
          toast(r.confianza === 'alta'
            ? `Cifra de «${song.titulo}» guardada`
            : `Ojo: la única cifra de «${song.titulo}» es de ${r.artista}`, r.confianza === 'alta' ? 'ok' : '');
          alGuardar && alGuardar();
        } else {
          store.updateSong(song.id, { cifraUrl: '', cifraConfianza: 'no' });
          window.open(urlBusqueda(song.titulo, song.artista), '_blank', 'noopener');
          toast('No está en Cifra Club — te abro el buscador');
          alGuardar && alGuardar();
        }
      } catch (err) {
        console.warn(err);
        toast('No se pudo consultar Cifra Club', 'err');
        btn.textContent = '🎸'; btn.disabled = false;
      }
    },
  }, '🎸');

  if (song.cifraUrl) btn.classList.add('tiene');
  if (song.cifraConfianza === 'media') { btn.classList.add('dudosa'); btn.title = `Cifra de ${song.cifraArtista} (otro artista) — verificá`; }
  if (song.cifraConfianza === 'no') { btn.classList.add('sin'); btn.title = 'No aparece en Cifra Club — abre el buscador'; }
  return btn;
}

/* payload del arrastre en curso (dataTransfer no se puede leer en dragover) */
let arrastre = null;

/**
 * Crea una canción en Canciones DB a partir de lo poco que sabemos:
 * primero busca en internet para llenarle banda, género y demás, y si
 * no encuentra nada guarda lo que el usuario escribió.
 */
async function crearSongDesde({ titulo, artista }) {
  let datos = { titulo, artista, origen: 'manual' };
  try {
    const res = await buscarEnWeb([titulo, artista].filter(Boolean).join(' '));
    if (res.length) datos = webAResultado(res[0]);
  } catch { /* seguimos con lo que escribió el usuario */ }
  return store.addSong(datos);
}

/* Cómo de apretada querés la lista. Se guarda porque es una preferencia
   tuya, no de cada jam: si te gusta cómoda, la querés cómoda siempre.
   Arranca compacta: ver la jam entera de una es lo que uno quiere casi
   siempre, y los datos desplegados son la excepción. */
/* Los gremios son lentes sobre la misma lista: cada uno deja a la vista
   lo que ese instrumento necesita y esconde el resto. No cambian nada de
   la jam, solo lo que estás mirando, así que viven en el navegador. */
const CLAVE_GREMIO = 'jamportal.gremio';
const GREMIOS = [
  { clave: '',           icono: '🎚', etiqueta: 'Todo',      detalle: 'bpm, trompeta, patch y cantantes' },
  { clave: 'guitarras',  icono: '🎸', etiqueta: 'Guitarras', detalle: 'la cifra y el bpm' },
  { clave: 'sivibra',    icono: '🎹', etiqueta: 'Sivibra',   detalle: 'el patch de teclado y el bpm' },
  { clave: 'bateros',    icono: '🥁', etiqueta: 'Bateros',   detalle: 'el bpm y la franja de energía' },
];
const gremioActual = () => localStorage.getItem(CLAVE_GREMIO) || '';

const CLAVE_DENSIDAD = 'jamportal.densidad';
/* A pantalla completa siempre va compacta: si te tomás toda la pantalla
   es para ver la lista entera, no para ver ocho temas más grandes.
   Tu preferencia queda intacta y vuelve al salir. */
const compacta = () => pantallaCompleta || localStorage.getItem(CLAVE_DENSIDAD) !== 'comoda';

/* Pantalla completa de la lista. No se guarda: es para el rato en que
   estás acomodando temas, no una preferencia. Vive fuera de la vista
   para que un redibujado no te saque, y se apaga al irte de la jam. */
let pantallaCompleta = false;
window.addEventListener('hashchange', () => {
  pantallaCompleta = false;
  document.body.classList.remove('lista-full');
});

/* Medleys plegados. Va por objeto y no por índice: al reordenar la lista
   los índices se corren, pero el medley sigue siendo el mismo. Un WeakSet
   además no deja rastro — esto es cómo estás mirando la lista, no un dato
   de la jam, así que no tiene por qué viajar a la base. */
const medleysPlegados = new WeakSet();

/* Jams históricas que abriste a mano en esta sesión. Vive fuera de la vista
   porque la vista se redibuja sola (cambios de la nube, refrescar) y si no,
   el candado se volvía a cerrar solo. */
const desbloqueadas = new Set();

/**
 * Hace que la fila se arrastre SOLO desde su manija.
 *
 * Con `draggable` en toda la fila, cualquier clic con el más mínimo movimiento
 * arranca un drag y el clic nunca llega: por eso no se podía apretar el ✕ ni
 * editar nada adentro de un medley. Ahora la fila arranca no-arrastrable y la
 * manija la habilita mientras la tenés apretada.
 */
function manija(titulo = 'Arrastrar para reordenar') {
  const sp = h('span.handle', {
    title: titulo,
    onmousedown: () => {
      const fila = sp.closest('.med-song, .sl-item, .preview-row');   // la busca sola al apretarla
      if (!fila) return;
      fila.draggable = true;
      document.addEventListener('mouseup', () => { fila.draggable = false; }, { once: true });
    },
  }, '⠿');
  return sp;
}

const MIN_POR_TEMA = 4;      // estimación para la duración
const MIN_POR_TEMA_MEDLEY = 2;

/* ============================================================
   Menú flotante (para elegir cantante en una fila)
   ============================================================ */
/**
 * Menú flotante con buscador.
 *
 * Con veinte nombres, recorrer la lista con el ojo es más lento que
 * escribir dos letras. Los nombres van en orden alfabético —que es
 * donde uno los busca— y quien suele cantar el tema queda marcado,
 * para no perder ese dato al ordenar.
 */
function menuFlotante(anchor, opciones, onPick) {
  const menu = h('div.ac-menu', { style: { position: 'fixed', width: '230px', maxHeight: '320px' } });
  const cerrar = () => { menu.remove(); document.removeEventListener('mousedown', fuera, true); };
  const fuera = e => { if (!menu.contains(e.target)) cerrar(); };

  const items = opciones
    .map(o => (typeof o === 'string' ? { value: o, label: o } : o))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));

  const buscador = h('input.ac-buscador', { type: 'text', placeholder: 'Buscar…', autocomplete: 'off' });
  const lista = h('div.ac-lista');

  function pintar() {
    const q = norm(buscador.value);
    const visibles = q ? items.filter(o => norm(o.label).includes(q)) : items;

    clear(lista);
    visibles.forEach(o => lista.appendChild(h('div.ac-item', {
      onclick: () => { onPick(o.value); cerrar(); },
    }, h('div.ac-t', {}, o.label), o.hint ? h('div.ac-r', {}, h('span.chip', {}, o.hint)) : null)));

    if (!visibles.length) {
      lista.appendChild(h('div.ac-loading', {},
        items.length ? 'Nadie con ese nombre' : 'No hay más nombres'));
    }
    return visibles;
  }

  buscador.addEventListener('input', pintar);
  buscador.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const primero = pintar()[0];          // Enter elige lo que estás viendo arriba
      if (primero) { onPick(primero.value); cerrar(); }
    }
  });

  poner(menu, items.length > 6 ? buscador : null, lista);
  pintar();

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - 246) + 'px';
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 330) + 'px';
  setTimeout(() => { document.addEventListener('mousedown', fuera, true); buscador.focus(); }, 0);
}

/* chips de personas editables dentro de una fila */
function chipsPersonas(lista, opciones, onChange, sugeridos = []) {
  const cont = h('span.chips', { style: { display: 'inline-flex', alignItems: 'center' } });
  const pintar = () => {
    clear(cont);
    lista.forEach(n => cont.appendChild(h('span.chip.sel', {}, n,
      h('button', { title: 'Quitar', onclick: e => { e.stopPropagation(); onChange(lista.filter(x => x !== n)); } }, '✕'))));
    const btn = h('button.chip.clickable', {
      title: 'Asignar cantante',
      onclick: e => {
        e.stopPropagation();
        const libres = opciones.filter(o => !lista.includes(o));
        menuFlotante(btn,
          libres.map(o => ({ value: o, label: o, hint: sugeridos.includes(o) ? '★' : null })),
          v => onChange([...lista, v]));
      },
    }, lista.length ? '＋' : '＋ cantante');
    cont.appendChild(btn);
  };
  pintar();
  return cont;
}

/* ============================================================
   Vista
   ============================================================ */
export function vistaEditor(jamId) {
  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver'));
  }
  if (!Array.isArray(jam.items)) jam.items = [];

  const guardar = debounce(() => store.commit(), 250);

  /* Las jams históricas son el registro de lo que ya pasó: se abren cerradas
     para no romperlas sin querer. El candado se puede abrir a propósito, y
     queda abierto aunque la vista se vuelva a dibujar (hasta recargar). */
  const bloqueada = () => (jam.historica || jam.cerrada) && !desbloqueadas.has(jam.id);

  /* ---------- densidad de la lista ---------- */

  /** Un renglón por tema, para ver la jam entera sin scrollear. */
  function aplicarDensidad() {
    setlistCont.classList.toggle('compacta', compacta());
    const card = setlistCont.closest('.card');
    if (card) card.classList.toggle('compacta', compacta());
    /* en el body porque también se achica lo que está arriba de la tarjeta */
    document.body.classList.toggle('lista-compacta', compacta());
    aplicarGremio();
    aplicarPantalla();
  }

  /** La lista sola, tapando todo lo demás. */
  function aplicarPantalla() {
    document.body.classList.toggle('lista-full', pantallaCompleta);
    const card = setlistCont.closest('.card');
    if (card) card.classList.toggle('full', pantallaCompleta);
    btnDensidad.style.display = pantallaCompleta ? 'none' : '';
    btnPantalla.textContent = pantallaCompleta ? '⤡ Salir' : '⛶ Agrandar';
    btnPantalla.title = pantallaCompleta
      ? 'Volver al editor completo (Esc)'
      : 'La lista sola, ocupando toda la pantalla';
  }

  const alEscapar = e => {
    if (e.key !== 'Escape' || !pantallaCompleta) return;
    pantallaCompleta = false;
    aplicarDensidad();
    pintarDensidad();
  };
  document.addEventListener('keydown', alEscapar);

  const btnPantalla = h('button.btn.xs', {
    onclick: () => {
      pantallaCompleta = !pantallaCompleta;
      aplicarDensidad();          // reaplica todo: la densidad depende del modo
      pintarDensidad();
      window.scrollTo(0, 0);
    },
  });

  /* el lente elegido se aplica como clase: el DOM es el mismo */
  function aplicarGremio() {
    const g = gremioActual();
    for (const x of GREMIOS) setlistCont.classList.toggle('gremio-' + x.clave, !!x.clave && x.clave === g);
    const elegido = GREMIOS.find(x => x.clave === g) || GREMIOS[0];
    btnGremios.textContent = `${elegido.icono} ${elegido.etiqueta.toUpperCase()}`;
    btnGremios.title = `Se ve ${elegido.detalle} — tocá para cambiar de gremio`;
  }

  const btnGremios = h('button.btn.gremios', {
    onclick: () => hojaAcciones('Qué mirar de cada tema',
      GREMIOS.map(x => ({
        icono: x.icono,
        texto: x.clave === gremioActual() ? `${x.etiqueta} · ${x.detalle} (puesto)` : `${x.etiqueta} · ${x.detalle}`,
        onClick: () => { localStorage.setItem(CLAVE_GREMIO, x.clave); aplicarGremio(); },
      }))),
  });

  const btnDensidad = h('button.btn.xs.densidad', {
    onclick: () => {
      localStorage.setItem(CLAVE_DENSIDAD, compacta() ? 'comoda' : 'compacta');
      aplicarDensidad();
      pintarDensidad();
    },
  });

  function pintarDensidad() {
    btnDensidad.textContent = compacta() ? '▤ Vista cómoda' : '▤ Vista compacta';
    btnDensidad.title = compacta()
      ? 'Volver a la lista con los datos desplegados'
      : 'Un renglón por tema: entra toda la jam en una pantalla';
  }
  pintarDensidad();

  /* ---------- editar la lista como texto ---------- */

  /**
   * Toda la lista en un cuadro de texto, como en un doc: se ve entera,
   * se reordena cortando y pegando renglones, se agrega escribiendo.
   * Al guardar se vuelve a armar la lista y cada línea se busca en
   * Canciones DB, así los temas conservan tempo, cifra y categoría.
   */
  function dialogoTexto() {
    const ta = h('textarea', {
      value: setlistATexto(jam, store),
      spellcheck: false,
      style: {
        minHeight: '48vh', width: '100%', lineHeight: '1.75',
        fontFamily: 'var(--mono)', fontSize: '12.5px', whiteSpace: 'pre',
        overflowWrap: 'normal', overflowX: 'auto',
      },
    });

    const resumen = h('div.method-hint', { style: { marginTop: '10px' } });
    const btnCrear = h('button.btn.sm');
    const btnGuardar = h('button.btn.primary');
    let analisis = { items: [], lineas: [] };

    const faltantes = () => analisis.lineas.filter(l => l.tipo === 'tema' && !l.match && l.titulo);

    function analizar() {
      analisis = textoASetlist(ta.value, store);
      const cuenta = { song: 0, medley: 0, break: 0, bloque: 0 };
      for (const it of analisis.items) cuenta[it.tipo === 'song' ? 'song' : it.tipo]++;
      const enMedleys = analisis.items
        .filter(it => it.tipo === 'medley')
        .reduce((a, m) => a + m.songs.length, 0);

      const falt = faltantes();
      const partes = [
        `${cuenta.song + enMedleys} temas`,
        cuenta.medley ? `${cuenta.medley} medley${cuenta.medley > 1 ? 's' : ''}` : '',
        cuenta.break ? `${cuenta.break} break${cuenta.break > 1 ? 's' : ''}` : '',
        cuenta.bloque ? `${cuenta.bloque} bloque${cuenta.bloque > 1 ? 's' : ''}` : '',
      ].filter(Boolean);

      clear(resumen);
      poner(resumen,
        h('b', {}, partes.join(' · ')),
        falt.length
          ? h('div', { style: { marginTop: '6px' } },
              `${falt.length} ${falt.length === 1 ? 'línea que no está' : 'líneas que no están'} en Canciones DB: `,
              h('span.dim', {}, falt.slice(0, 5).map(l => l.titulo).join(' · ') + (falt.length > 5 ? ' …' : '')))
          : h('div', { style: { marginTop: '6px' } }, 'Todas las líneas se reconocieron.'));

      btnCrear.style.display = falt.length ? '' : 'none';
      btnCrear.textContent = falt.length === 1
        ? '🌐 Buscar en internet'
        : `🌐 Buscar los ${falt.length} en internet`;
      btnGuardar.textContent = !falt.length ? 'Guardar la lista'
        : falt.length === 1 ? 'Guardar sin esa línea'
        : `Guardar sin esas ${falt.length}`;
    }

    ta.addEventListener('input', debounce(analizar, 250));
    analizar();

    /* Busca los que no reconoció, los agrega a Canciones DB y —lo que
       importa acá— reescribe el renglón con lo que encontró, para que
       veas la banda antes de guardar. Respeta la numeración, la viñeta
       del medley y los cantantes que hayas puesto vos. */
    btnCrear.onclick = async () => {
      const falt = faltantes();
      btnCrear.disabled = true;
      btnCrear.textContent = `Buscando ${falt.length} en internet…`;

      const renglones = ta.value.split('\n');
      let encontrados = 0;
      try {
        for (const l of falt) {
          const s = await crearSongDesde(l);
          if (!s) continue;
          if (s.artista) encontrados++;
          const orig = renglones[l.nro] ?? '';
          const sangria = orig.match(/^(\s*(?:[·•*]\s*|\d+\s*[.)\-–]\s*)*)/)[1];
          const cant = orig.match(/\[([^\]]*)\]\s*$/);
          renglones[l.nro] = sangria
            + [s.titulo, s.artista].filter(Boolean).join(' — ')
            + (cant ? `  [${cant[1]}]` : '');
        }
      } finally {
        btnCrear.disabled = false;
      }

      ta.value = renglones.join('\n');
      analizar();
      toast(encontrados
        ? `${encontrados} de ${falt.length} completados con la banda`
        : `${falt.length} agregados a Canciones DB (sin datos de internet)`, 'ok');
    };

    btnGuardar.onclick = () => {
      if (!analisis.items.length) { toast('La lista quedaría vacía', 'err'); return; }
      jam.items = analisis.items;
      guardar();
      m.close();
      pintarTodo(); pintarSide(); pintarInsertBar();
      toast('Lista actualizada', 'ok');
    };

    const m = modal({
      title: 'Editar la lista como texto',
      wide: true,
      body: [
        h('div.method-hint', { style: { marginBottom: '10px' } },
          'Un tema por renglón: ', h('code', {}, 'Tema — Artista  [Cantante]'), '. ',
          h('code', {}, '▸ TÍTULO'), ' es un bloque, ', h('code', {}, "—— BREAK (15') ——"), ' un corte, ',
          'y ', h('code', {}, '(medley)'), ' abre un medley con lo que venga abajo con ', h('code', {}, '·'),
          ' hasta el renglón vacío. Los números son adorno: se recalculan solos.'),
        ta,
        resumen,
      ],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        btnCrear,
        btnGuardar,
      ],
    });
    return m;
  }

  /* ---------- cerrar / reabrir con código ---------- */

  /** Cerrarla: queda lista para el vivo y nadie la toca sin el código. */
  /** Cierra sin preguntar nada: ya sabemos con qué código. */
  function cerrarCon(cod) {
    jam.cerrada = true;
    jam.codigo = cod;
    store.commit();
    desbloqueadas.delete(jam.id);
    refrescar();
    toast('Jam cerrada — lista para el vivo', 'ok');
  }

  function dialogoCerrar() {
    /* Si ya la habías cerrado antes, lo más común es volver a cerrarla
       con el mismo código: no te lo hacemos escribir de nuevo. */
    if (jam.codigo) {
      const m = modal({
        title: 'Cerrar la jam',
        body: [h('div.method-hint', {},
          'Ya tiene un código de antes. Podés cerrarla con ese mismo, o poner uno nuevo.')],
        footer: [
          h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
          h('button.btn.sm', { onclick: () => { m.close(); jam.codigo = ''; dialogoCerrar(); } }, 'Con otro código'),
          h('button.btn.primary', { onclick: () => { m.close(); cerrarCon(jam.codigo); } }, '🔒 Con el mismo'),
        ],
      });
      return;
    }

    const fCod = input({ placeholder: 'Ej: 1234', maxLength: 20 });
    const fCod2 = input({ placeholder: 'Repetilo', maxLength: 20 });
    const m = modal({
      title: 'Cerrar la jam',
      body: [
        h('div.method-hint', {},
          'La lista queda como está para pasarla en vivo: no se van a poder ',
          'agregar, sacar ni reordenar temas, ni cambiar los datos. ',
          h('b', {}, 'Para volver a editarla hay que poner este código'), ', así que ',
          'elegí uno que se acuerde toda la banda.'),
        h('div.grid-2', { style: { marginTop: '12px' } },
          field('Código', fCod), field('Otra vez', fCod2)),
      ],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        h('button.btn.primary', {
          onclick: () => {
            const cod = fCod.value.trim();
            if (cod.length < 3) { toast('Poné un código de al menos 3 caracteres', 'err'); fCod.focus(); return; }
            if (cod !== fCod2.value.trim()) { toast('Los dos códigos no coinciden', 'err'); fCod2.focus(); return; }
            m.close();
            cerrarCon(cod);
          },
        }, '🔒 Cerrar jam'),
      ],
    });
    setTimeout(() => fCod.focus(), 60);
  }

  /** Reabrirla: hay que saber el código con el que se cerró. */
  function dialogoCodigo() {
    const fCod = input({
      placeholder: 'Código', maxLength: 20,
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); abrir(); } },
    });
    const abrir = () => {
      if (fCod.value.trim() !== (jam.codigo || '')) {
        toast('Código incorrecto', 'err');
        fCod.select();
        return;
      }
      desbloqueadas.add(jam.id);
      m.close();
      refrescar();
      toast('Jam desbloqueada', '');
    };
    const m = modal({
      title: 'Desbloquear la jam',
      body: [
        h('div.method-hint', {}, 'Está cerrada para pasarla en vivo. Poné el código con el que se cerró.'),
        h('div', { style: { marginTop: '12px' } }, field('Código', fCod)),
      ],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        h('button.btn.primary', { onclick: abrir }, '🔓 Desbloquear'),
      ],
    });
    setTimeout(() => fCod.focus(), 60);
  }

  /* ---------- contenedores ---------- */
  const setlistCont = h('div.setlist');
  const energyCont  = h('div.energy');
  const statsCont   = h('div.chips', { style: { marginBottom: '10px' } });
  const sidePanel   = h('div.card');
  const tituloEnc   = h('h1', {});

  /* ============================================================
     Operaciones sobre el setlist
     ============================================================ */
  const items = () => jam.items;

  /** Ids de los temas que ya están en la lista (contando los de los medleys). */
  const idsEnLista = () => new Set(items().flatMap(it =>
    it.tipo === 'medley' ? (it.songs || []).map(s => s.songId) : [it.songId]));

  function insertar(item, at = items().length) {
    items().splice(Math.max(0, Math.min(at, items().length)), 0, item);
    guardar(); pintarTodo();
  }
  function agregarSong(songId, at) {
    const s = store.song(songId);
    if (!s) return;
    // ojo: sigue siendo idea. Recién pasa al repertorio cuando la jam ya pasó
    if (s.esIdea) toast(`«${s.titulo}» queda como idea hasta que pase la jam`, '');
    insertar({ tipo: 'song', songId, cantantes: [], notas: '' }, at ?? items().length);
  }
  function quitar(i) { items().splice(i, 1); guardar(); pintarTodo(); }
  function mover(from, to) {
    if (from === to || from + 1 === to) return;
    const [it] = items().splice(from, 1);
    items().splice(from < to ? to - 1 : to, 0, it);
    guardar(); pintarTodo();
  }

  function unirEnMedley(i) {
    const a = items()[i], b = items()[i + 1];
    if (!a || !b) return;
    const aSongs = a.tipo === 'medley' ? a.songs : (a.tipo === 'song' ? [{ songId: a.songId, cantantes: a.cantantes || [] }] : null);
    const bSongs = b.tipo === 'medley' ? b.songs : (b.tipo === 'song' ? [{ songId: b.songId, cantantes: b.cantantes || [] }] : null);
    if (!aSongs || !bSongs) { toast('Solo se pueden unir temas, no breaks', 'err'); return; }
    const nombre = a.tipo === 'medley' ? a.titulo : 'Medley';
    items().splice(i, 2, { tipo: 'medley', titulo: nombre, songs: [...aSongs, ...bSongs], notas: '' });
    guardar(); pintarTodo();
  }

  /** Saca un tema del medley y lo deja suelto en la lista, justo después. */
  function sacarDelMedley(i, k) {
    const m = items()[i];
    if (!m || m.tipo !== 'medley') return;
    const [ms] = m.songs.splice(k, 1);
    const suelto = { tipo: 'song', songId: ms.songId, cantantes: ms.cantantes || [], notas: '' };

    if (m.songs.length >= 2) {
      items().splice(i + 1, 0, suelto);                    // el medley sigue en pie
    } else if (m.songs.length === 1) {
      // con un solo tema ya no es un medley: se desarma solo
      const [q] = m.songs;
      items().splice(i, 1,
        { tipo: 'song', songId: q.songId, cantantes: q.cantantes || [], notas: '' }, suelto);
      toast('El medley quedó con un solo tema, así que lo desarmé', '');
    } else {
      items().splice(i, 1, suelto);
    }
    guardar(); pintarTodo();
  }

  function desarmarMedley(i) {
    const m = items()[i];
    if (!m || m.tipo !== 'medley') return;
    items().splice(i, 1, ...m.songs.map(s => ({ tipo: 'song', songId: s.songId, cantantes: s.cantantes || [], notas: '' })));
    guardar(); pintarTodo();
  }

  /* ============================================================
     Dibujado del setlist
     ============================================================ */
  function opcionesGente() {
    const conv = jam.musicos || [];
    const todos = [...new Set([...conv, ...store.cantantes.map(c => c.nombre)])];
    return todos;
  }

  /* Las líneas entre temas son solo la marca visual de dónde va a caer.
     Antes cada una era su propio drop target de 3px de alto y era imposible
     acertarles con el mouse: ahora el que escucha es el contenedor entero. */
  function lineaDrop() { return h('div.drop-line'); }

  /** En qué posición cae el cursor: se compara contra la mitad de cada fila. */
  function indiceParaY(y) {
    const filas = [...setlistCont.children].filter(el => el.classList.contains('sl-item'));
    for (let i = 0; i < filas.length; i++) {
      const r = filas[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return filas.length;
  }

  function marcarLinea(indice) {
    const lineas = [...setlistCont.children].filter(el => el.classList.contains('drop-line'));
    lineas.forEach((l, i) => l.classList.toggle('over', i === indice));
  }
  function limpiarLineas() {
    setlistCont.querySelectorAll('.drop-line.over').forEach(l => l.classList.remove('over'));
  }

  setlistCont.addEventListener('dragover', e => {
    if (!arrastre || bloqueada()) return;
    // si está encima de un medley, el medley se encarga (soltar adentro)
    if (e.target.closest && e.target.closest('.sl-medley')) { limpiarLineas(); return; }
    e.preventDefault();
    marcarLinea(indiceParaY(e.clientY));
  });

  setlistCont.addEventListener('dragleave', e => {
    if (!setlistCont.contains(e.relatedTarget)) limpiarLineas();
  });

  setlistCont.addEventListener('drop', e => {
    if (!arrastre || bloqueada()) return;
    if (e.target.closest && e.target.closest('.sl-medley')) return;   // lo maneja el medley
    e.preventDefault();
    const indice = indiceParaY(e.clientY);
    limpiarLineas();
    if (arrastre.tipo === 'item') mover(arrastre.index, indice);
    else {
      const id = songIdDeArrastre(arrastre);        // paleta o propuesta de MagicList
      if (id) agregarSong(id, indice);
    }
    arrastre = null;
  });

  /**
   * La trompeta: marca si el tema lleva vientos. Apagada es gris; al
   * tocarla se enciende. Es del tema, no de la jam — igual que el tempo
   * o el patch —, así que una vez marcado aparece en todas.
   */
  function botonVientos(s) {
    const btn = h('button.icon-btn.vientos', {
      onclick: e => {
        e.stopPropagation();
        const fresco = store.song(s.id) || s;
        store.updateSong(fresco.id, { vientos: !fresco.vientos });
        pintarTodo();
      },
    }, '🎺');
    const pintar = () => {
      const hay = !!(store.song(s.id) || s).vientos;
      btn.classList.toggle('tiene', hay);
      btn.title = hay ? 'Lleva vientos — clic para sacarlo' : 'Marcar que lleva vientos';
    };
    pintar();
    return btn;
  }

  /* ============================================================
     Guitarras
     ------------------------------------------------------------
     Dos puestos por tema, cada uno con quién lo toca y si hace el
     solo. Va en el ítem de la lista y no en el tema: quién agarra
     la viola es cosa de esta jam, no del tema para siempre.
     ============================================================ */

  function puestoGuitarra(it, n) {
    if (!Array.isArray(it.guitarras)) it.guitarras = [];
    while (it.guitarras.length < 2) it.guitarras.push({ nombre: '', solo: false });
    const g = it.guitarras[n];

    const nombre = h('button.gt-nombre' + (g.nombre ? '.puesto' : ''), {
      title: g.nombre ? `${g.nombre} — clic para cambiarlo` : 'Elegir guitarrista',
      onclick: e => {
        e.stopPropagation();
        menuFlotante(nombre,
          [{ value: '', label: '— sin nadie —' },
           ...opcionesGente().map(o => ({ value: o, label: o }))],
          v => { g.nombre = v; guardar(); pintarTodo(); });
      },
    }, g.nombre || 'quién');

    const solo = h('label.gt-solo' + (g.solo ? '.on' : ''), {
      title: g.solo ? 'Hace el solo' : 'Marcar que hace el solo',
      onclick: e => e.stopPropagation(),
    },
      h('input', {
        type: 'checkbox', checked: !!g.solo,
        onchange: e => { g.solo = e.target.checked; guardar(); pintarTodo(); },
      }),
      h('span', {}, '🎸 Solo'));

    return h('span.gt-puesto', {},
      h('span.gt-rotulo', {}, `G${n + 1}`),
      nombre,
      solo);
  }

  /* ---------- nota privada ----------
     Es tuya y de esta máquina: no va a la base compartida. Se escribe
     acá y se lee en el LIVE VIEW, que es cuando hace falta. */
  function botonNota(s) {
    const btn = h('button.icon-btn.nota', {
      onclick: e => { e.stopPropagation(); dialogoNota(s, () => pintarNota()); },
    });
    function pintarNota() {
      const hay = !!notaDe(jam.id, s.id);
      btn.classList.toggle('tiene', hay);
      btn.textContent = hay ? '📝' : '📝';
      btn.title = hay
        ? `Tu nota: ${notaDe(jam.id, s.id)}`
        : 'Escribir una nota tuya — solo la ves vos, y aparece en el LIVE VIEW';
    }
    pintarNota();
    return btn;
  }

  function dialogoNota(s, alGuardar) {
    const area = h('textarea', {
      value: notaDe(jam.id, s.id),
      placeholder: 'Entro en el segundo estribillo · afinar medio tono abajo · ojo con el corte…',
      style: { minHeight: '120px' },
    });
    const m = modal({
      title: 'Tu nota para « ' + s.titulo + ' »',
      body: [
        h('div.method-hint', {},
          'Es tuya: no la ve el resto de la banda y no viaja a la base compartida. ',
          'Aparece en el ', h('b', {}, 'LIVE VIEW'), ', que es donde la vas a necesitar. ',
          h('span.dim', {}, 'Vive en este navegador, así que no te sigue a otro dispositivo.')),
        h('div', { style: { marginTop: '12px' } }, area),
      ],
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
        notaDe(jam.id, s.id)
          ? h('button.btn.sm.danger', {
              onclick: () => { ponerNota(jam.id, s.id, ''); m.close(); alGuardar(); toast('Nota borrada'); },
            }, 'Borrar')
          : null,
        h('button.btn.primary', {
          onclick: () => {
            ponerNota(jam.id, s.id, area.value);
            m.close(); alGuardar();
            toast(area.value.trim() ? 'Nota guardada' : 'Nota borrada', 'ok');
          },
        }, 'Guardar'),
      ],
    });
    setTimeout(() => area.focus(), 60);
  }

  /** Las acciones del tema, con nombre, para el dedo. */
  function hojaDeTema(s, i) {
    hojaAcciones(s.titulo, [
      { icono: '📝', texto: notaDe(jam.id, s.id) ? 'Editar mi nota' : 'Escribir una nota mía',
        onClick: () => dialogoNota(s, () => pintarTodo()) },
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
          pintarTodo();
        } },
      { icono: '⛓', texto: 'Unir en medley con el siguiente', onClick: () => unirEnMedley(i) },
      { icono: '✎', texto: 'Editar el tema', onClick: () => dialogoCancion(s, () => pintarTodo()) },
      { icono: '✕', texto: 'Sacar de la lista', peligro: true, onClick: () => quitar(i) },
    ]);
  }

  /**
   * El ＋ de cada fila: abre un buscador ahí mismo y lo que elijas entra
   * justo abajo. Antes había que ir hasta el buscador del final y después
   * arrastrar el tema hasta su lugar.
   */
  function botonInsertar(i) {
    const btn = h('button.icon-btn.sumar', {
      title: 'Agregar un tema justo abajo',
      onclick: e => {
        e.stopPropagation();
        const fila = btn.closest('.sl-item');
        if (!fila || fila.nextElementSibling?.classList.contains('sl-insertar')) return;

        const caja = h('div.sl-insertar', {},
          buscadorDeTemas(song => {
            caja.remove();
            agregarSong(song.id, i + 1);
            toast(`«${song.titulo}» agregada`, 'ok');
          }, { placeholder: 'Qué tema va acá…' }),
          h('button.btn.xs.ghost', { onclick: () => caja.remove() }, 'Cancelar'));

        fila.after(caja);
        setTimeout(() => caja.querySelector('input')?.focus(), 30);
      },
    }, '＋');
    return btn;
  }

  function filaSong(it, i, numero) {
    const s = store.song(it.songId);
    if (!s) return h('div.sl-item', {}, h('span.sl-num', {}, numero), h('div.sl-main', {}, h('span.dim', {}, 'Tema borrado de DBSongs')),
      h('button.icon-btn.danger', { onclick: () => quitar(i) }, '✕'));

    /* Nunca tocada: fondo rojo clarito, igual que en la lista del celular.
       El texto "nunca tocada" ya estaba, pero hay que leerlo tema por tema;
       el color deja ver de un vistazo cuánto de la lista hay que ensayar. */
    const row = h('div.sl-item' + ((s.jams || []).length ? '' : '.nueva'), {
      ondragstart: e => { arrastre = { tipo: 'item', index: i }; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.titulo); },
      ondragend: () => { row.classList.remove('dragging'); arrastre = null; },
    },
      bloqueada() ? null : manija(),
      bloqueada() ? null : botonInsertar(i),
      h('span.sl-num', {}, numero),
      h('div.sl-main', {},
        h('div.sl-title', {}, s.titulo),
        gremioActual() === 'guitarras'
          ? h('div.sl-sub.sub-guitarras', {},
              h('span', {}, s.artista),
              puestoGuitarra(it, 0),
              puestoGuitarra(it, 1),
              bloqueada()
                ? (it.cantantes || []).map(n => h('span.chip.sel', {}, n))
                : chipsPersonas(it.cantantes || [], opcionesGente(), v => { it.cantantes = v; guardar(); pintarTodo(); }, s.cantantes || []))
          : h('div.sl-sub', {},
          franjaDot(s.franja),
          h('span', {}, s.artista),
          catPill(s.categoria),
          bloqueada()
            ? (s.bpm ? h('span.mono.dim', {}, (s.bpmFuente === 'sugerido' ? '≈ ' : '') + s.bpm + ' bpm') : null)
            : chipTempo(s, () => pintarTodo()),
          bloqueada()
            ? (s.vientos ? h('span.vientos-fijo', { title: 'Lleva vientos' }, '🎺') : null)
            : botonVientos(s),
          s.esIdea
            ? h('span.chip.idea', { title: 'Sigue en Ideas: pasa al repertorio cuando la fecha de esta jam quede atrás' }, '💡 idea')
            : ((s.jams || []).length
                ? h('span.dim', { title: (s.jams || []).join('\n') }, `tocada ${s.jams.length}×`)
                : h('span.dim', {}, 'nunca tocada')),
          bloqueada()
            ? ((s.patches || []).length ? h('span.chip', { title: 'Patch de teclado' }, '🎹 ' + s.patches.join(' ')) : null)
            : chipPatch(s, () => pintarTodo()),
          s.cifraUrl ? h('a.print-link', { href: s.cifraUrl, target: '_blank', rel: 'noopener' }, '🎸 cifra') : null,
          bloqueada()
            ? (it.cantantes || []).map(n => h('span.chip.sel', {}, n))
            : chipsPersonas(it.cantantes || [], opcionesGente(), v => { it.cantantes = v; guardar(); pintarTodo(); }, s.cantantes || []),
        )),
      bloqueada()
        ? h('div.sl-actions', {}, botonNota(s), botonCifra(s, () => pintarTodo()))
        : h('div.sl-actions', {},
        botonNota(s),
        botonCifra(s, () => pintarTodo()),
        h('button.icon-btn', { title: 'Unir en medley con el siguiente', onclick: () => unirEnMedley(i) }, '⛓'),
        h('button.icon-btn', { title: 'Editar el tema en DBSongs', onclick: () => dialogoCancion(s, () => pintarTodo()) }, '✎'),
        h('button.icon-btn.danger', { title: 'Sacar de la lista', onclick: () => quitar(i) }, '✕'),
        /* En pantalla chica se muestra solo este y se esconden los de arriba:
           cinco íconos por tema eran cuarenta botones en una jam corta. */
        h('button.icon-btn.mas', {
          title: 'Más acciones',
          onclick: e => { e.stopPropagation(); hojaDeTema(s, i); },
        }, '⋯')),
    );
    return row;
  }

  function filaBreak(it, i) {
    const row = h('div.sl-item.sl-break', {
      ondragstart: e => { arrastre = { tipo: 'item', index: i }; row.classList.add('dragging'); e.dataTransfer.setData('text/plain', 'BREAK'); },
      ondragend: () => { row.classList.remove('dragging'); arrastre = null; },
    },
      bloqueada() ? null : manija(),
      h('span.sl-num', {}, '—'),
      h('div.sl-main', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('input', { value: it.label || 'BREAK', disabled: bloqueada(), oninput: e => { it.label = e.target.value; guardar(); }, style: { width: '160px' } }),
        h('input', { type: 'number', min: 1, max: 90, value: it.minutos || 15, disabled: bloqueada(), style: { width: '64px' },
          oninput: e => { it.minutos = parseInt(e.target.value, 10) || 0; guardar(); pintarStats(); } }),
        h('span.dim', { style: { fontSize: '11px', letterSpacing: 0, textTransform: 'none' } }, 'minutos')),
      bloqueada() ? null : h('div.sl-actions', {}, h('button.icon-btn.danger', { title: 'Quitar', onclick: () => quitar(i) }, '✕')),
    );
    return row;
  }

  function filaBloque(it, i) {
    const row = h('div.sl-item.sl-bloque', {
      ondragstart: e => { arrastre = { tipo: 'item', index: i }; row.classList.add('dragging'); e.dataTransfer.setData('text/plain', it.label || 'BLOQUE'); },
      ondragend: () => { row.classList.remove('dragging'); arrastre = null; },
    },
      bloqueada() ? null : manija(),
      h('div.sl-main', {},
        h('input', { value: it.label || '', disabled: bloqueada(), placeholder: 'Nombre del bloque (ROCK NACIONAL, 2000s, PIANO BAR…)',
          oninput: e => { it.label = e.target.value; guardar(); } })),
      bloqueada() ? null : h('div.sl-actions', {}, h('button.icon-btn.danger', { title: 'Quitar bloque', onclick: () => quitar(i) }, '✕')),
    );
    return row;
  }

  /* ---------- reordenar adentro del medley ---------- */

  /** En qué posición cae el cursor, comparando contra la mitad de cada fila. */
  function indiceEnMedley(cont, y) {
    const filas = [...cont.querySelectorAll('.med-song')];
    for (let k = 0; k < filas.length; k++) {
      const r = filas[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) return k;
    }
    return filas.length;
  }

  function limpiarHuecoMedley(cont) {
    cont.querySelectorAll('.med-song').forEach(f => f.classList.remove('hueco-antes', 'hueco-despues'));
  }

  function marcarHuecoMedley(cont, y) {
    limpiarHuecoMedley(cont);
    const filas = [...cont.querySelectorAll('.med-song')];
    const k = indiceEnMedley(cont, y);
    if (k < filas.length) filas[k].classList.add('hueco-antes');
    else if (filas.length) filas[filas.length - 1].classList.add('hueco-despues');
  }

  function filaMedley(it, i, numero) {
    const cont = h('div.sl-item.sl-medley', {
      ondragstart: e => { arrastre = { tipo: 'item', index: i }; cont.classList.add('dragging'); e.dataTransfer.setData('text/plain', it.titulo || 'Medley'); },
      ondragend: () => { cont.classList.remove('dragging'); arrastre = null; },
      /* Se le puede soltar adentro un tema de la paleta o uno que ya está
         en la lista (en ese caso se lo saca de su posición y entra al medley). */
      ondragover: e => {
        if (!arrastre || bloqueada()) return;
        if (arrastre.tipo === 'song' || arrastre.tipo === 'propuesta'
            || (arrastre.tipo === 'item' && arrastre.index !== i)) {
          e.preventDefault();
          cont.classList.add('drop-dentro');
        }
      },
      ondragleave: () => cont.classList.remove('drop-dentro'),
      ondrop: e => {
        cont.classList.remove('drop-dentro');
        if (!arrastre) return;

        if (arrastre.tipo === 'song' || arrastre.tipo === 'propuesta') {
          e.preventDefault(); e.stopPropagation();
          const id = songIdDeArrastre(arrastre);
          if (id) it.songs.push({ songId: id, cantantes: [] });
        } else if (arrastre.tipo === 'item') {
          const src = items()[arrastre.index];
          if (!src || src === it) { arrastre = null; return; }
          if (src.tipo === 'song') {
            e.preventDefault(); e.stopPropagation();
            items().splice(arrastre.index, 1);            // `it` es una referencia: el splice no la rompe
            it.songs.push({ songId: src.songId, cantantes: src.cantantes || [] });
          } else if (src.tipo === 'medley') {
            e.preventDefault(); e.stopPropagation();
            items().splice(arrastre.index, 1);
            it.songs.push(...(src.songs || []));          // dos medleys se funden en uno
          } else {
            arrastre = null; return;                      // breaks y bloques no entran
          }
        } else return;

        arrastre = null; guardar(); pintarTodo();
      },
    });

    const plegado = medleysPlegados.has(it);
    const cuantos = (it.songs || []).length;

    poner(cont,
      h('div.med-head', {},
        bloqueada() ? null : manija(),
        h('span.sl-num', {}, numero),
        h('button.med-plegar', {
          title: plegado ? 'Mostrar los temas' : 'Contraer el medley',
          onclick: e => {
            e.stopPropagation();
            if (plegado) medleysPlegados.delete(it); else medleysPlegados.add(it);
            pintarTodo();
          },
        }, plegado ? '▸' : '▾'),
        h('span.med-badge', {}, 'MEDLEY'),
        h('input', { value: it.titulo || 'Medley', disabled: bloqueada(), oninput: e => { it.titulo = e.target.value; guardar(); } }),
        /* plegado, el medley tiene que seguir diciendo qué hay adentro */
        plegado ? h('span.med-cuantos', {}, `${cuantos} tema${cuantos === 1 ? '' : 's'}`) : null,
        bloqueada() ? null : h('div.sl-actions', {},
          h('button.icon-btn', { title: 'Desarmar el medley', onclick: () => desarmarMedley(i) }, '⊟'),
          h('button.icon-btn.danger', { title: 'Quitar', onclick: () => quitar(i) }, '✕'))),
      plegado ? null : h('div.med-songs', {
        /* Reordenar adentro del medley. El contenedor es quien escucha:
           con franjas finas entre filas había que apuntar al milímetro,
           igual que pasaba en la lista grande. */
        ondragover: e => {
          if (!arrastre || arrastre.tipo !== 'medleySong' || arrastre.medley !== i) return;
          e.preventDefault(); e.stopPropagation();
          marcarHuecoMedley(e.currentTarget, e.clientY);
        },
        ondragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) limpiarHuecoMedley(e.currentTarget); },
        ondrop: e => {
          if (!arrastre || arrastre.tipo !== 'medleySong' || arrastre.medley !== i) return;
          e.preventDefault(); e.stopPropagation();
          const destino = indiceEnMedley(e.currentTarget, e.clientY);
          limpiarHuecoMedley(e.currentTarget);
          const desde = arrastre.indice;
          arrastre = null;
          if (destino === desde || destino === desde + 1) { pintarTodo(); return; }
          const [x] = it.songs.splice(desde, 1);
          it.songs.splice(desde < destino ? destino - 1 : destino, 0, x);
          guardar(); pintarTodo();
        },
      },
        (it.songs || []).map((ms, k) => {
          const s = store.song(ms.songId);
          const fila = h('div.med-song' + (s && !(s.jams || []).length ? '.nueva' : ''), {
            ondragstart: e => {
              arrastre = { tipo: 'medleySong', medley: i, indice: k };
              fila.classList.add('dragging');
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', s ? s.titulo : 'tema');
              e.stopPropagation();
            },
            ondragend: () => { fila.classList.remove('dragging'); fila.draggable = false; arrastre = null; },
          });
          poner(fila,
            bloqueada() ? null : manija('Arrastrar para reordenar dentro del medley'),
            franjaDot(s && s.franja),
            h('span', {}, s ? s.titulo : '—'),
            h('span.dim', { style: { fontSize: '11px' } }, s ? s.artista : ''),
            s ? (bloqueada()
              ? (s.bpm ? h('span.mono.dim', { style: { fontSize: '11px' } }, s.bpm) : null)
              : chipTempo(s, () => pintarTodo())) : null,
            s ? (bloqueada()
              ? (s.vientos ? h('span.vientos-fijo', { title: 'Lleva vientos' }, '🎺') : null)
              : botonVientos(s)) : null,
            s && !bloqueada() ? chipPatch(s, () => pintarTodo()) : null,
            s && s.cifraUrl ? h('a.print-link', { href: s.cifraUrl, target: '_blank', rel: 'noopener' }, '🎸 cifra') : null,
            bloqueada()
              ? (ms.cantantes || []).map(n => h('span.chip.sel', {}, n))
              : chipsPersonas(ms.cantantes || [], opcionesGente(), v => { ms.cantantes = v; guardar(); pintarTodo(); }, (s && s.cantantes) || []),
            bloqueada() ? null : h('div.sl-actions', { style: { marginLeft: 'auto' } },
              s ? botonCifra(s, () => pintarTodo()) : null,
              k > 0 ? h('button.icon-btn', { title: 'Subir', onclick: () => { const [x] = it.songs.splice(k, 1); it.songs.splice(k - 1, 0, x); guardar(); pintarTodo(); } }, '↑') : null,
              k < it.songs.length - 1 ? h('button.icon-btn', { title: 'Bajar', onclick: () => { const [x] = it.songs.splice(k, 1); it.songs.splice(k + 1, 0, x); guardar(); pintarTodo(); } }, '↓') : null,
              h('button.icon-btn', {
                title: 'Sacarlo del medley y dejarlo suelto en la lista',
                onclick: () => sacarDelMedley(i, k),
              }, '⤴'),
              h('button.icon-btn.danger', {
                title: 'Borrarlo de la lista',
                onclick: () => { it.songs.splice(k, 1); if (!it.songs.length) quitar(i); else { guardar(); pintarTodo(); } },
              }, '✕')));
          return fila;
        }),
        bloqueada() ? null : h('div', { style: { marginTop: '6px' } },
          h('button.btn.xs.ghost', {
            onclick: () => dialogoAgregarAMedley(it),
          }, '＋ tema al medley'))));
    return cont;
  }

  function dialogoAgregarAMedley(medley) {
    const ac = buscadorDeTemas(song => {
      medley.songs.push({ songId: song.id, cantantes: [] });
      guardar(); pintarTodo();
      toast(`«${song.titulo}» al medley`, 'ok');
    }, { placeholder: 'Buscar tema para el medley…', clearOnPick: true });
    const m = modal({
      title: `Agregar temas a «${medley.titulo || 'Medley'}»`,
      body: [h('div.method-hint', {}, 'Podés agregar varios seguidos; el diálogo queda abierto.'), ac],
      footer: [h('button.btn.primary', { onclick: () => m.close() }, 'Listo')],
    });
    setTimeout(() => ac.focusInput && ac.focusInput(), 80);
  }

  function pintarSetlist() {
    clear(setlistCont);
    const list = items();
    if (!list.length) {
      setlistCont.appendChild(h('div.dropzone', {},
        'Lista vacía. Escribí abajo para buscar en DBSongs, arrastrá temas desde el panel de la derecha, o generá una lista con MagicList.'));
      return;
    }

    let numero = 0;
    list.forEach((it, i) => {
      setlistCont.appendChild(lineaDrop());
      if (it.tipo === 'break') setlistCont.appendChild(filaBreak(it, i));
      else if (it.tipo === 'bloque') setlistCont.appendChild(filaBloque(it, i));
      else if (it.tipo === 'medley') { numero++; setlistCont.appendChild(filaMedley(it, i, numero)); }
      else { numero++; setlistCont.appendChild(filaSong(it, i, numero)); }
    });
    setlistCont.appendChild(lineaDrop());
  }

  /* ---------- barra de energía + stats ---------- */
  function pintarStats() {
    const list = items();
    let temas = 0, breaks = 0, medleys = 0, bloques = 0, minutos = 0;
    const franjas = { low: 0, mid: 0, high: 0, none: 0 };
    const cats = {};

    clear(energyCont);
    for (const it of list) {
      if (it.tipo === 'bloque') { bloques++; continue; }
      if (it.tipo === 'break') {
        breaks++; minutos += it.minutos || 0;
        energyCont.appendChild(h('div.bar.brk', { title: `${it.label || 'BREAK'} · ${it.minutos || 0}'` }));
        continue;
      }
      const ids = it.tipo === 'medley' ? (it.songs || []).map(x => x.songId) : [it.songId];
      if (it.tipo === 'medley') medleys++;
      ids.forEach(id => {
        const s = store.song(id);
        temas++;
        minutos += it.tipo === 'medley' ? MIN_POR_TEMA_MEDLEY : MIN_POR_TEMA;
        franjas[(s && s.franja) || 'none']++;
        if (s) cats[s.categoria] = (cats[s.categoria] || 0) + 1;
        const bpm = (s && s.bpm) || 0;
        // sin BPM cargado dibujamos una barra neutra a media altura
        const alto = bpm ? Math.max(16, Math.min(100, ((bpm - 55) / 130) * 100)) : 28;
        energyCont.appendChild(h('div.bar', {
          style: { height: alto + '%', background: s && s.franja ? `var(--${s.franja})` : 'var(--rayado)' },
          title: s ? `${s.titulo}${bpm ? ' · ' + bpm + ' bpm' : ' · sin BPM cargado'}` : '—',
        }));
      });
    }

    clear(statsCont);
    statsCont.append(
      h('span.chip', {}, h('b', {}, temas), ' temas'),
      medleys ? h('span.chip', {}, h('b', {}, medleys), ' medleys') : '',
      breaks ? h('span.chip', {}, h('b', {}, breaks), ' breaks') : '',
      bloques ? h('span.chip', {}, h('b', {}, bloques), ' bloques') : '',
      h('span.chip', {}, '≈ ', h('b', {}, minutos), ' min'),
      h('span.chip', {}, franjaDot('low'), franjas.low, ' · ', franjaDot('mid'), franjas.mid, ' · ', franjaDot('high'), franjas.high,
        franjas.none ? frag(' · ', franjaDot(null), franjas.none) : ''),
      ...Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => h('span.chip', {}, catPill(c), n)),
    );
  }

  /* Ojo: no redibuja el panel derecho a propósito — si lo hiciera, cada tema
     agregado reiniciaría el scroll, el buscador y la propuesta generada. */
  /* Al repintar, la lista queda un instante vacía y el navegador puede recortar
     el scroll si estabas cerca del fondo. Lo guardamos y lo devolvemos. */
  function pintarTodo() {
    const y = window.scrollY;
    pintarSetlist(); pintarStats(); pintarConvocados();
    aplicarDensidad();
    if (window.scrollY !== y) window.scrollTo(0, y);
  }

  /* ============================================================
     Buscador de temas: DBSongs primero, internet después.
     Si el tema no existe, se da de alta en DBSongs antes de usarlo.
     ============================================================ */
  function buscadorDeTemas(onPick, opts = {}) {
    return songAutocomplete({
      placeholder: 'Buscar tema en DBSongs… (si no está, lo busco en internet)',
      buscar: q => store.searchSongs(q, 10),
      onPick,
      buscarWeb: buscarEnWeb,
      onPickWeb: r => dialogoCancion(webAResultado(r), s => s && onPick(s)),
      onNew: q => dialogoCancion({ titulo: q }, s => s && onPick(s)),
      ...opts,
    });
  }

  /* ============================================================
     Panel lateral con los 3 métodos
     ============================================================ */
  let tab = 'pegar';

  function pintarSide() {
    clear(sidePanel);
    if (bloqueada() && jam.cerrada && !jam.historica) {
      sidePanel.append(
        h('h2.sec', {}, 'Jam cerrada'),
        h('div.method-hint', {},
          'La lista está congelada para pasarla en vivo. Para volver a editarla ',
          'hace falta el código con el que se cerró.'),
        h('button.btn.primary', { style: { width: '100%', justifyContent: 'center' },
          onclick: dialogoCodigo }, '🔓 Desbloquear con código'),
        h('button.btn.ghost', { style: { width: '100%', justifyContent: 'center', marginTop: '8px' },
          onclick: () => { const j = store.duplicateJam(jam.id); if (j) { toast('Jam duplicada', 'ok'); location.hash = '#/jams/' + j.id; } } },
          '⧉ Duplicar para editar'));
      return;
    }

    if (bloqueada()) {
      sidePanel.append(
        h('h2.sec', {}, 'Jam histórica'),
        h('div.method-hint', {},
          'Está cerrada para que no se rompa el registro de lo que pasó esa noche. ',
          'Si querés usarla de base, duplicala: la copia se edita libremente.'),
        h('button.btn.primary', { style: { width: '100%', justifyContent: 'center' },
          onclick: () => { const j = store.duplicateJam(jam.id); if (j) { toast('Jam duplicada', 'ok'); location.hash = '#/jams/' + j.id; } } },
          '⧉ Duplicar para editar'),
        h('button.btn.ghost', { style: { width: '100%', justifyContent: 'center', marginTop: '8px' },
          onclick: async () => {
            if (await confirmar('Vas a poder editar esta jam histórica. Es el registro de lo que se tocó esa noche: si la cambiás, cambian también los contadores y las estadísticas.',
              { titulo: 'Desbloquear jam histórica', okText: 'Desbloquear' })) {
              desbloqueadas.add(jam.id);
              refrescar();                       // se redibuja entera, ya sin candado
              toast('Jam desbloqueada', '');
            }
          } }, '🔓 Desbloquear igual'));
      return;
    }
    /* abierta a mano: dejamos a mano también el volver a cerrarla */
    if (jam.historica || jam.cerrada) {
      sidePanel.append(h('div.method-hint', { style: { marginBottom: '10px' } },
        jam.historica ? 'Estás editando una jam histórica. ' : 'Esta jam está cerrada y la abriste con el código. ',
        h('a', { href: '#', onclick: e => {
          e.preventDefault();
          desbloqueadas.delete(jam.id);
          refrescar();
          toast('Jam cerrada de nuevo');
        } }, 'Volver a cerrarla')));
    }

    sidePanel.append(
      h('div.tabs', {},
        h('button' + (tab === 'pegar' ? '.on' : ''), { onclick: () => { tab = 'pegar'; pintarSide(); } }, '1 · Pegar / arrastrar'),
        h('button' + (tab === 'genero' ? '.on' : ''), { onclick: () => { tab = 'genero'; pintarSide(); } }, '2 · MagicList'),
        h('button' + (tab === 'sugerencias' ? '.on' : ''), { onclick: () => { tab = 'sugerencias'; pintarSide(); } }, '3 · Sugerencias')),
      tab === 'pegar' ? panelPegar() : tab === 'genero' ? panelGenero() : panelSugerencias(),
    );
  }

  /* ---------- 3) sugerencias: nunca tocados ----------
     DBSongs ahora tiene solo repertorio tocado, así que los "nunca tocados"
     salen de internet: temas de las bandas que ya funcionan en la jam. */
  let yaSugeridos = new Set();       // para no repetir entre tandas

  function panelSugerencias() {
    const enLista = idsEnLista();
    const convocados = (jam.musicos || []).map(norm);
    const delGrupo = convocados.length
      ? store.songs.filter(s => !enLista.has(s.id) && (s.cantantes || []).some(c => convocados.includes(norm(c))))
      : [];

    const caja = h('div.palette-list', { style: { maxHeight: '340px' } });
    const btnTirada = h('button.btn.xs.ghost', { style: { marginLeft: 'auto' } }, '↻ otra tanda');

    async function tirada() {
      btnTirada.disabled = true;
      clear(caja);
      caja.appendChild(h('div.ac-loading', {}, '🌐 Buscando temas nuevos…'));

      const bandas = [...new Set(store.repertorio.map(s => s.artista))].sort(() => Math.random() - 0.5);
      const enBase = new Set(store.songs.map(s => norm(s.titulo) + '|' + norm(s.artista)));
      const hallados = [];

      for (let i = 0; i < bandas.length && hallados.length < 10; i += 3) {
        const tanda = bandas.slice(i, i + 3);
        const res = await Promise.all(tanda.map(b => temasDeArtista(b, 8)));
        tanda.forEach((banda, k) => {
          for (const r of res[k]) {
            const clave = norm(r.titulo) + '|' + norm(banda);
            if (!r.titulo || enBase.has(clave) || yaSugeridos.has(clave)) continue;
            yaSugeridos.add(clave);
            hallados.push({ ...r, artista: banda });
          }
        });
      }

      clear(caja);
      btnTirada.disabled = false;
      if (!hallados.length) { caja.appendChild(h('div.ac-loading', {}, 'No encontré temas nuevos ahora')); return; }

      hallados.sort(() => Math.random() - 0.5).slice(0, 10).forEach(r => {
        const datos = webAResultado(r);
        caja.appendChild(h('div.pal-item', {
          title: `${r.titulo} — ${r.artista}${r.anio ? ' · ' + r.anio : ''}\nDoble clic para agregarlo (se da de alta en DBSongs)`,
          ondblclick: () => sumarWeb(datos),
        },
          h('span.chip', {}, '🌐'),
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div.pal-t', {}, r.titulo),
            h('div.pal-a', {}, r.artista + (r.anio ? ' · ' + r.anio : ''))),
          h('button.icon-btn.pal-add', { title: 'Agregar al final', onclick: () => sumarWeb(datos) }, '＋')));
      });
    }

    function sumarWeb(datos) {
      const s = store.addSong(datos);
      agregarSong(s.id);
      toast(`«${s.titulo}» agregada y dada de alta en DBSongs`, 'ok');
    }

    btnTirada.onclick = tirada;
    tirada();

    return frag(
      h('div.method-hint', {}, 'Temas que nunca tocaron, buscados en internet entre las bandas que ya funcionan en la jam. Doble clic o ＋ para sumarlos: se dan de alta en DBSongs.'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
        h('h2.sec', { style: { margin: 0 } }, 'Nunca tocados'),
        btnTirada),
      caja,
      delGrupo.length ? frag(
        h('h2.sec', { style: { marginTop: '18px' } }, 'Repertorio de los convocados'),
        h('div.palette-list', { style: { maxHeight: '230px' } }, delGrupo.slice(0, 14).map(s => itemPaleta(s)))) : null,
    );
  }

  /* ---------- 2) MagicList ---------- */
  const gen = estadoInicial();
  let propuesta = [];
  let repintarPropuesta = () => {};

  /**
   * Convierte lo que se está arrastrando en un songId usable.
   * Si viene de la propuesta de MagicList, la da de alta (cuando es un tema de
   * internet) y la saca de la propuesta: así se van eligiendo de a uno.
   */
  function songIdDeArrastre(a) {
    if (!a) return null;
    if (a.tipo === 'song') return a.songId;
    if (a.tipo === 'propuesta') {
      const p = propuesta[a.indice];
      if (!p) return null;
      propuesta.splice(a.indice, 1);
      repintarPropuesta();
      return p.esWeb ? store.addSong(p.datos).id : p.id;
    }
    return null;
  }

  function panelGenero() {
    const preview = h('div.preview-list');
    const acciones = h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } });
    const btnGenerar = h('button.btn.primary', {
      onclick: async () => {
        btnGenerar.disabled = true;
        try { propuesta = await generarPropuesta(gen, idsEnLista(), btnGenerar); }
        finally { btnGenerar.disabled = false; }
        pintarPropuesta();
      },
    }, '🎲 Generar propuesta');

    /** Se lleva un solo tema de la propuesta a la lista. */
    function tomarUno(i, at) {
      const id = songIdDeArrastre({ tipo: 'propuesta', indice: i });
      if (!id) return;
      agregarSong(id, at);
      toast(`«${store.song(id).titulo}» agregada`, 'ok');
    }

    function pintarPropuesta() {
      clear(preview); clear(acciones);
      if (!propuesta.length) return;

      propuesta.forEach((s, i) => {
        const fila = h('div.preview-row', {
          title: 'Arrastralo a la lista desde ⠿, o ＋ para mandarlo al final',
          ondragstart: e => {
            arrastre = { tipo: 'propuesta', indice: i };
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', `${s.titulo} - ${s.artista}`);
          },
          ondragend: () => { arrastre = null; fila.draggable = false; },
        });
        poner(fila,
          manija('Arrastrar a la lista'),
        h('span.pv-n', {}, i + 1),
        franjaDot(s.franja),
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.titulo),
        s.esWeb ? h('span.chip', { title: 'Encontrado en internet — se agrega a DBSongs' }, '🌐') : null,
        h('span.dim', { style: { fontSize: '11px', maxWidth: '84px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.artista),
          h('button.icon-btn', { title: 'Agregar solo este al final', onclick: () => tomarUno(i) }, '＋'),
          h('button.icon-btn', { title: 'Descartarlo de la propuesta', onclick: () => { propuesta.splice(i, 1); pintarPropuesta(); } }, '✕'));
        preview.appendChild(fila);
      });

      acciones.append(
        h('button.btn.primary.sm', { onclick: () => volcar() }, `Agregar los ${propuesta.length} al final`),
        h('button.btn.sm.ghost', { onclick: () => btnGenerar.click() }, '↻ Otra vuelta'));
    }
    repintarPropuesta = pintarPropuesta;

    function volcar() {
      const nuevos = propuestaAItems(propuesta);
      jam.items = [...items(), ...nuevos];
      propuesta = [];
      guardar(); pintarTodo(); pintarSide();
      toast(`${nuevos.length} temas en la lista`, 'ok');
    }

    const cont = frag(
      h('div.method-hint', {}, 'Elegí el color de la jam y te propongo una lista ordenada por curva de energía. Después la editás como quieras.'),
      filtrosMagicList(gen, () => pintarSide()),
      h('div', { style: { marginTop: '14px' } }, btnGenerar),
      preview, acciones,
    );

    if (propuesta.length) setTimeout(pintarPropuesta, 0);
    return cont;
  }


  /* ---------- 3) pegar / arrastrar ---------- */
  let filtroPaleta = '', palCat = '', palFranja = '';

  function panelPegar() {
    const lista = h('div.palette-list', { style: { maxHeight: '300px' } });
    const cuenta = h('span.dim', { style: { fontSize: '11px', fontFamily: 'var(--mono)' } });
    const buscador = h('input', { type: 'search', placeholder: 'Buscar tema o artista…', value: filtroPaleta });

    const selCat = select(
      [{ value: '', label: 'Todas las categorías' }, ...store.categorias.map(c => ({ value: c, label: catCorta(c) }))],
      { value: palCat, onchange: e => { palCat = e.target.value; pintarPaleta(); } });

    const selFranja = select(
      [{ value: '', label: 'Toda franja' },
       { value: 'low', label: FRANJA_LABEL.low }, { value: 'mid', label: FRANJA_LABEL.mid }, { value: 'high', label: FRANJA_LABEL.high }],
      { value: palFranja, onchange: e => { palFranja = e.target.value; pintarPaleta(); } });

    const pintarPaleta = () => {
      clear(lista);
      let res = store.repertorio;
      if (palCat) res = res.filter(s => s.categoria === palCat);
      if (palFranja) res = res.filter(s => s.franja === palFranja);

      const q = norm(filtroPaleta);
      if (q) {
        const partes = q.split(' ');
        res = res.filter(s => partes.every(t => (norm(s.titulo) + ' ' + norm(s.artista)).includes(t)));
      }

      const total = res.length;
      res = [...res].sort((a, b) => (b.jams || []).length - (a.jams || []).length).slice(0, 60);
      cuenta.textContent = total > res.length ? `${res.length} de ${total}` : `${total}`;

      res.forEach(s => lista.appendChild(itemPaleta(s)));
      if (!res.length) lista.appendChild(h('div.ac-loading', {}, 'Nada con esos filtros'));
    };
    buscador.addEventListener('input', () => { filtroPaleta = buscador.value; pintarPaleta(); });
    pintarPaleta();

    /* --- pegado masivo --- */
    const ta = h('textarea', {
      placeholder: 'Pegá acá la lista, un tema por línea:\n\nSultans of Swing - Dire Straits\nDe Música Ligera — Soda Stereo\nBREAK\n1. Rolling in the Deep',
      style: { minHeight: '120px' },
    });
    const resultado = h('div.paste-result');
    const accionesPegar = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } });

    function analizar() {
      const lineas = parsearPegado(ta.value);
      clear(resultado); clear(accionesPegar);
      if (!lineas.length) { toast('No hay nada para analizar', 'err'); return; }

      lineas.forEach(l => {
        if (l.esBreak) {
          resultado.appendChild(h('div.paste-row.ok', {}, h('div.pr-main', {}, h('div.pr-t', {}, 'BREAK'), h('div.pr-s', {}, 'separador'))));
          return;
        }
        const s = store.matchSong(l.titulo, l.artista) || store.matchSong(l.artista, l.titulo);
        l.match = s;
        resultado.appendChild(h('div.paste-row.' + (s ? 'ok' : 'new'), {},
          s ? franjaDot(s.franja) : h('span', {}, '✨'),
          h('div.pr-main', {},
            h('div.pr-t', {}, s ? s.titulo : l.titulo),
            h('div.pr-s', {}, s ? s.artista + ' · ya está en DBSongs' : (l.artista ? l.artista + ' · ' : '') + 'no está en DBSongs')),
          s ? null : h('button.btn.xs', { onclick: e => { e.stopPropagation(); crearDesdeLinea(l); } }, '🌐 buscar y crear')));
      });

      const hallados = lineas.filter(l => l.match || l.esBreak);
      const faltantes = lineas.filter(l => !l.match && !l.esBreak);
      poner(accionesPegar,
        h('button.btn.primary.sm', {
          onclick: () => {
            const nuevos = hallados.map(l => l.esBreak
              ? { tipo: 'break', label: 'BREAK', minutos: 15 }
              : { tipo: 'song', songId: l.match.id, cantantes: [], notas: '' });
            jam.items = [...items(), ...nuevos];
            guardar(); pintarTodo();
            toast(`${nuevos.length} agregados a la lista`, 'ok');
          },
        }, `Agregar ${hallados.length} a la lista`),
        faltantes.length ? h('button.btn.sm', {
          onclick: async () => {
            toast(`Buscando ${faltantes.length} temas en internet…`);
            for (const l of faltantes) await crearDesdeLinea(l, true);
            analizar();
          },
        }, `🌐 Crear los ${faltantes.length} que faltan`) : null,
        h('button.btn.sm.ghost', { onclick: () => { ta.value = ''; clear(resultado); clear(accionesPegar); } }, 'Limpiar'));
    }

    async function crearDesdeLinea(l, silencioso = false) {
      if (silencioso) {
        l.match = await crearSongDesde(l);
        return l.match;
      }
      let datos = { titulo: l.titulo, artista: l.artista, origen: 'manual' };
      try {
        const res = await buscarEnWeb([l.titulo, l.artista].filter(Boolean).join(' '));
        if (res.length) datos = webAResultado(res[0]);
      } catch { /* seguimos con lo que escribió el usuario */ }
      dialogoCancion(datos, s => { if (s) { l.match = s; analizar(); } });
    }

    return frag(
      h('div', { style: { marginBottom: '8px' } }, buscador),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' } },
        selCat, selFranja, cuenta),
      lista,
      h('h2.sec', { style: { marginTop: '18px' } }, 'Pegar una lista'),
      ta,
      h('button.btn.sm', { style: { marginTop: '8px' }, onclick: analizar }, 'Analizar lo pegado'),
      accionesPegar,
      resultado,
    );
  }

  /* ítem de la paleta: se arrastra a la lista o se agrega con doble clic / ＋ */
  function itemPaleta(s, opts = {}) {
    const sumar = () => { agregarSong(s.id); toast(`«${s.titulo}» agregada`, 'ok'); };

    // cuántas veces tocamos otros temas de esta banda (para las sugerencias)
    const vecesBanda = opts.mostrarArtistaTocado
      ? store.songs.filter(x => x.artista === s.artista).reduce((n, x) => n + (x.jams || []).length, 0)
      : 0;

    return h('div.pal-item', {
      draggable: true,
      ondragstart: e => { arrastre = { tipo: 'song', songId: s.id }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', `${s.titulo} - ${s.artista}`); },
      ondragend: () => { arrastre = null; },
      ondblclick: sumar,
      title: `${s.titulo} — ${s.artista}${s.bpm ? ' · ' + s.bpm + ' bpm' : ''}`
        + ((s.jams || []).length ? ` · tocada ${s.jams.length}×` : ' · nunca tocada')
        + '\nDoble clic para agregarla a la lista',
    },
      franjaDot(s.franja),
      h('div', { style: { minWidth: 0, flex: 1 } },
        h('div.pal-t', {}, s.titulo),
        h('div.pal-a', {}, s.artista + (vecesBanda ? ` · la banda ya sonó ${vecesBanda}×` : ''))),
      h('button.icon-btn.pal-add', { title: 'Agregar al final', onclick: sumar }, '＋'),
    );
  }

  /* ============================================================
     Encabezado + metadatos
     ============================================================ */
  const nombreInput = input({ value: jam.nombre, disabled: bloqueada(), placeholder: 'Nombre de la jam', oninput: e => { jam.nombre = e.target.value; tituloEnc.textContent = e.target.value || 'Jam sin nombre'; guardar(); } });
  tituloEnc.textContent = jam.nombre || 'Jam sin nombre';

  const ensayosCont = seccionEnsayos(jam);

  /* ============================================================
     Convocatoria — sale sola de la lista de temas
     ------------------------------------------------------------
     Los cantantes son los que están asignados en el setlist. A eso
     se le suman a mano los músicos que no cantan (batería, saxo…).
     ============================================================ */
  const convocadosCont = h('div');

  /** Quién canta en la lista y cuántos temas tiene cada uno. */
  function cantantesDelSetlist() {
    const cuenta = new Map();
    const sumar = ns => (ns || []).forEach(n => cuenta.set(n, (cuenta.get(n) || 0) + 1));
    for (const it of items()) {
      if (it.tipo === 'medley') (it.songs || []).forEach(ms => sumar(ms.cantantes));
      else if (it.tipo === 'song') sumar(it.cantantes);
    }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  /** Mantiene jam.musicos = los del setlist + los invitados a mano. */
  function sincronizarConvocados() {
    const delSetlist = cantantesDelSetlist().map(([n]) => n);
    jam.musicosExtra = (jam.musicosExtra || []).filter(n => !delSetlist.includes(n));
    jam.musicos = [...delSetlist, ...jam.musicosExtra];
  }

  const resumenMeta = h('span.dim', { style: { fontSize: '12px', marginLeft: 'auto' } });

  function pintarConvocados() {
    sincronizarConvocados();
    clear(convocadosCont);
    const delSetlist = cantantesDelSetlist();

    resumenMeta.textContent = [
      jam.fecha ? fechaLinda(jam.fecha) : 'sin fecha',
      jam.lugar,
      `${(jam.musicos || []).length} convocados`,
    ].filter(Boolean).join(' · ');

    const ens = (jam.ensayos || []).length;
    resumenProd.textContent = [
      ens ? `${ens} ensayo${ens > 1 ? 's' : ''}` : 'sin ensayos',
      `${(jam.musicos || []).length} convocados`,
      jam.notas ? 'con notas' : null,
    ].filter(Boolean).join(' · ');

    convocadosCont.append(
      h('h2.sec', {}, `Cantan en la lista (${delSetlist.length})`),
      delSetlist.length
        ? h('div.chips', {}, delSetlist.map(([n, cuantos]) =>
            h('span.chip.sel', { title: `${cuantos} tema${cuantos > 1 ? 's' : ''} en esta jam` },
              n, h('span.dim', { style: { marginLeft: '4px', fontSize: '10px' } }, cuantos))))
        : h('div.method-hint', {}, 'Todavía no asignaste cantantes. Usá el ＋ de cada tema en la lista y acá se arma sola la convocatoria.'),

      h('h2.sec', { style: { marginTop: '16px' } }, 'Además convoco a'),
      h('div.dim', { style: { fontSize: '11.5px', marginBottom: '8px' } },
        'Los que no cantan: batería, saxo, caños, invitados.'),
      personPicker({
        opciones: [...new Set([...store.musicos.map(m => m.nombre), ...store.cantantes.map(c => c.nombre)])]
          .filter(n => !delSetlist.some(([x]) => x === n))
          .sort((a, b) => a.localeCompare(b)),
        seleccionados: jam.musicosExtra || [],
        onChange: v => { jam.musicosExtra = v; sincronizarConvocados(); guardar(); pintarConvocados(); },
        placeholder: 'Sumar músico o invitado…',
      }),
    );
  }

  // arranca cerrado: la pantalla es para la lista. Solo se abre solo en una
  // jam recién creada, donde todavía falta cargar los datos.
  let metaAbierto = !jam.items.length && !jam.fecha;
  const metaBody = h('div', { style: { display: metaAbierto ? 'block' : 'none' } },
    h('div.meta-grid', {},
      field('Nombre', nombreInput),
      field('Fecha', h('input', { type: 'date', value: jam.fecha || '', disabled: bloqueada(), oninput: e => { jam.fecha = e.target.value; guardar(); pintarConvocados(); } })),
      field('Horario', h('input', { type: 'time', value: jam.hora || '', disabled: bloqueada(), oninput: e => { jam.hora = e.target.value; guardar(); } }))),
    h('div', { style: { marginTop: '12px' } }, field('Lugar', input({ value: jam.lugar || '', disabled: bloqueada(), placeholder: 'Portal, Makena, Serena…', oninput: e => { jam.lugar = e.target.value; guardar(); pintarConvocados(); } }))),
  );

  const metaCard = h('div.card.no-print', {},
    h('div.card-head', { style: { marginBottom: metaAbierto ? '14px' : '0', cursor: 'pointer' },
      onclick: () => { metaAbierto = !metaAbierto; metaBody.style.display = metaAbierto ? 'block' : 'none'; } },
      h('h3', {}, 'Datos de la jam'),
      resumenMeta,
      h('span.dim', {}, '▾')),
    metaBody);

  /* la producción va después de la lista: se arma con la lista ya hecha */
  let prodAbierto = false;
  const resumenProd = h('span.dim', { style: { fontSize: '12px', marginLeft: 'auto' } });

  const prodBody = h('div', { style: { display: 'none' } },
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' } },
      h('h2.sec', { style: { margin: 0 } }, 'Ensayos'),
      h('span.dim', { style: { fontSize: '11.5px' } }, 'cada uno con su convocatoria y horarios')),
    ensayosCont,
    h('div', { style: { marginTop: '18px' } }, convocadosCont),
    h('div', { style: { marginTop: '18px' } },
      field('Notas', h('textarea', { value: jam.notas || '', disabled: bloqueada(), oninput: e => { jam.notas = e.target.value; guardar(); } }))));

  const produccionCard = h('div.card.no-print', { style: { marginTop: '16px' } },
    h('div.card-head', { style: { marginBottom: '0', cursor: 'pointer' },
      onclick: () => {
        prodAbierto = !prodAbierto;
        prodBody.style.display = prodAbierto ? 'block' : 'none';
        produccionCard.querySelector('.card-head').style.marginBottom = prodAbierto ? '14px' : '0';
      } },
      h('h3', {}, 'Producción'),
      resumenProd,
      h('span.dim', {}, '▾')),
    prodBody);

  /* ---------- acciones de cabecera ---------- */
  function comoTexto() {
    const L = [];
    L.push(jam.nombre || 'Jam');
    const cab = [jam.fecha ? fechaLinda(jam.fecha) : '', jam.hora, jam.lugar].filter(Boolean).join(' · ');
    if (cab) L.push(cab);
    if ((jam.musicos || []).length) L.push('Convocados: ' + jam.musicos.join(', '));
    L.push('');
    let n = 0;
    for (const it of items()) {
      if (it.tipo === 'bloque') { L.push('', `▸ ${(it.label || '').toUpperCase()}`); continue; }
      if (it.tipo === 'break') { L.push(`—— ${it.label || 'BREAK'} ${it.minutos ? `(${it.minutos}')` : ''} ——`); continue; }
      if (it.tipo === 'medley') {
        n++;
        L.push(`${n}. ${it.titulo || 'Medley'} (medley)`);
        (it.songs || []).forEach(ms => {
          const s = store.song(ms.songId);
          L.push(`   · ${s ? s.titulo : '?'}${s ? ' — ' + s.artista : ''}${(ms.cantantes || []).length ? '  [' + ms.cantantes.join(', ') + ']' : ''}`);
          if (s && s.cifraUrl) L.push(`     ${s.cifraUrl}`);
        });
        continue;
      }
      n++;
      const s = store.song(it.songId);
      L.push(`${n}. ${s ? s.titulo : '?'}${s ? ' — ' + s.artista : ''}${(it.cantantes || []).length ? '  [' + it.cantantes.join(', ') + ']' : ''}`);
      if (s && s.cifraUrl) L.push(`   ${s.cifraUrl}`);
    }
    return L.join('\n');
  }




  /* ---------- encabezado de impresión ----------
     Al imprimir con "Guardar como PDF", Chrome y Safari conservan los <a href>
     como links clickeables, así que las cifras quedan a un clic en el PDF. */
  const pieImpresion = h('div.print-foot');

  function prepararImpresion() {
    const ahora = new Date();
    clear(pieImpresion);
    pieImpresion.append(
      h('div', {}, [jam.fecha ? fechaLinda(jam.fecha) : 'sin fecha', jam.hora, jam.lugar].filter(Boolean).join(' · ')),
      (jam.musicos || []).length ? h('div', {}, 'Convocados: ' + jam.musicos.join(', ')) : null,
      h('div.print-stamp', {}, 'JAM PORTAL · generado el ' +
        ahora.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' a las ' + ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })),
    );
    // el título de la página es el nombre que propone el "Guardar como PDF"
    document.title = `${jam.nombre || 'Jam'}${jam.fecha ? ' — ' + jam.fecha : ''}`;
  }
  prepararImpresion();

  const acciones = h('div.page-actions', {},
    h('button.btn.vivo', {
      onclick: () => { prepararImpresion(); location.hash = '#/live/' + jam.id; },
      title: 'La lista en pantalla grande para seguirla durante la jam',
    }, '▶ LIVE VIEW'),
    h('button.btn.letras', {
      onclick: () => { location.hash = '#/lyrics/' + jam.id; },
      title: 'Las letras de todos los temas, en orden',
    }, '📖 LYRICS VIEW'),
    btnGremios,
    h('button.btn.sm.secundaria', { onclick: () => copiar(comoTexto()) }, '📋 Copiar lista'),
    /* En el celular estos dos están en el ⋯, que arriba de 820px no existe:
       la barra de acciones es el único lugar donde se los ve con el mouse. */
    h('button.btn.sm.secundaria', {
      title: 'Un link para que entren sin cuenta y editen esta jam',
      onclick: () => dialogoLink(jam),
    }, '🔗 Compartir'),
    h('button.btn.sm.secundaria', {
      title: 'Volver la lista a como estaba antes de un cambio',
      onclick: () => dialogoRespaldos(jam, refrescar),
    }, '↩ Versiones'),
    (jam.historica || bloqueada()) ? null
      : h('button.btn.sm.secundaria', {
          title: 'Congelar la lista para pasarla en vivo',
          onclick: dialogoCerrar,
        }, '🔒 Cerrar jam'),
    h('button.btn.sm.secundaria', { onclick: () => { const j = store.duplicateJam(jam.id); if (j) { toast('Jam duplicada', 'ok'); location.hash = '#/jams/' + j.id; } } }, '⧉ Duplicar'),
    h('button.btn.sm.danger.secundaria', { onclick: () => borrarJam(jam) }, 'Borrar'),

  );

  /* En el celular solo quedan LIVE y LYRICS entre los botones, que es lo que
     se usa parado frente a la gente. El resto va al ⋯ de la barra de arriba
     —el mismo lugar en el que está en todas las demás pantallas—, así no hay
     que buscar dónde quedó el menú en cada una. */
  function menuDeLaJam() {
    hojaAcciones(jam.nombre || 'Jam', [
      { icono: '☰', texto: 'Verla como lista', onClick: () => { location.hash = '#/jams/' + jam.id; } },
      { icono: '📋', texto: 'Copiar la lista', onClick: () => copiar(comoTexto()) },
      { icono: '🔗', texto: 'Link para compartir esta jam', onClick: () => dialogoLink(jam) },
      /* refrescar() y no pintarTodo(): sincronizar() reemplaza los objetos del
         estado, así que la `jam` que esta vista capturó al construirse queda
         apuntando a la versión vieja y redibujarla no muestra nada nuevo. */
      { icono: '↩', texto: 'Versiones anteriores de la lista',
        onClick: () => dialogoRespaldos(jam, refrescar) },
      (jam.historica || bloqueada()) ? null
        : { icono: '🔒', texto: 'Cerrar la jam', onClick: dialogoCerrar },
      { icono: '⧉', texto: 'Duplicar', onClick: () => { const j = store.duplicateJam(jam.id); if (j) { toast('Jam duplicada', 'ok'); location.hash = '#/jams/' + j.id; } } },
      { icono: '✕', texto: 'Borrar la jam', peligro: true, onClick: () => borrarJam(jam) },
    ]);
  }
  accionesDePagina(menuDeLaJam);

  /* ---------- barra de inserción ---------- */
  const insertBar = h('div.insert-bar');

  function pintarInsertBar() {
    clear(insertBar);
    if (bloqueada()) { insertBar.style.display = 'none'; return; }
    insertBar.style.display = '';
    insertBar.append(
      buscadorDeTemas(s => { agregarSong(s.id); toast(`«${s.titulo}» agregada`, 'ok'); }),
      h('button.btn.sm', { onclick: () => insertar({ tipo: 'break', label: 'BREAK', minutos: 15 }) }, '＋ BREAK'),
      h('button.btn.sm', { onclick: () => insertar({ tipo: 'medley', titulo: 'Medley', songs: [], notas: '' }) }, '＋ Medley'),
      h('button.btn.sm', { onclick: () => insertar({ tipo: 'bloque', label: '' }) }, '＋ Bloque'));
  }

  /* ---------- armado final ---------- */
  sincronizarConvocados();
  pintarTodo();
  pintarSide();
  pintarInsertBar();

  /* la tarjeta recién existe cuando esto se monta, así que la densidad
     se aplica un tick después */
  setTimeout(aplicarDensidad, 0);

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('div.titulo-jam', {},
          h('a.btn.sm.ghost', { href: '#/jams', title: 'Volver a la lista de jams' }, '← Volver'),
          tituloEnc),
        h('p.sub', {}, bloqueada()
          ? (jam.historica
              ? 'Jam histórica: es el registro de lo que se tocó esa noche, así que está cerrada. Duplicala para usarla de base.'
              : '🔒 Jam cerrada: la lista está congelada para el vivo. Para editarla hace falta el código.')
          : jam.historica
            ? '🔓 Jam histórica desbloqueada: lo que cambies acá cambia el registro y las estadísticas.'
            : jam.cerrada
              ? '🔓 Jam cerrada, abierta con el código: acordate de volver a cerrarla antes del vivo.'
              : 'Armá la lista con cualquiera de los tres métodos del panel derecho.')),
      acciones),

    h('div.editor-grid', {},
      h('div', {},
        metaCard,
        h('div.card', { style: { marginTop: '16px' } },
          h('div.card-head', {}, h('h3', {}, 'Lista de temas'),
            btnPantalla,
            bloqueada() ? null : h('button.btn.xs', {
              onclick: dialogoTexto,
              title: 'Ver y editar toda la lista junta, como en un doc',
            }, '📝 Editar como texto'),
            btnDensidad,
            h('span.dim', { style: { fontSize: '11.5px', marginLeft: 'auto' } }, 'arrastrá ⠿ para reordenar')),
          pieImpresion,
          statsCont,
          energyCont,
          setlistCont,
          insertBar),
        bloqueada() ? null : produccionCard),
      h('div.editor-side', {}, sidePanel)),
  );
}

/* ============================================================
   Utilidades
   ============================================================ */

/** Parsea el pegado libre en líneas {titulo, artista, esBreak}. */
export function parsearPegado(txt) {
  return (txt || '').split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(raw => {
      let l = raw.replace(/^\s*(\d+\s*[.)\-–]\s*|[-•*·]\s+)/, '').trim();
      if (/^(break|intervalo|corte|descanso)\b/i.test(l)) return { raw, esBreak: true, titulo: 'BREAK', artista: '' };

      let titulo = l, artista = '';
      const partes = l.split(/\s+[-–—|]\s+/);
      if (partes.length >= 2) {
        titulo = partes[0];
        artista = partes.slice(1).join(' - ');
      } else {
        const p = l.match(/^(.*?)\s*\(([^)]{2,})\)\s*$/);
        if (p) { titulo = p[1]; artista = p[2]; }
      }
      return { raw, titulo: titulo.trim(), artista: artista.trim(), esBreak: false };
    });
}

