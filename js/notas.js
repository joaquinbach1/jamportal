/* ============================================================
   notas.js — las notas privadas de cada uno
   ------------------------------------------------------------
   "Entro yo en el segundo estribillo", "afinar medio tono abajo",
   "ojo con el corte del final". Cosas que le sirven a uno solo.

   Viven en el navegador de cada uno, no en la base compartida:
   así son privadas por construcción, sin depender de permisos ni
   de tocar el esquema. El costo es que no te siguen a otro
   dispositivo — son de esta máquina.

   Se guardan por jam y por tema, porque la nota casi siempre es
   sobre cómo se toca ese tema en esa jam.
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

export function notaDe(jamId, songId) {
  const datos = leerTodo();
  return ((datos[dueño()] || {})[jamId] || {})[songId] || '';
}

export function ponerNota(jamId, songId, texto) {
  const datos = leerTodo();
  const mías = datos[dueño()] || (datos[dueño()] = {});
  const deLaJam = mías[jamId] || (mías[jamId] = {});

  const limpio = (texto || '').trim();
  if (limpio) deLaJam[songId] = limpio;
  else delete deLaJam[songId];

  if (!Object.keys(deLaJam).length) delete mías[jamId];
  guardarTodo(datos);
}

/** Cuántas notas tenés puestas en esta jam. */
export function cuantasNotas(jamId) {
  const datos = leerTodo();
  return Object.keys((datos[dueño()] || {})[jamId] || {}).length;
}
