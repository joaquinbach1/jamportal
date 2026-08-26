/* ============================================================
   lookup.js — autocompletado desde internet
   ------------------------------------------------------------
   Usa la iTunes Search API vía JSONP (no necesita clave ni
   servidor propio, y esquiva CORS desde un sitio estático).
   Devuelve: título, artista, género, año y duración.
   MusicBrainz queda como respaldo si iTunes no responde.
   ============================================================ */

import { store, norm } from './store.js';

let jsonpSeq = 0;

function jsonp(url, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const cb = '__jamportal_cb_' + (++jsonpSeq);
    const script = document.createElement('script');

    // Ojo: no borramos window[cb] al cerrar. Si la respuesta llega tarde (después
    // del timeout) el script igual va a invocarlo, y si no existe tira un
    // ReferenceError suelto. Lo dejamos como función vacía y lo limpiamos después.
    const limpiar = () => {
      window[cb] = () => {};
      setTimeout(() => { delete window[cb]; }, 30000);
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { limpiar(); reject(new Error('timeout')); }, timeoutMs);

    window[cb] = data => { limpiar(); resolve(data); };
    script.onerror = () => { limpiar(); reject(new Error('error de red')); };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(script);
  });
}

/* ---------- iTunes ---------- */
async function buscarItunes(q, limit = 8) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=${limit}`;
  const data = await jsonp(url);
  const vistos = new Set();
  return (data.results || [])
    .map(r => ({
      titulo: (r.trackName || '').replace(/\s*\((feat|ft)\.[^)]*\)/i, '').trim(),
      artista: r.artistName || '',
      genero: r.primaryGenreName || '',
      anio: r.releaseDate ? r.releaseDate.slice(0, 4) : '',
      duracionSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
      album: r.collectionName || '',
      artwork: r.artworkUrl100 || '',
      fuente: 'itunes',
    }))
    .filter(r => {
      if (!r.titulo) return false;
      const k = norm(r.titulo) + '|' + norm(r.artista);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
}

/* ---------- MusicBrainz (respaldo) ---------- */
async function buscarMusicBrainz(q, limit = 6) {
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&limit=${limit}&fmt=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('musicbrainz ' + res.status);
  const data = await res.json();
  return (data.recordings || []).map(r => ({
    titulo: r.title || '',
    artista: (r['artist-credit'] || []).map(a => a.name).join(', '),
    genero: (r.tags || []).sort((a, b) => b.count - a.count)[0]?.name || '',
    anio: (r['first-release-date'] || '').slice(0, 4),
    duracionSec: r.length ? Math.round(r.length / 1000) : null,
    album: r.releases?.[0]?.title || '',
    artwork: '',
    fuente: 'musicbrainz',
  })).filter(r => r.titulo);
}

/** Busca un tema en internet. Nunca lanza: si falla, devuelve []. */
export async function buscarEnWeb(q) {
  try {
    const r = await buscarItunes(q);
    if (r.length) return r;
  } catch (e) { console.warn('iTunes no respondió:', e.message); }
  try {
    return await buscarMusicBrainz(q);
  } catch (e) { console.warn('MusicBrainz no respondió:', e.message); return []; }
}

/* ============================================================
   Mapeo de un resultado web al esquema de DBSongs
   ============================================================ */

const GEN_LATINO = /latin|reggaet|salsa|bachata|merengue|bolero|ranchera|mariachi|flamenco|tango/i;
const GEN_TROPICAL = /cumbia|tropical|cuarteto|vallenato/i;

/** Adivina la categoría del repertorio a partir del género y del artista. */
export function sugerirCategoria(genero = '', artista = '') {
  // 1) si el artista ya está en DBSongs, usar su misma categoría
  const na = norm(artista);
  if (na) {
    const existente = store.songs.find(s => norm(s.artista) === na);
    if (existente) return existente.categoria;
  }
  const cats = store.categorias;
  const pick = re => cats.find(c => re.test(c));
  if (GEN_TROPICAL.test(genero)) return pick(/cumbia|tropical/i) || cats[0];
  if (GEN_LATINO.test(genero))   return pick(/latino|espa/i) || cats[0];
  return pick(/internacional/i) || cats[0];
}

/**
 * Trae los temas más conocidos de un artista (para descubrir repertorio nuevo).
 * Nunca lanza: si falla, devuelve [].
 */
export async function temasDeArtista(artista, limit = 12) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artista)}&entity=song&attribute=artistTerm&limit=${limit}`;
    const data = await jsonp(url);
    const vistos = new Set();
    return (data.results || [])
      .map(r => ({
        titulo: (r.trackName || '').replace(/\s*[([](feat|ft|with|remaster|live|version|edit)[^)\]]*[)\]]/gi, '').trim(),
        artista: r.artistName || artista,
        genero: r.primaryGenreName || '',
        anio: r.releaseDate ? r.releaseDate.slice(0, 4) : '',
        duracionSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
        fuente: 'itunes',
      }))
      .filter(r => {
        const k = norm(r.titulo);
        if (!k || vistos.has(k)) return false;
        if (k === norm(artista)) return false;                       // el disco homónimo
        if (/\b(remix|live|en vivo|karaoke|instrumental|version|mix)\b/i.test(r.titulo)) return false;
        vistos.add(k);
        return true;
      });
  } catch (e) {
    console.warn('temasDeArtista falló para', artista, e.message);
    return [];
  }
}

/* ============================================================
   BPM sugerido (Deezer)
   ------------------------------------------------------------
   Deezer publica el BPM de muchos temas y acepta JSONP, así que
   se puede consultar desde un sitio estático. Ojo: es un dato
   estimado y a veces cae en una versión distinta (vivo, remix),
   por eso lo guardamos siempre como SUGERIDO y jamás pisamos un
   BPM medido a mano.
   ============================================================ */

const RE_VERSION_RARA = /\b(live|en vivo|remix|karaoke|cover|instrumental|acoustic|acustic|tribute|remaster)\b/i;

/**
 * Busca el BPM de un tema.
 * @returns {Promise<{bpm:number, fuente:string, titulo:string, artista:string}|null>}
 */
export async function buscarBpm(titulo, artista) {
  const t = (titulo || '').replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || titulo || '';
  const nt = norm(t);
  if (!nt) return null;

  const variantes = (artista || '').split(/\s*[/&]\s*/).map(x => norm(x)).filter(Boolean);
  const coincideArtista = a => !variantes.length ||
    variantes.some(v => a === v || a.includes(v) || v.includes(a));

  try {
    const busq = await jsonp(
      `https://api.deezer.com/search?q=${encodeURIComponent(`${t} ${artista || ''}`.trim())}&limit=8&output=jsonp`);

    for (const tr of busq.data || []) {
      const na = norm(tr.artist?.name || '');
      const ntt = norm((tr.title || '').replace(/\s*[([][^)\]]*[)\]]/g, ''));
      if (!coincideArtista(na)) continue;
      if (!(ntt === nt || ntt.includes(nt) || nt.includes(ntt))) continue;
      if (RE_VERSION_RARA.test(tr.title || '')) continue;      // vivos y remixes miden distinto

      const det = await jsonp(`https://api.deezer.com/track/${tr.id}?output=jsonp`);
      const bpm = Math.round(det.bpm || 0);
      if (bpm >= 40 && bpm <= 260) {
        return { bpm, fuente: 'deezer', titulo: tr.title, artista: tr.artist?.name || '' };
      }
    }
  } catch (e) {
    console.warn('BPM no disponible para', titulo, e.message);
  }
  return null;
}

/** Convierte un resultado web en los campos de una canción de DBSongs. */
export function webAResultado(r) {
  return {
    titulo: r.titulo,
    artista: r.artista,
    categoria: sugerirCategoria(r.genero, r.artista),
    bpm: null,
    franja: null,
    generoWeb: r.genero || '',
    anio: r.anio || '',
    duracionSec: r.duracionSec || null,
    origen: 'web:' + r.fuente,
  };
}
