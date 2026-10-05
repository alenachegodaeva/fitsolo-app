const CACHE_NAME = 'fitsolo-v25';
const STATIC_ASSETS = [
  'index.html',
  'style.css',
  'app2.js',
  'manifest.webmanifest',
];

// Установка: кэшируем основные файлы (безопасно — падение одного не рушит весь install)
self.addEventListener('install', (event) => {
  console.log('[SW] Установка v6');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Не закэшировано:', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// Активация: чистим старые кэши
self.addEventListener('activate', (event) => {
  console.log('[SW] Активация v6');
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
    // install.js — всегда из сети (не кэшируем, чтобы обновления подхватывались)
  if (url.pathname.endsWith('/install.js')) {
    event.respondWith(fetch(event.request));
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
// ===== PUSH-УВЕДОМЛЕНИЯ =====

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = { title: 'FitSolo', body: 'Новое уведомление', url: '/' };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
