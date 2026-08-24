/* ============================================================
   compartir.js — la jam entera adentro de un link
   ------------------------------------------------------------
   El link de letras no consulta nada: lleva el setlist y las
   letras comprimidos en el propio hash. Por eso se abre sin
   cuenta, sin permisos y sin internet — el hash ni siquiera
   viaja al servidor.

   Una jam de 39 temas con todas sus letras son unos 60 KB, que
   comprimidos y en base64 quedan en 21 KB. Entra cómodo.
   ============================================================ */

const CRUDO = 'application/octet-stream';

/* base64 normal usa + / = , que en una URL molestan */
const aB64Url = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const deB64Url = txt => {
  const s = atob(txt.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function comprimir(texto) {
  const stream = new Blob([texto], { type: CRUDO }).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function descomprimir(bytes) {
  const stream = new Blob([bytes], { type: CRUDO }).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export const sePuedeComprimir = () =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Del objeto al pedazo de URL. */
export async function empaquetar(datos) {
  return aB64Url(await comprimir(JSON.stringify(datos)));
}

/** Y de vuelta. Devuelve null si el link vino cortado o pisado. */
export async function desempaquetar(txt) {
  try {
    return JSON.parse(await descomprimir(deB64Url(txt)));
  } catch {
    return null;
  }
}

/** El link completo, listo para mandar. */
export function linkDeLetras(paquete) {
  const base = location.href.split('#')[0];
  return `${base}#/l/${paquete}`;
}
