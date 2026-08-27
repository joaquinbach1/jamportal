/* ============================================================
   album.js — de qué disco es cada tema, y su tapa
   ------------------------------------------------------------
   Sale de la misma búsqueda de iTunes que ya usamos para el año:
   la respuesta trae el nombre del álbum y la URL de la portada,
   solo que las estábamos tirando.

   La tapa no se guarda como imagen: guardamos el link al servidor
   de Apple. Ocupa nada y siempre está actualizada; el costo es que
   sin internet no se ve.
   ============================================================ */

import { buscarEnWeb, portadaGrande } from './lookup.js';
import { store, norm } from './store.js';

/**
 * Completa álbum y tapa de un tema. No pisa lo que ya esté cargado.
 * Devuelve el tema actualizado, o null si no encontró nada.
 */
export async function asegurarAlbum(song) {
  if (!song) return null;
  const fresco = store.song(song.id) || song;
  if (fresco.album && fresco.cover) return fresco;

  try {
    const res = await buscarEnWeb(`${fresco.titulo} ${fresco.artista}`);
    const nt = norm(fresco.titulo), na = norm(fresco.artista);

    /* el mismo título y, si sabemos el artista, que coincida */
    const bueno = res.find(r => norm(r.titulo) === nt && (!na || norm(r.artista).includes(na) || na.includes(norm(r.artista))))
      || res.find(r => norm(r.titulo) === nt);
    if (!bueno) { store.updateSong(fresco.id, { albumFuente: 'sin' }); return null; }

    const patch = {};
    if (!fresco.album && bueno.album) patch.album = bueno.album;
    if (!fresco.albumId && bueno.albumId) patch.albumId = bueno.albumId;
    if (!fresco.cover && bueno.artwork) patch.cover = portadaGrande(bueno.artwork);
    if (!Object.keys(patch).length) { store.updateSong(fresco.id, { albumFuente: 'sin' }); return null; }

    store.updateSong(fresco.id, patch);
    return store.song(fresco.id);
  } catch {
    return null;
  }
}

/**
 * Agrupa temas por artista y álbum, para verlos como discos.
 * Los que no tienen álbum caen juntos en uno "sin disco".
 */
export function porAlbum(songs) {
  const mapa = new Map();
  for (const s of songs) {
    const clave = norm(s.artista) + '|' + norm(s.album);
    if (!mapa.has(clave)) {
      mapa.set(clave, { artista: s.artista || 'Sin artista', album: s.album || '', albumId: null, cover: '', temas: [] });
    }
    const g = mapa.get(clave);
    g.temas.push(s);
    if (!g.cover && s.cover) g.cover = s.cover;
    if (!g.albumId && s.albumId) g.albumId = s.albumId;
  }
  return [...mapa.values()].sort((a, b) =>
    a.artista.localeCompare(b.artista) || a.album.localeCompare(b.album));
}
