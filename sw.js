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

const BASE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/tema.js',
  './js/compartir.js',
  './js/letras.js',
  './js/lookup.js',
  './js/cifra.js',
  './js/tempo.js',
  './js/docx.js',
  './js/magiclist.js',
  './js/auth.js',
  './js/config.js',
  './js/realtime.js',
  './js/drivers/postgres.js',
  './js/views/lyrics.js',
  './js/views/live.js',
  './js/views/jams.js',
  './js/views/jam-editor.js',
  './js/views/nueva.js',
  './js/views/songs.js',
  './js/views/ideas.js',
  './js/views/singers.js',
  './js/views/stats.js',
  './js/views/data.js',
  './js/views/login.js',
  './js/views/usuario.js',
  './js/views/miembros.js',
  './js/views/song-form.js',
  './js/views/ensayos.js',
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
