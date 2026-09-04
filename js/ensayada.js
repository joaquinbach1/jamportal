/* ============================================================
   ensayada.js — cómo viene cada tema para esta jam
   ------------------------------------------------------------
   Tres estados, no dos. «Ya está» y «todavía no» no alcanzan
   para organizar un ensayo: lo que decide a qué darle tiempo es
   justo el del medio, el tema que se tocó y no sale.

   Va en el ítem del setlist y no en el tema: es cómo viene para
   ESTA jam. La próxima arranca en blanco, que es como funciona
   un ensayo.
   ============================================================ */

export const ESTADOS = [
  { clave: 'no',    label: 'No tocado', corto: '—',  hint: 'todavía no lo tocamos' },
  { clave: 'falta', label: 'Le falta',  corto: '~',  hint: 'lo tocamos, no está' },
  { clave: 'listo', label: 'Listo',     corto: '✓',  hint: 'sale' },
];

/* Cuántas pasadas pide cada estado. El rango que se usa en la banda
   es 2 o 3 sin cantante y 1 o 2 con: lo que decide dónde caer dentro
   del rango es cómo viene el tema, así que sale de acá. */
export const PASADAS = {
  no:    { sin: 3, con: 2 },
  falta: { sin: 2, con: 1 },
  listo: { sin: 0, con: 1 },   // un repaso y nada más
};

/** El estado de un ítem, tolerando lo que haya: viejo booleano o nada. */
export function estadoDe(it) {
  const v = it && it.ensayada;
  if (v === true) return 'listo';               // como lo guardaba db/25
  return ESTADOS.some(e => e.clave === v) ? v : 'no';
}

export const estaListo = it => estadoDe(it) === 'listo';

/** El que sigue al tocar: no → falta → listo → no. */
export function siguienteEstado(actual) {
  const i = ESTADOS.findIndex(e => e.clave === actual);
  return ESTADOS[(i + 1) % ESTADOS.length].clave;
}

export const etiquetaDe = clave =>
  (ESTADOS.find(e => e.clave === clave) || ESTADOS[0]).label;
