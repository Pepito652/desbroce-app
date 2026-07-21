const CACHE_NAME = 'road-clearing-cache-v0.1.11-1092';
const VERSION = '0.1.11';
const UPDATE_NOTES = 'Hotfix #1092: Blindado total del panel lateral contra cierres involuntarios al pulsar botones internos.';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './feedback-recorder.js',
  './libs/leaflet.css',
  './libs/leaflet.js',
  './libs/leaflet-rotate.js',
  './libs/jszip.min.js',
  './libs/lucide.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './favicon.ico'
];

// Install Event - Pre-cache all essential files
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell assets...');
      // Usar map para añadir de forma segura forzando descarga directa de red para evitar HTTP caché antiguo
      return Promise.all(
        ASSETS.map((asset) => {
          const request = new Request(asset, { cache: 'reload' });
          return cache.add(request).catch(err => {
            console.error(`[Service Worker] Falló el precaché de ${asset}:`, err);
          });
        })
      );
    })
  );
});

// Activate Event - Clean up older caches and notify clients of new version
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      // Notificar a las pestañas abiertas sobre la nueva versión
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'NEW_VERSION_INSTALLED',
            version: VERSION,
            notes: UPDATE_NOTES
          });
        });
      });
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Evitar interceptar llamadas no GET o con esquemas que no sean HTTP/HTTPS (como chrome-extension://)
  if (e.request.method !== 'GET' || !e.request.url.startsWith('http')) return;
  
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(e.request).then((response) => {
        // Guardar dinámicamente en caché peticiones exitosas de recursos estáticos (como tiles de mapas si son del mismo origen o CDN cacheables)
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return response;
      }).catch((err) => {
        // Fallback offline si el recurso no está en cache y no hay red
        console.log('[Service Worker] Dispositivo sin conexión y recurso no cacheado:', e.request.url);
        throw err; // Re-lanzar para evitar un TypeError en el navegador
      });
    })
  );
});

// Message Event - Permitir skipWaiting manual desde el cliente web
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
