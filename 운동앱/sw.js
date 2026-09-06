// PWA 서비스 워커 - 로컬 파일 캐시 버전 v9
const CACHE_NAME = 'workout-timer-v9';

// 캐시할 핵심 파일 목록 (모두 로컬 파일)
const CORE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './react.min.js',
  './react-dom.min.js',
  './babel.min.js',
  './tailwind.min.js',
];

// 설치 시 핵심 파일 모두 캐시에 저장
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_FILES);
    }).then(() => self.skipWaiting())
  );
});

// 활성화 시 이전 버전 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 요청 처리: 캐시 우선, 없으면 네트워크
self.addEventListener('fetch', (event) => {
  // 외부 URL은 네트워크로만
  if (!event.request.url.startsWith(self.location.origin)) {
    event.respondWith(fetch(event.request).catch(() => new Response('오프라인 상태입니다.')));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // 캐시에 없으면 네트워크에서 가져오고 캐시에 저장
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      }).catch(() => new Response('오프라인 상태입니다.'));
    })
  );
});
