
const CACHE_NAME = 'opuntiacolor-v3.4.0-cache';

// Raíz de la app: se deduce de la ubicación de este mismo archivo, así el
// service worker funciona igual en la raíz del dominio que en /<repo>/ de
// GitHub Pages, sin recompilarlo.
const APP_ROOT = new URL('./', self.location).href;

// Archivos críticos para funcionamiento básico offline
const INITIAL_CACHING = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './opuntialogo.png'
].map((p) => new URL(p, self.location).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Uno por uno y tolerando fallos: con cache.addAll, un solo 404 rechaza
      // la promesa entera, el service worker NUNCA llega a instalarse y la app
      // se queda sin modo offline sin dar ningún error visible.
      Promise.all(
        INITIAL_CACHING.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] no se pudo precachear', url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo GET del mismo origen: POST y pedidos a Firebase/Genkit pasan derecho.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // El HTML va por red primero, con la caché como red de contención. Con
  // cache-first, una versión nueva publicada no llegaba nunca: el navegador
  // seguía sirviendo el index.html viejo, que apunta a los chunks viejos, que
  // también están en caché. Los archivos de _next/static llevan hash en el
  // nombre, así que para ellos cache-first es correcto y no se queda viejo.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT, copia));
          return res;
        })
        .catch(() => caches.match(APP_ROOT).then((r) => r || caches.match(event.request)))
    );
    return;
  }

  // Estrategia para el resto: Cache First, fallback to Network
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;
      return fetch(event.request).then((networkResponse) => {
        // Solo guardamos en caché peticiones exitosas del mismo origen
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Sin red y sin caché: para una navegación, devolvemos el shell de la app
        if (event.request.mode === 'navigate') return caches.match(APP_ROOT);
        throw new Error('offline');
      });
    })
  );
});
