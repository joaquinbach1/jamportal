/* ============================================================
   notas.js — las notas privadas de cada uno
   ------------------------------------------------------------
   "Entro yo en el segundo estribillo", "afinar medio tono abajo".
   Cosas que le sirven a uno solo, y que nadie más ve.

   Viven en la base, en una tabla donde cada fila lleva el email
   de su dueño y la policy solo te deja tocar las tuyas. El email
   lo pone la base leyéndolo del JWT, no el cliente: por eso son
   privadas de verdad y no por buena voluntad del navegador.

   Además quedan copiadas en este navegador. Eso hace dos cosas:
   se leen al toque cuando dibujamos (sin esperar a la red) y el
   LIVE VIEW sigue mostrándolas sin señal, que es justo donde más
   falta hacen.
   ============================================================ */

import { store } from './store.js';

const CLAVE = 'jamportal.notas';

/** Con login, las notas van por cuenta: dos personas, una máquina. */
const dueño = () => (store.email || 'local').toLowerCase();

function leerTodo() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); }
  catch { return {}; }
}

function guardarTodo(datos) {
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)); }
  catch { /* sin espacio: no es motivo para romper nada */ }
}

/* ---------- lectura, siempre sincrónica ---------- */

export function notaDe(jamId, songId) {
  const datos = leerTodo();
  return ((datos[dueño()] || {})[jamId] || {})[songId] || '';
}

export function cuantasNotas(jamId) {
  const datos = leerTodo();
  return Object.keys((datos[dueño()] || {})[jamId] || {}).length;
}

/* ---------- escritura ---------- */

export function ponerNota(jamId, songId, texto) {
  const datos = leerTodo();
  const mías = datos[dueño()] || (datos[dueño()] = {});
  const deLaJam = mías[jamId] || (mías[jamId] = {});

  const limpio = (texto || '').trim();
  if (limpio) deLaJam[songId] = limpio;
  else delete deLaJam[songId];

  if (!Object.keys(deLaJam).length) delete mías[jamId];
  guardarTodo(datos);

  /* a la base, si hay. Si falla, la nota igual quedó acá: no la
     perdés por un problema de red. */
  const d = store.driver;
  if (d && d.guardarNota) {
    d.guardarNota(jamId, songId, limpio).catch(e => {
      console.warn('No pude guardar la nota en la base:', e.message);
    });
  }
}

/* ---------- traerlas al entrar ---------- */

/**
 * Baja las notas propias y las deja listas para leer. Si la base
 * todavía no tiene la tabla (falta correr db/12-notas.sql), sigue
 * andando con las de este navegador y no molesta a nadie.
 */
export async function cargarNotas() {
  const d = store.driver;
  if (!d || !d.misNotas) return { origen: 'navegador' };

  try {
    const remotas = await d.misNotas();
    if (!remotas || typeof remotas !== 'object') return { origen: 'navegador' };

    const datos = leerTodo();
    const locales = datos[dueño()] || {};

    /* Lo de la base manda, pero no se pierde lo que hayas escrito acá
       y todavía no haya subido (una nota puesta sin señal). */
    const unidas = { ...locales };
    for (const [jamId, temas] of Object.entries(remotas)) {
      unidas[jamId] = { ...(locales[jamId] || {}), ...temas };
    }

    datos[dueño()] = unidas;
    guardarTodo(datos);
    return { origen: 'base', jams: Object.keys(remotas).length };
  } catch (e) {
    console.warn('No pude traer las notas de la base:', e.message);
    return { origen: 'navegador', error: e.message };
  }
}
