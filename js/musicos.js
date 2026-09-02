/* ============================================================
   musicos.js — la banda, puesto por puesto
   ------------------------------------------------------------
   Quién toca qué en cada tema. Vive acá y no en la vista porque
   lo leen cuatro lugares —el editor, el medley, el LIVE VIEW y
   la lista del celular— y tenerlo copiado en cada uno ya se
   demostró frágil: cada vez que se sumaba un campo había que
   acordarse de los cuatro.

   Cada puesto arranca con su titular puesto: es quien toca casi
   siempre, y escribirlo tema por tema era el 90% de los clics.
   Después ofrece a los suplentes de ESE puesto —no la banda
   entera— más "Invitado", para el que cae esa noche.

   Se guarda en el ítem de la lista y no en el tema: quién agarra
   qué es cosa de esta jam, no del tema para siempre.
   ============================================================ */

import { iconoBajo } from './ui.js';

/* El bajo no tiene emoji —Unicode tiene guitarra, banjo y violín,
   nada de cuatro cuerdas—, así que se dibuja. */
const BAJO = '@bajo';

export const PUESTOS = [
  { clave: 'g1',   label: 'G1',   ico: '🎸', titular: 'Tomi',  solo: true, gente: ['Tomi', 'Nano', 'Peter', 'Ale'] },
  { clave: 'g2',   label: 'G2',   ico: '🎸', titular: 'Nano',  solo: true, gente: ['Tomi', 'Nano', 'Peter', 'Ale'] },
  { clave: 'bajo', label: 'Bajo', ico: BAJO, titular: 'Nahue',             gente: ['Nahue'] },
  { clave: 'bat',  label: 'Bat',  ico: '🥁', titular: 'Joaco',             gente: ['Joaco', 'Fede', 'Fabo'] },
  { clave: 't1',   label: 'T1',   ico: '🎹', titular: 'Mati',              gente: ['Mati'] },
  { clave: 't2',   label: 'T2',   ico: '🎹', titular: 'Alva',              gente: ['Alva'] },
  { clave: 'saxo', label: 'Saxo', ico: '🎷', titular: 'Fede',              gente: ['Fede'] },
];

export const INVITADO = 'Invitado';

/** El emoji del puesto, o el bajo dibujado. */
export const iconoDe = p => (p.ico === BAJO ? iconoBajo() : p.ico);

/** La formación de arranque: cada puesto con su titular. */
export function formacionPorDefecto() {
  const m = {};
  for (const p of PUESTOS) m[p.clave] = { nombre: p.titular, solo: false };
  return m;
}

/**
 * Los músicos de un tema, creándolos la primera vez. Una vez que el
 * tema tiene su formación se respeta tal cual: si alguien dejó un
 * puesto vacío a propósito, no se lo volvemos a llenar.
 */
export function musicosDe(it) {
  if (!it.musicos) {
    it.musicos = formacionPorDefecto();
    /* Lo que se cargó cuando esto eran dos guitarras nomás entra en
       G1 y G2, con su solo puesto. */
    if (Array.isArray(it.guitarras)) {
      it.guitarras.slice(0, 2).forEach((g, n) => {
        if (g) it.musicos[PUESTOS[n].clave] = { nombre: g.nombre || '', solo: !!g.solo };
      });
    }
    delete it.guitarras;
  }
  for (const p of PUESTOS) {
    if (!it.musicos[p.clave]) it.musicos[p.clave] = { nombre: p.titular, solo: false };
  }
  return it.musicos;
}

/** Los puestos con alguien puesto, para las vistas que solo leen. */
export const puestosOcupados = m =>
  (m ? PUESTOS.filter(p => m[p.clave] && m[p.clave].nombre) : []);
