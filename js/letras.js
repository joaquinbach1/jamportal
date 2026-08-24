/* ============================================================
   letras.js — la letra de un tema, para leerla en el escenario
   ------------------------------------------------------------
   Sale de api.lyrics.ovh, que es gratis, no pide clave y deja
   consultarla desde el navegador. No tiene todo: anda muy bien
   con el repertorio internacional y flojea con cumbia y tropical.
   Cuando no encuentra, ofrecemos buscarla a mano.

   La letra no se guarda en la base: vive en memoria mientras
   tengas la pestaña abierta. Es material de otros, y la base es
   para lo nuestro.
   ============================================================ */

const cache = new Map();          // 'artista|titulo' → { ok, texto } 

const sinAcentos = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Distintas formas de escribir el mismo título, de la más fiel a la más suelta. */
function variantesTitulo(titulo) {
  const t = (titulo || '').trim();
  const out = [t];

  const sinParentesis = t.replace(/\s*[([].*?[)\]]\s*$/, '').trim();
  if (sinParentesis && sinParentesis !== t) out.push(sinParentesis);

  // "Ji Ji Ji" → "Jijiji": la misma palabra repetida suele ir pegada
  for (const base of [t, sinParentesis]) {
    const tokens = base.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every(x => x.toLowerCase() === tokens[0].toLowerCase())) {
      out.push(tokens[0] + tokens.slice(1).map(x => x.toLowerCase()).join(''));
    }
  }

  const sinFeat = t.replace(/\s*(feat\.?|ft\.?|con)\s+.*$/i, '').trim();
  if (sinFeat && sinFeat !== t) out.push(sinFeat);

  return [...new Set([...out, ...out.map(sinAcentos)])].filter(Boolean);
}

/** Y del artista: a veces viene con ruido ("Kaoma / tropical"). */
function variantesArtista(artista) {
  const a = (artista || '').trim();
  const out = [a];
  const antesDeBarra = a.split('/')[0].trim();
  if (antesDeBarra && antesDeBarra !== a) out.push(antesDeBarra);
  const sinFeat = a.replace(/\s*(feat\.?|ft\.?)\s+.*$/i, '').trim();
  if (sinFeat && sinFeat !== a) out.push(sinFeat);
  return [...new Set([...out, ...out.map(sinAcentos)])].filter(Boolean);
}

async function pedir(artista, titulo) {
  const r = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artista)}/${encodeURIComponent(titulo)}`);
  if (!r.ok) return null;
  const j = await r.json();
  const texto = (j.lyrics || '').replace(/\r/g, '').trim();
  return texto.length > 40 ? texto : null;      // los muy cortos son basura
}

/**
 * Busca la letra probando combinaciones hasta que una pegue.
 * Devuelve { ok, texto } o { ok: false }.
 */
export async function buscarLetra(song) {
  if (!song) return { ok: false };
  const clave = `${song.artista}|${song.titulo}`;
  if (cache.has(clave)) return cache.get(clave);

  const artistas = variantesArtista(song.artista);
  const titulos = variantesTitulo(song.titulo);

  let res = { ok: false };
  buscar:
  for (const a of artistas) {
    for (const t of titulos) {
      try {
        const texto = await pedir(a, t);
        if (texto) { res = { ok: true, texto }; break buscar; }
      } catch { /* red caída o CORS: seguimos probando */ }
    }
  }

  cache.set(clave, res);
  return res;
}

/** Si no aparece, al menos dejamos el buscador abierto en el tema. */
export function urlBusquedaLetra(song) {
  const q = encodeURIComponent(`${song.titulo} ${song.artista} letra`);
  return `https://www.google.com/search?q=${q}`;
}

/** Para pre-cargar mientras mirás otra: no molesta si falla. */
export function precargar(song) {
  if (!song) return;
  const clave = `${song.artista}|${song.titulo}`;
  if (!cache.has(clave)) buscarLetra(song).catch(() => {});
}
