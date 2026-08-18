/* ============================================================
   tempo.js — el BPM de un tema: mostrarlo, editarlo, sugerirlo
   ------------------------------------------------------------
   Regla de oro: un tempo escrito a mano nunca se pisa. Lo que
   viene de internet se guarda aparte, marcado como *sugerido*,
   y se muestra distinto (≈ 117 bpm, en gris itálica).
   ============================================================ */

import { store, franjaDeBpm } from './store.js';
import { h, clear, toast } from './ui.js';
import { buscarBpm } from './lookup.js';

/** Guarda un BPM escrito por una persona: pasa a ser dato medido. */
export function fijarBpm(song, bpm) {
  const n = parseInt(bpm, 10);
  if (!n) return store.updateSong(song.id, { bpm: null, franja: null, bpmFuente: '' });
  return store.updateSong(song.id, { bpm: n, franja: franjaDeBpm(n), bpmFuente: '' });
}

/** Guarda un BPM traído de internet, siempre marcado como sugerido. */
export function fijarBpmSugerido(song, bpm) {
  const n = parseInt(bpm, 10);
  if (!n) return store.updateSong(song.id, { bpmFuente: 'sin' });
  return store.updateSong(song.id, { bpm: n, franja: franjaDeBpm(n), bpmFuente: 'sugerido' });
}

/**
 * Si el tema no tiene tempo, lo busca en internet y lo deja como sugerido.
 * No pisa nada: si ya hay BPM cargado, no hace nada.
 * @returns {Promise<number|null>} el bpm que quedó, o null
 */
export async function asegurarTempo(song, { alTerminar } = {}) {
  if (!song || song.bpm) return song ? song.bpm : null;
  const r = await buscarBpm(song.titulo, song.artista);
  const fresco = store.song(song.id);
  if (!fresco || fresco.bpm) return fresco ? fresco.bpm : null;   // lo cargaron mientras tanto
  fijarBpmSugerido(fresco, r ? r.bpm : null);
  alTerminar && alTerminar(store.song(song.id));
  return r ? r.bpm : null;
}

/**
 * Chip de tempo editable: se hace clic y se escribe el valor.
 * El ⏱ vuelve a pedirle una sugerencia a internet.
 */
export function chipTempo(song, onCambio = () => {}) {
  const cont = h('span.tempo', {});

  function pintar() {
    clear(cont);
    const s = store.song(song.id) || song;
    const sug = s.bpmFuente === 'sugerido';

    const etiqueta = h('button.tempo-val' + (sug ? '.sug' : '') + (s.bpm ? '' : '.vacio'), {
      title: s.bpm
        ? (sug ? 'Tempo sugerido (estimado de internet) — clic para corregirlo' : 'Clic para cambiar el tempo')
        : 'Sin tempo — clic para cargarlo',
      onclick: e => { e.stopPropagation(); editar(s); },
    }, s.bpm ? `${sug ? '≈ ' : ''}${s.bpm} bpm` : '— bpm');

    const buscar = h('button.icon-btn.tempo-buscar', {
      title: 'Buscar el tempo en internet (queda como sugerido)',
      onclick: async e => {
        e.stopPropagation();
        buscar.textContent = '…'; buscar.disabled = true;
        const r = await buscarBpm(s.titulo, s.artista);
        if (r) { fijarBpmSugerido(s, r.bpm); toast(`Tempo sugerido para «${s.titulo}»: ${r.bpm} bpm`, 'ok'); }
        else { store.updateSong(s.id, { bpmFuente: 'sin' }); toast('No encontré el tempo de ese tema', 'err'); }
        pintar(); onCambio(store.song(s.id));
      },
    }, '⏱');

    cont.append(etiqueta, buscar);
  }

  function editar(s) {
    clear(cont);
    // si estamos adentro de una fila arrastrable, la soltamos mientras se edita:
    // con draggable=true el input no deja seleccionar el texto
    const fila = cont.closest('[draggable="true"]');
    if (fila) fila.draggable = false;

    const inp = h('input.tempo-input', {
      type: 'number', min: 30, max: 260, value: s.bpm || '', placeholder: 'bpm',
      onclick: e => e.stopPropagation(),
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
        if (e.key === 'Escape') { pintar(); }
      },
      onblur: confirmar,
    });
    function confirmar() {
      if (fila) fila.draggable = true;
      const v = inp.value.trim();
      if (String(s.bpm || '') !== v) {
        fijarBpm(s, v);
        toast(v ? `Tempo de «${s.titulo}»: ${v} bpm` : 'Tempo borrado', 'ok');
      }
      pintar(); onCambio(store.song(s.id));
    }
    cont.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 10);
  }

  pintar();
  return cont;
}
