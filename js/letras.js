/* ============================================================
   letras.js — la letra de un tema, para leerla en el escenario
   ------------------------------------------------------------
   Se prueban dos bases, las dos gratis, sin clave y consultables
   desde el navegador:

     1) lrclib.net    — la que más sabe de repertorio en castellano,
                        y muchas veces trae la letra con tiempos.
     2) api.lyrics.ovh — la segunda opinión, buena con lo internacional.

   Entre las dos cubren casi todo; lo que queda afuera es sobre todo
   cumbia y tropical, y ahí ofrecemos buscarla a mano.

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

const sirve = t => (t || '').trim().length > 40;   // los muy cortos son basura

/**
 * ¿Esto parece una letra? Muchos renglones, y cortos. Sirve para no
 * tragarse el JSON de una API o el menú de una página cualquiera.
 */
function pareceLetra(t) {
  const renglones = (t || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (renglones.length < 6) return false;
  const largoPromedio = renglones.reduce((a, l) => a + l.length, 0) / renglones.length;
  return largoPromedio < 90;
}

async function pedirLrclib(artista, titulo) {
  const r = await fetch('https://lrclib.net/api/get'
    + `?artist_name=${encodeURIComponent(artista)}&track_name=${encodeURIComponent(titulo)}`);
  if (!r.ok) return null;
  const j = await r.json();
  const texto = (j.plainLyrics || '').replace(/\r/g, '').trim();
  return sirve(texto) ? texto : null;
}

async function pedirOvh(artista, titulo) {
  const r = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artista)}/${encodeURIComponent(titulo)}`);
  if (!r.ok) return null;
  const j = await r.json();
  const texto = (j.lyrics || '').replace(/\r/g, '').trim();
  return sirve(texto) ? texto : null;
}

/**
 * Busca la letra probando combinaciones hasta que una pegue.
 * Devuelve { ok, texto } o { ok: false }.
 */
export async function buscarLetra(song) {
  if (!song) return { ok: false };
  const clave = `${song.artista}|${song.titulo}`;
  if (cache.has(clave)) return cache.get(clave);

  /* Si la pegaste a mano, esa es la buena y no hay nada que buscar. */
  if (sirve(song.letra)) {
    const propia = { ok: true, texto: song.letra.trim() };
    cache.set(clave, propia);
    return propia;
  }

  /* Si le pegaste una URL, va antes que las bases. */
  if (song.letraUrl) {
    const propia = await letraDesdeUrl(song.letraUrl);
    if (propia.ok) { cache.set(clave, propia); return propia; }
  }

  const artistas = variantesArtista(song.artista);
  const titulos = variantesTitulo(song.titulo);

  let res = { ok: false };
  /* Primero la combinación más fiel en las dos bases, después las
     variantes: mejor la fuente buena con el nombre raro que la
     fuente floja con el nombre exacto. */
  buscar:
  for (const pedir of [pedirLrclib, pedirOvh]) {
    for (const a of artistas) {
      for (const t of titulos) {
        try {
          const texto = await pedir(a, t);
          if (texto) { res = { ok: true, texto }; break buscar; }
        } catch { /* red caída o CORS: seguimos probando */ }
      }
    }
  }

  cache.set(clave, res);
  return res;
}

/* ============================================================
   Letra puesta a mano
   ------------------------------------------------------------
   Cuando ninguna base la tiene, podés pegar la URL de la letra.
   Intentamos leerla: muchos sitios no dejan que otra página los
   lea (el navegador lo bloquea), así que si no se puede, al menos
   guardamos el link y queda a un clic para abrirlo.
   ============================================================ */

/** Saca el texto de una página HTML, quedándose con el bloque más largo. */
function textoDeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, nav, header, footer, noscript').forEach(n => n.remove());

  let mejor = '';
  for (const el of doc.querySelectorAll('div, article, section, pre, p')) {
    const t = (el.innerText || el.textContent || '').replace(/\r/g, '').trim();
    // una letra tiene muchos renglones cortos: eso la distingue del resto
    const renglones = t.split('\n').filter(l => l.trim()).length;
    if (renglones >= 8 && t.length > mejor.length) mejor = t;
  }
  return mejor.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Trae la letra desde una URL que pegaste vos.
 * Devuelve { ok, texto } si se pudo leer, o { ok: false, motivo }.
 */
export async function letraDesdeUrl(url) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, motivo: 'Eso no parece una dirección web.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, motivo: 'La dirección tiene que empezar con http o https.' };

  try {
    const r = await fetch(u.href);
    if (!r.ok) return { ok: false, motivo: `La página contestó ${r.status}.` };
    const html = await r.text();
    const texto = /<\/?[a-z][\s\S]*>/i.test(html) ? textoDeHtml(html) : html.trim();
    if (!sirve(texto) || !pareceLetra(texto)) {
      return { ok: false, motivo: 'Pude abrirla, pero lo que hay adentro no parece una letra.' };
    }
    return { ok: true, texto };
  } catch {
    return { ok: false, motivo: 'Ese sitio no deja que otra página lo lea.' };
  }
}

/** Para que la letra pegada a mano se use en lugar de buscarla de nuevo. */
export function guardarEnCache(song, texto) {
  cache.set(`${song.artista}|${song.titulo}`, { ok: true, texto });
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
