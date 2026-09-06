// PWA 크래시 방지를 위한 단순 서비스 워커 (Bypass Cache v8)
const CACHE_NAME = 'workout-timer-bypass-v8';

self.addEventListener('install', (event) => {
  self.skipWaiting(); // 즉시 설치
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // 기존 모든 캐시 삭제
      return Promise.all(keys.map(key => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// 모든 요청을 네트워크로 바로 통과시킴 (오프라인 캐시 안 함)
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => new Response('오프라인 상태입니다.')));
});
