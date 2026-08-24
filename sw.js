// 루트 웹 앱 허브 포털용 서비스 워커 (Service Worker)
const CACHE_NAME = 'app-hub-portal-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './운동앱/icon-192.png',
  './운동앱/icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&family=Outfit:wght@400;600;800&display=swap'
];

self.addEventListener('install', (event) => {
  console.log('[Hub Portal SW] 설치 중...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Hub Portal SW] 포털 필수 자원 캐싱 완료');
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.error('[Hub Portal SW] 캐싱 실패:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[Hub Portal SW] 활성화 중...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('app-hub-portal')) {
            console.log('[Hub Portal SW] 구버전 캐시 정리:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
