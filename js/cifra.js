/* ============================================================
   cifra.js — links a Cifra Club (acordes / partituras)
   ------------------------------------------------------------
   Cifra Club expone su buscador en solr.sscdn.co con CORS
   abierto, así que se puede consultar desde el navegador.
   La respuesta viene envuelta en paréntesis: `({...})`.

   Cada resultado trae:
     m = título · a = artista · d = slug de artista · u = slug del tema
   y la página es https://www.cifraclub.com/{d}/{u}/
   ============================================================ */

import { norm } from './store.js';

const API = 'https://solr.sscdn.co/cc/h2/';
const cache = new Map();

/** Saca aclaraciones entre paréntesis: "(tocan la vers. HIM)", "(feat. X)". */
function limpiarTitulo(t) {
  return (t || '').replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || t || '';
}

/** "Pappo / Riff / Pappo's Blues" → ["Pappo / Riff…", "Pappo", "Riff", …] */
function variantesArtista(a) {
  const partes = (a || '').split(/\s*[/&]\s*|\s+ft\.?\s+|\s+feat\.?\s+/i)
    .map(s => s.trim())
    .filter(s => s && !['tropical', 'cumbia', 'cuarteto'].includes(s.toLowerCase()));
  const todas = [a, ...partes];
  const vistos = new Set();
  return todas.filter(v => {
    const n = norm(v);
    if (!n || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

async function consultar(q, limit = 12) {
  if (cache.has(q)) return cache.get(q);
  const res = await fetch(`${API}?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) throw new Error('cifraclub ' + res.status);
  let texto = (await res.text()).trim();
  if (texto.startsWith('(')) texto = texto.slice(1, -1);      // desenvolver
  const docs = (JSON.parse(texto).response?.docs || [])
    .filter(d => d.t === '2' && d.d && d.u);                   // t=2 → cifra de un tema
  cache.set(q, docs);
  return docs;
}

function artistaCoincide(deCifra, variantes) {
  const n = norm(deCifra);
  return variantes.some(v => {
    const nv = norm(v);
    return nv && (n === nv || n.includes(nv) || nv.includes(n));
  });
}

/**
 * Busca la cifra de un tema.
 * @returns {Promise<{url, artista, confianza:'alta'|'media'}|null>}
 *          'media' = el título coincide pero la cifra es de otro artista (cover).
 */
export async function buscarCifra(titulo, artista) {
  const t = limpiarTitulo(titulo);
  const nt = norm(t);
  if (!nt) return null;
  const vars = variantesArtista(artista);

  const consultas = [...vars.slice(0, 3).map(v => `${t} ${v}`), t];

  for (const q of consultas) {
    let docs;
    try { docs = await consultar(q); } catch { continue; }

    // 1) título exacto + artista coincidente
    const exacta = docs.find(d => norm(d.m) === nt && artistaCoincide(d.a, vars));
    if (exacta) return armar(exacta, 'alta');

    // 2) artista coincidente y título contenido (versiones, "solo", etc.)
    const parcial = docs.find(d => artistaCoincide(d.a, vars) && (nt.includes(norm(d.m)) || norm(d.m).includes(nt)));
    if (parcial) return armar(parcial, 'alta');
  }

  // 3) último recurso: título exacto de otro artista → se marca como dudosa
  try {
    const docs = await consultar(t);
    const cover = docs.find(d => norm(d.m) === nt);
    if (cover) return armar(cover, 'media');
  } catch { /* sin red */ }

  return null;
}

function armar(d, confianza) {
  return { url: `https://www.cifraclub.com/${d.d}/${d.u}/`, artista: d.a, confianza };
}

/** Link de búsqueda manual, para cuando no encontramos nada. */
export function urlBusqueda(titulo, artista) {
  return 'https://www.cifraclub.com/?q=' + encodeURIComponent(`${titulo} ${artista || ''}`.trim());
}
