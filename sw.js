// 루트 웹 앱 허브 포털용 서비스 워커 (Service Worker v2)
// 하위 모든 웹 앱(운동앱, 계산기 등)의 오프라인 실행을 통합 관리합니다.
const CACHE_NAME = 'app-hub-portal-v2';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&family=Outfit:wght@400;600;800&display=swap'
];

self.addEventListener('install', (event) => {
  console.log('[Hub Portal SW] 설치 및 기본 포털 자원 캐싱');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const promises = PRECACHE_URLS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok || res.type === 'opaque') {
            await cache.put(url, res);
          }
        } catch (e) {
          console.warn('[Hub Portal SW] 캐싱 건너뜀:', url);
        }
      });
      await Promise.allSettled(promises);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[Hub Portal SW] 서비스 워커 활성화됨');
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

// 하위 모든 웹 앱의 요청을 가로채서 오프라인에서도 작동하도록 자동 캐싱 (Dynamic Caching)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      // 1. 요청된 파일이 캐시에 이미 있는지 확인 (Cache-First)
      const cachedResponse = await caches.match(event.request, { ignoreSearch: true });
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. 캐시에 없으면 네트워크에서 다운로드 후 스마트폰에 영구 보관 (동적 캐싱)
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      } catch (err) {
        // 3. 인터넷이 끊긴 오프라인 상태일 때 Fallback 처리
        if (event.request.mode === 'navigate' || event.request.destination === 'document') {
          // 해당 하위 페이지 캐시가 있는지 다시 검색
          const fallback = await caches.match(event.request) || await caches.match('./index.html');
          if (fallback) return fallback;
        }
      }
    })()
  );
});
