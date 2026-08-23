/* ============================================================
   views/jam-editor.js — editor de una jam + armado del setlist
   ------------------------------------------------------------
   Tres métodos de armado:
     1) Pegar o arrastrar desde DBSongs
     2) MagicList: generada por género, franja y curva de energía
     3) Sugerencias: nunca tocados de bandas que ya funcionan
   ============================================================ */

import { store, norm, franjaDeBpm, FRANJA_LABEL } from '../store.js';
import {
  h, frag, clear, poner, field, input, select, personPicker, toast, modal, confirmar, songAutocomplete,
  catPill, catCorta, franjaDot, fechaLinda, copiar, debounce,
} from '../ui.js';
import { buscarEnWeb, webAResultado, buscarBpm, temasDeArtista } from '../lookup.js';
import { buscarCifra, urlBusqueda } from '../cifra.js';
import { chipTempo } from '../tempo.js';
import { dialogoCancion } from './song-form.js';
import { seccionEnsayos } from './ensayos.js';
import { borrarJam } from './jams.js';
import { refrescar } from '../app.js';
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
      const fila = sp.closest('.sl-item, .preview-row');   // la busca sola al apretarla
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
function menuFlotante(anchor, opciones, onPick) {
  const menu = h('div.ac-menu', { style: { position: 'fixed', width: '210px', maxHeight: '300px' } });
  const cerrar = () => { menu.remove(); document.removeEventListener('mousedown', fuera, true); };
  const fuera = e => { if (!menu.contains(e.target)) cerrar(); };

  opciones.forEach(o => {
    const { value, label, hint } = typeof o === 'string' ? { value: o, label: o } : o;
    menu.appendChild(h('div.ac-item', {
      onclick: () => { onPick(value); cerrar(); },
    }, h('div.ac-t', {}, label), hint ? h('div.ac-r', {}, h('span.chip', {}, hint)) : null));
  });
  if (!opciones.length) menu.appendChild(h('div.ac-loading', {}, 'No hay más nombres'));

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - 226) + 'px';
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 310) + 'px';
  setTimeout(() => document.addEventListener('mousedown', fuera, true), 0);
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
          libres.map(o => ({ value: o, label: o, hint: sugeridos.includes(o) ? '★ suele cantarla' : null }))
            .sort((a, b) => (b.hint ? 1 : 0) - (a.hint ? 1 : 0)),
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

  function filaSong(it, i, numero) {
    const s = store.song(it.songId);
    if (!s) return h('div.sl-item', {}, h('span.sl-num', {}, numero), h('div.sl-main', {}, h('span.dim', {}, 'Tema borrado de DBSongs')),
      h('button.icon-btn.danger', { onclick: () => quitar(i) }, '✕'));

    const row = h('div.sl-item', {
      ondragstart: e => { arrastre = { tipo: 'item', index: i }; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.titulo); },
      ondragend: () => { row.classList.remove('dragging'); arrastre = null; },
    },
      bloqueada() ? null : manija(),
      h('span.sl-num', {}, numero),
      h('div.sl-main', {},
        h('div.sl-title', {}, s.titulo),
        h('div.sl-sub', {},
          franjaDot(s.franja),
          h('span', {}, s.artista),
          catPill(s.categoria),
          bloqueada()
            ? (s.bpm ? h('span.mono.dim', {}, (s.bpmFuente === 'sugerido' ? '≈ ' : '') + s.bpm + ' bpm') : null)
            : chipTempo(s, () => pintarTodo()),
          s.esIdea
            ? h('span.chip.idea', { title: 'Sigue en Ideas: pasa al repertorio cuando la fecha de esta jam quede atrás' }, '💡 idea')
            : ((s.jams || []).length
                ? h('span.dim', { title: (s.jams || []).join('\n') }, `tocada ${s.jams.length}×`)
                : h('span.dim', {}, 'nunca tocada')),
          (s.patches || []).length ? h('span.chip', { title: 'Patch de teclado' }, '🎹 ' + s.patches.join(' ')) : null,
          s.cifraUrl ? h('a.print-link', { href: s.cifraUrl, target: '_blank', rel: 'noopener' }, '🎸 cifra') : null,
          bloqueada()
            ? (it.cantantes || []).map(n => h('span.chip.sel', {}, n))
            : chipsPersonas(it.cantantes || [], opcionesGente(), v => { it.cantantes = v; guardar(); pintarTodo(); }, s.cantantes || []),
        )),
      bloqueada() ? h('div.sl-actions', {}, botonCifra(s, () => pintarTodo())) : h('div.sl-actions', {},
        botonCifra(s, () => pintarTodo()),
        h('button.icon-btn', { title: 'Unir en medley con el siguiente', onclick: () => unirEnMedley(i) }, '⛓'),
        h('button.icon-btn', { title: 'Editar el tema en DBSongs', onclick: () => dialogoCancion(s, () => pintarTodo()) }, '✎'),
        h('button.icon-btn.danger', { title: 'Sacar de la lista', onclick: () => quitar(i) }, '✕')),
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

    poner(cont,
      h('div.med-head', {},
        bloqueada() ? null : manija(),
        h('span.sl-num', {}, numero),
        h('span.med-badge', {}, 'MEDLEY'),
        h('input', { value: it.titulo || 'Medley', disabled: bloqueada(), oninput: e => { it.titulo = e.target.value; guardar(); } }),
        bloqueada() ? null : h('div.sl-actions', {},
          h('button.icon-btn', { title: 'Desarmar el medley', onclick: () => desarmarMedley(i) }, '⊟'),
          h('button.icon-btn.danger', { title: 'Quitar', onclick: () => quitar(i) }, '✕'))),
      h('div.med-songs', {},
        (it.songs || []).map((ms, k) => {
          const s = store.song(ms.songId);
          return h('div.med-song', {},
            franjaDot(s && s.franja),
            h('span', {}, s ? s.titulo : '—'),
            h('span.dim', { style: { fontSize: '11px' } }, s ? s.artista : ''),
            s ? (bloqueada()
              ? (s.bpm ? h('span.mono.dim', { style: { fontSize: '11px' } }, s.bpm) : null)
              : chipTempo(s, () => pintarTodo())) : null,
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
        h('button.btn.primary.sm', { onclick: () => volcar(false) }, `Agregar los ${propuesta.length} al final`),
        h('button.btn.sm', { onclick: () => volcar(true) }, 'Reemplazar la lista'),
        h('button.btn.sm.ghost', { onclick: () => btnGenerar.click() }, '↻ Otra vuelta'));
    }
    repintarPropuesta = pintarPropuesta;

    function volcar(reemplazar) {
      const nuevos = propuestaAItems(propuesta);
      jam.items = reemplazar ? nuevos : [...items(), ...nuevos];
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
      const q = [l.titulo, l.artista].filter(Boolean).join(' ');
      let datos = { titulo: l.titulo, artista: l.artista, origen: 'manual' };
      try {
        const res = await buscarEnWeb(q);
        if (res.length) datos = webAResultado(res[0]);
      } catch { /* seguimos con lo que escribió el usuario */ }
      if (silencioso) {
        const s = store.addSong(datos);
        l.match = s;
        return s;
      }
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

  /** Resuelve la cifra de todos los temas de la lista que todavía no la tengan. */
  async function cifrasDeLaLista(btn) {
    const ids = [...idsEnLista()];
    const pendientes = ids.map(id => store.song(id)).filter(s => s && !s.cifraUrl && s.cifraConfianza !== 'no');

    if (!pendientes.length) { toast('Ya están todas las cifras que se pueden conseguir', 'ok'); return; }

    btn.disabled = true;
    let hallada = 0, dudosa = 0, sin = 0;
    for (const [i, s] of pendientes.entries()) {
      btn.textContent = `🎸 ${i + 1}/${pendientes.length}…`;
      try {
        const r = await buscarCifra(s.titulo, s.artista);
        if (r) {
          store.updateSong(s.id, { cifraUrl: r.url, cifraArtista: r.artista, cifraConfianza: r.confianza });
          r.confianza === 'alta' ? hallada++ : dudosa++;
        } else {
          store.updateSong(s.id, { cifraUrl: '', cifraConfianza: 'no' });
          sin++;
        }
      } catch { sin++; }
      await new Promise(r => setTimeout(r, 180));   // no castigar la API
    }
    btn.textContent = '🎸 Cifras'; btn.disabled = false;
    pintarTodo();
    toast(`${hallada} cifras encontradas` + (dudosa ? ` · ${dudosa} dudosas` : '') + (sin ? ` · ${sin} sin cifra` : ''), 'ok');
  }

  const btnCifras = h('button.btn.sm', { onclick: () => cifrasDeLaLista(btnCifras) }, '🎸 Cifras');

  /** Completa los BPM que faltan buscándolos en internet. Nunca pisa los medidos. */
  async function temposDeLaLista(btn) {
    const pendientes = [...idsEnLista()].map(id => store.song(id))
      .filter(s => s && !s.bpm && s.bpmFuente !== 'sin');

    if (!pendientes.length) { toast('Todos los temas de la lista ya tienen tempo', 'ok'); return; }

    btn.disabled = true;
    let ok = 0, sin = 0;
    for (const [i, s] of pendientes.entries()) {
      btn.textContent = `⏱ ${i + 1}/${pendientes.length}…`;
      const r = await buscarBpm(s.titulo, s.artista);
      if (r) {
        store.updateSong(s.id, { bpm: r.bpm, bpmFuente: 'sugerido', franja: franjaDeBpm(r.bpm) });
        ok++;
      } else {
        store.updateSong(s.id, { bpmFuente: 'sin' });
        sin++;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    btn.textContent = '⏱ Tempos'; btn.disabled = false;
    pintarTodo();
    toast(`${ok} tempos sugeridos` + (sin ? ` · ${sin} sin dato` : ''), 'ok');
  }

  const btnTempos = h('button.btn.sm', {
    onclick: () => temposDeLaLista(btnTempos),
    title: 'Busca en internet el BPM de los temas que no lo tienen. No toca los que ya están medidos.',
  }, '⏱ Tempos');

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
    btnCifras,
    btnTempos,
    h('button.btn.sm', { onclick: () => copiar(comoTexto()) }, '📋 Copiar lista'),
    (jam.historica || bloqueada()) ? null
      : h('button.btn.sm', {
          title: 'Congelar la lista para pasarla en vivo',
          onclick: dialogoCerrar,
        }, '🔒 Cerrar jam'),
    h('button.btn.sm', { onclick: () => { const j = store.duplicateJam(jam.id); if (j) { toast('Jam duplicada', 'ok'); location.hash = '#/jams/' + j.id; } } }, '⧉ Duplicar'),
    h('button.btn.sm.danger', { onclick: () => borrarJam(jam) }, 'Borrar'),
  );

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
            h('span.dim', { style: { fontSize: '11.5px' } }, 'arrastrá ⠿ para reordenar')),
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

