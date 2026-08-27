/* ============================================================
   spotify.js — el link para escuchar el tema
   ------------------------------------------------------------
   No hay API de por medio a propósito: Spotify pide credenciales
   de servidor y esto es un sitio estático. El link de búsqueda
   alcanza — en el celular abre la app de Spotify con el tema
   arriba de todo, que es exactamente lo que se necesita cuando
   alguien pregunta "¿cuál era esta?".

   Si esa búsqueda cae en el vivo o el cover equivocado, se puede
   fijar el link bueno a mano en el tema (`spotifyUrl`) y este
   módulo lo respeta.
   ============================================================ */

/** El link de Spotify de un tema: el fijado, o una búsqueda. */
export function linkSpotify(song) {
  if (!song) return '';
  if (song.spotifyUrl) return song.spotifyUrl;
  const q = [song.titulo, song.artista].filter(Boolean).join(' ').trim();
  if (!q) return '';
  return 'https://open.spotify.com/search/' + encodeURIComponent(q);
}
