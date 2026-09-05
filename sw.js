/* ============================================================
   sw.js — para que el link de letras abra sin internet
   ------------------------------------------------------------
   Estrategia: primero la red, y si no hay, lo guardado. Así el
   que está online siempre ve la versión de hoy —nada de código
   viejo pegado— y el que está en un sótano sin señal igual abre
   la app con lo último que le llegó.

   Los datos no pasan por acá: el link de letras se los lleva
   adentro del hash, que ni siquiera viaja al servidor.
   ============================================================ */

const CACHE = 'jamportal-v1';

/* Todos los módulos, no una selección: la lista a mano ya se quedó vieja una
   vez —faltaban duracion.js, spotify.js y views/movil.js— y el que se quedaba
   sin señal justo ahí no podía ni abrir la app. Se regenera con
   `python3 scripts/revisar-sw.py`, que además avisa si quedó desalineada. */
const BASE = [
  './',
  './index.html',
  './css/styles.css',
  './js/album.js',
  './js/app.js',
  './js/auth.js',
  './js/cifra.js',
  './js/compartir.js',
  './js/config.js',
  './js/docx.js',
  './js/drivers/postgres.js',
  './js/drivers/publico.js',
  './js/duracion.js',
  './js/epoca.js',
  './js/letras.js',
  './js/lookup.js',
  './js/magiclist.js',
  './js/musicos.js',
  './js/views/tecnica.js',
  './js/ensayada.js',
  './js/ensayos-plan.js',
  './js/views/ensayos-admin.js',
  './js/notas.js',
  './js/patch.js',
  './js/realtime.js',
  './js/setlist-texto.js',
  './js/spotify.js',
  './js/store.js',
  './js/tema.js',
  './js/tempo.js',
  './js/ui.js',
  './js/views/compartir-jam.js',
  './js/views/data.js',
  './js/views/ensayos.js',
  './js/views/ideas.js',
  './js/views/jam-editor.js',
  './js/views/jams.js',
  './js/views/live.js',
  './js/views/login.js',
  './js/views/lyrics.js',
  './js/views/miembros.js',
  './js/views/movil.js',
  './js/views/nueva.js',
  './js/views/singers.js',
  './js/views/song-form.js',
  './js/views/songs.js',
  './js/views/stats.js',
  './js/views/usuario.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // uno por uno: si alguno no está, no se cae la instalación entera
    await Promise.all(BASE.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const viejas = (await caches.keys()).filter(k => k !== CACHE);
    await Promise.all(viejas.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // supabase y las letras, de largo

  e.respondWith((async () => {
    try {
      const fresca = await fetch(req);
      if (fresca && fresca.ok) {
        const c = await caches.open(CACHE);
        c.put(req, fresca.clone());
      }
      return fresca;
    } catch {
      const guardada = await caches.match(req);
      if (guardada) return guardada;
      // navegación sin red y sin esa página: devolvemos el index cacheado
      if (req.mode === 'navigate') {
        const index = await caches.match('./index.html');
        if (index) return index;
      }
      throw new Error('sin red y sin copia');
    }
  })());
});
