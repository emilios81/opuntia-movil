
// El sufijo -r2 fuerza el barrido de la caché anterior. Subilo cuando cambie
// algo que no lleve hash en el nombre y quieras que llegue de una, sin esperar
// a la revalidación.
const CACHE_NAME = 'opuntiacolor-v3.4.0-cache-r2';

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
  // Solo GET del mismo origen. La app no le pide nada a nadie más.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // El HTML va por red primero, con la caché como red de contención. Con
  // cache-first, una versión nueva publicada no llegaba nunca: el navegador
  // seguía sirviendo el index.html viejo, que apunta a los chunks viejos, que
  // también están en caché.
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

  // Lo de _next/static lleva hash en el nombre: ese contenido no cambia nunca,
  // así que cache-first es correcto y es lo más rápido que hay.
  if (url.pathname.includes('/_next/static/')) {
    event.respondWith(desdeCache(event.request));
    return;
  }

  // El resto de lo que se cachea —manifest.json, iconos— tiene nombre fijo.
  // Con cache-first quedaba congelado para siempre: un icono nuevo o una
  // descripción nueva no llegaban NUNCA a quien ya tenía la app instalada,
  // porque el nombre de la caché tampoco cambiaba. Ahora se entrega lo que hay
  // guardado (instantáneo, y funciona sin señal) y se revalida por detrás, así
  // la visita siguiente ya tiene la versión nueva.
  event.respondWith(revalidando(event));
});

function guardable(res) {
  return res && res.status === 200 && res.type === 'basic';
}

function guardar(request, res) {
  // Si el dispositivo se quedó sin espacio, que no tumbe la respuesta: la
  // página se sirve igual, solo se pierde la copia para la próxima vez.
  return caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, res))
    .catch(() => {});
}

async function desdeCache(request) {
  const guardado = await caches.match(request);
  if (guardado) return guardado;
  const res = await fetch(request);
  if (guardable(res)) guardar(request, res.clone());
  return res;
}

function revalidando(event) {
  const request = event.request;
  const enRed = fetch(request)
    .then((res) => {
      if (guardable(res)) return guardar(request, res.clone()).then(() => res);
      return res;
    })
    .catch(() => null);

  // waitUntil mantiene vivo el service worker hasta que la revalidación
  // termina. Sin esto el navegador puede matarlo apenas responde con la copia
  // guardada, la actualización queda a medias y el archivo se congela igual
  // que antes. Va acá arriba, sin ningún await por delante: después de un
  // await el evento puede haber dejado de aceptarlo.
  event.waitUntil(enRed);

  // Sin nada guardado hay que esperar la red; sin red ni copia, error de red,
  // que es lo que el navegador espera de un recurso que no se pudo traer.
  return caches
    .match(request)
    .then(async (guardado) => guardado || (await enRed) || Response.error());
}
