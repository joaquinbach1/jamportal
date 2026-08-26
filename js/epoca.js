/* ============================================================
   epoca.js — de qué década es cada tema
   ------------------------------------------------------------
   Los años del repertorio ya vienen puestos (los trajo de iTunes
   scripts/traer-anios.py). Los que falten o estén mal se cargan a
   mano en la ficha del tema: iTunes a veces devuelve la fecha de
   una reedición y el año se corre un par de años.
   ============================================================ */

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
