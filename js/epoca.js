/* ============================================================
   epoca.js — de qué década es cada tema
   ------------------------------------------------------------
   El repertorio venía sin año: se rellena desde internet con el
   mismo camino que el tempo. iTunes acierta la década en la
   enorme mayoría, pero a veces devuelve la fecha de una
   reedición —"Necesito" de Sui Generis vuelve como 1987 y es del
   73—, así que el año se puede corregir a mano en la ficha.
   ============================================================ */

import { buscarEnWeb } from './lookup.js';
import { store } from './store.js';

const ESTE_ANIO = new Date().getFullYear();

export const EPOCAS = [
  { clave: '', etiqueta: 'Todas' },
  { clave: '70', etiqueta: "70s", desde: 1970, hasta: 1979 },
  { clave: '80', etiqueta: "80s", desde: 1980, hasta: 1989 },
  { clave: '90', etiqueta: "90s", desde: 1990, hasta: 1999 },
  { clave: '00', etiqueta: '2000s', desde: 2000, hasta: 2009 },
  { clave: '10', etiqueta: '2010s', desde: 2010, hasta: 2019 },
  { clave: '20', etiqueta: '2020s', desde: 2020, hasta: 2029 },
  { clave: 'actual', etiqueta: 'Actual', desde: ESTE_ANIO - 4, hasta: ESTE_ANIO + 1 },
];

const porClave = clave => EPOCAS.find(e => e.clave === clave);

/** ¿El tema cae en esa época? Sin año, no entra en ninguna en particular. */
export function esDeLaEpoca(song, clave) {
  if (!clave) return true;
  const e = porClave(clave);
  const a = parseInt(song && song.anio, 10);
  if (!e || !Number.isFinite(a)) return false;
  return a >= e.desde && a <= e.hasta;
}

/** Cómo se muestra: "80s", "2010s"… */
export function etiquetaDe(anio) {
  const a = parseInt(anio, 10);
  if (!Number.isFinite(a)) return '';
  if (a >= 2000) return `${Math.floor(a / 10) * 10}s`;
  return `${String(Math.floor(a / 10) * 10).slice(2)}s`;
}

/** Busca el año en internet y lo guarda. Devuelve el año o null. */
export async function asegurarAnio(song) {
  if (!song) return null;
  const fresco = store.song(song.id) || song;
  if (fresco.anio) return fresco.anio;

  let anio = null;
  try {
    const r = await buscarEnWeb(`${fresco.titulo} ${fresco.artista}`);
    const bueno = r.find(x => x.anio);
    if (bueno) anio = parseInt(bueno.anio, 10) || null;
  } catch { /* sin internet o sin resultado: queda sin año */ }

  store.updateSong(fresco.id, anio ? { anio } : { anioFuente: 'sin' });
  return anio;
}
