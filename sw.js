// Çevrimdışı oyun için önbellek. Dosya değişince CACHE sürümünü artırın.
const CACHE = 'asil-blackjack-v2';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/ui.js',
  'js/game.js',
  'js/strategy.js',
  'js/storage.js',
  'js/audio.js',
  'js/animations.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'fonts/cinzel-latin-400-normal.woff2',
  'fonts/cinzel-latin-700-normal.woff2',
  'fonts/cinzel-latin-ext-400-normal.woff2',
  'fonts/cinzel-latin-ext-700-normal.woff2',
  'fonts/playfair-display-latin-400-italic.woff2',
  'fonts/playfair-display-latin-ext-400-italic.woff2',
  'fonts/inter-latin-400-normal.woff2',
  'fonts/inter-latin-600-normal.woff2',
  'fonts/inter-latin-ext-400-normal.woff2',
  'fonts/inter-latin-ext-600-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).catch(() => (
        event.request.mode === 'navigate' ? caches.match('index.html') : Response.error()
      ));
    }),
  );
});
