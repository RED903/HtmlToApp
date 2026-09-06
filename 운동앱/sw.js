// 운동앱 전용 서비스 워커 (Service Worker v7)
const CACHE_NAME = 'workout-timer-v7';

// 오프라인 구동을 위해 반드시 저장할 파일 목록
const PRECACHE_ASSETS = [
  './',
  './index.html',
  'index.html',
  './manifest.json',
  'manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js'
];

// 1. 서비스 워커 설치 (Install)
self.addEventListener('install', (event) => {
  console.log('[SW v4] 설치 시작 및 오프라인 리소스 캐싱');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const promises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok || res.type === 'opaque') {
            await cache.put(url, res);
            console.log('[SW v4] 캐시 성공:', url);
          }
        } catch (e) {
          console.warn('[SW v4] 캐시 건너뜀:', url, e);
        }
      });
      await Promise.allSettled(promises);
      console.log('[SW v4] 모든 오프라인 리소스 캐싱 완료');
    })
  );
});

// 2. 서비스 워커 활성화 (Activate)
self.addEventListener('activate', (event) => {
  console.log('[SW v4] 서비스 워커 활성화');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('workout-timer')) {
            console.log('[SW v4] 이전 캐시 삭제:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. 네트워크 요청 처리 (Fetch)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // A. 화면 이동/앱 실행 (Navigate 요청 - PWA 아이콘 클릭 시 실행)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      (async () => {
        try {
          // 1. 항상 네트워크 최신 버전을 먼저 가져오기 시도 (Network-First)
          const networkRes = await fetch(event.request);
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, copy);
            return networkRes;
          }
        } catch (err) {
          console.warn('[SW v6] 네트워크 에러, 오프라인 모드로 진입', err);
        }

        // 2. 오프라인이거나 네트워크 실패 시 캐시에서 파일 찾기
        const matchDirect = await caches.match(event.request, { ignoreSearch: true });
        if (matchDirect) return matchDirect;

        const matchIndex = await caches.match('./index.html', { ignoreSearch: true }) || 
                           await caches.match('index.html', { ignoreSearch: true }) || 
                           await caches.match('./', { ignoreSearch: true });
        if (matchIndex) return matchIndex;

        // 최종 실패 시 (캐시도 없고 네트워크도 안됨)
        return new Response('오프라인 상태이거나 파일을 찾을 수 없습니다.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      })()
    );
    return;
  }

  // B. 스크립트, 스타일, 아이콘, 폰트 요청 (Network-First & Fallback Cache)
  event.respondWith(
    (async () => {
      try {
        // 네트워크 최신 자원 우선 가져오기
        const networkRes = await fetch(event.request);
        if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
          const copy = networkRes.clone();
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, copy);
        }
        return networkRes;
      } catch (error) {
        // 네트워크 실패(오프라인 등) 시 캐시 반환
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) {
          return cached;
        }
        throw error;
      }
    })()
  );
});

// 4. 시스템 알림 클릭 이벤트 처리
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
