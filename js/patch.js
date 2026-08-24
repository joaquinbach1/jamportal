/* ============================================================
   patch.js — el patch de teclados, editable desde la lista
   ------------------------------------------------------------
   Mismo trato que el tempo: un chip que se edita en el lugar, sin
   abrir la ficha del tema. El patch es del tema, no de la jam, así
   que una vez cargado aparece en todas.
   ============================================================ */

import { store } from './store.js';
import { h, clear, toast } from './ui.js';

const comoTexto = patches => (patches || []).filter(Boolean).join(', ');
const comoLista = txt => txt.split(',').map(s => s.trim()).filter(Boolean);

export function chipPatch(song, onCambio = () => {}) {
  const cont = h('span.patch', {});

  function pintar() {
    clear(cont);
    const s = store.song(song.id) || song;
    const puestos = (s.patches || []).filter(Boolean);

    cont.appendChild(h('button.patch-val' + (puestos.length ? '' : '.vacio'), {
      title: puestos.length
        ? `Patch de teclado: ${comoTexto(puestos)} — clic para cambiarlo`
        : 'Sin patch de teclado — clic para cargarlo',
      onclick: e => { e.stopPropagation(); editar(s); },
    }, puestos.length ? '🎹 ' + puestos.join(' · ') : '🎹'));
  }

  function editar(s) {
    clear(cont);
    /* con la fila arrastrable el input no deja seleccionar el texto */
    const fila = cont.closest('[draggable="true"]');
    if (fila) fila.draggable = false;

    const inp = h('input.patch-input', {
      type: 'text',
      value: comoTexto(s.patches),
      placeholder: 'a13, g52…',
      onclick: e => e.stopPropagation(),
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
        if (e.key === 'Escape') { cancelado = true; pintar(); }
      },
      onblur: () => { if (!cancelado) confirmar(); },
    });

    let cancelado = false;
    function confirmar() {
      if (fila) fila.draggable = true;
      const nuevos = comoLista(inp.value);
      if (comoTexto(s.patches) !== comoTexto(nuevos)) {
        store.updateSong(s.id, { patches: nuevos });
        toast(nuevos.length ? `Patch de «${s.titulo}»: ${nuevos.join(', ')}` : 'Patch borrado', 'ok');
      }
      pintar();
      onCambio(store.song(s.id));
    }

    cont.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 10);
  }

  pintar();
  return cont;
}
