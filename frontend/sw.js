const CACHE_NAME = 'fitsolo-v5';
const STATIC_ASSETS = [
  'index.html',
  'style.css',
  'app2.js',
  'manifest.webmanifest',
];

// Установка: кэшируем основные файлы
self.addEventListener('install', (event) => {
  console.log('[SW] Установка');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Активация: чистим старые кэши
self.addEventListener('activate', (event) => {
  console.log('[SW] Активация');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Обработка запросов: сначала сеть, потом кэш
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API-запросы — только сеть (не кэшируем данные)
  if (url.pathname.startsWith('/api/') || url.port === '8000') {
    return;
  }

  // Остальные — сеть, при ошибке — кэш
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});