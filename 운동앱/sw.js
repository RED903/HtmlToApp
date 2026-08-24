// 오프라인 캐싱을 위한 서비스 워커 (Service Worker)
const CACHE_NAME = 'workout-timer-v2';

// 오프라인 상태에서도 앱이 동작하도록 미리 저장(Pre-cache)할 파일 및 CDN 자원 목록
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js'
];

// 서비스 워커 설치 (Install 이벤트): 필수 자원 미리 다운로드 및 저장
self.addEventListener('install', (event) => {
  console.log('[Service Worker] 설치 중...');
  self.skipWaiting(); // 이전 서비스 워커를 기다리지 않고 즉시 활성화

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] 오프라인 자원 캐싱 완료');
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.error('[Service Worker] 자원 캐싱 중 오류 발생:', err);
      });
    })
  );
});

// 서비스 워커 활성화 (Activate 이벤트): 구버전 캐시 삭제 및 클라이언트 제어
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] 활성화 중...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] 구버전 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // 현재 모든 페이지에서 즉시 서비스 워커 제어 적용
  );
});

// 네트워크 요청 가로채기 (Fetch 이벤트): Cache First 전략 적용
self.addEventListener('fetch', (event) => {
  // GET 요청만 캐싱 처리
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. 캐시에 자원이 있으면 캐시에서 즉시 반환 (오프라인 작동 핵심)
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. 캐시에 없으면 네트워크 요청 후 캐시에 동적 추가 (Dynamic Cache)
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // 3. 네트워크 연결 끊김(오프라인) 상태이고 페이지 이동 요청(navigate)인 경우 캐시된 index.html 반환
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

