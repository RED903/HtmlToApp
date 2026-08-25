// 루트 웹 앱 허브 포털용 서비스 워커 (Service Worker v3 - Network-First Smart Update)
// 1. 최신 업데이트 즉시 반영 (Network-First)
// 2. 오프라인 PWA 다운로드 및 실행 기능 100% 완벽 유지
const CACHE_NAME = 'app-hub-portal-v3';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&family=Outfit:wght@400;600;800&display=swap'
];

self.addEventListener('install', (event) => {
  console.log('[Hub Portal SW v3] 설치됨 - 즉시 활성화');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const promises = PRECACHE_URLS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok || res.type === 'opaque') {
            await cache.put(url, res);
          }
        } catch (e) {}
      });
      await Promise.allSettled(promises);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[Hub Portal SW v3] 활성화됨 - 이전 구버전 캐시 전체 파기');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Hub Portal SW v3] 구버전 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-First 전략: 온라인일 때는 항상 최신 파일을 즉시 가져오고, 오프라인일 때만 캐시 사용
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 외부 CDN 폰트/스크립트 외의 앱 내부 파일은 Network-First로 처리
  event.respondWith(
    (async () => {
      try {
        // 1. 네트워크에서 최신 파일 가져오기 시도
        const networkResponse = await fetch(event.request);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      } catch (err) {
        // 2. 인터넷이 없는 오프라인 상태이거나 네트워크 에러 시 캐시에서 제공 (PWA 오프라인 지원)
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // 3. 페이지 탐색 실패 시 기본 index.html Fallback
        if (event.request.mode === 'navigate' || event.request.destination === 'document') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
      }
    })()
  );
});
