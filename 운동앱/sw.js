// 오프라인 완벽 구동을 위한 서비스 워커 (Service Worker v3)
const CACHE_NAME = 'workout-timer-v3';

// 오프라인 실행을 위해 반드시 스마트폰에 보관해야 하는 필수 리소스
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js'
];

// 1. 서비스 워커 설치 단계 (Install)
self.addEventListener('install', (event) => {
  console.log('[SW v3] 설치 시작 및 리소스 캐싱 중...');
  self.skipWaiting(); // 이전 서비스 워커 즉시 교체

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 개별 리소스를 안전하게 캐싱 (하나가 실패해도 전체가 중단되지 않음)
      const cachePromises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const response = await fetch(url, { cache: 'no-cache' });
          if (response.ok || response.type === 'opaque') {
            await cache.put(url, response);
            console.log('[SW v3] 캐시 성공:', url);
          }
        } catch (err) {
          console.warn('[SW v3] 단일 캐시 실패 (무시하고 계속 진행):', url, err);
        }
      });
      await Promise.allSettled(cachePromises);
      console.log('[SW v3] 필수 리소스 캐싱 완료');
    })
  );
});

// 2. 서비스 워커 활성화 단계 (Activate)
self.addEventListener('activate', (event) => {
  console.log('[SW v3] 서비스 워커 활성화됨');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('workout-timer')) {
            console.log('[SW v3] 구버전 캐시 삭제:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // 모든 페이지 즉시 제어권 획득
  );
});

// 3. 네트워크 요청 처리 단계 (Fetch)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // A. 앱 실행 및 화면 진입(Navigate) 요청 처리 (홈화면 아이콘 클릭 시)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true }).then((cachedIndex) => {
        if (cachedIndex) {
          // 캐시된 index.html이 있으면 즉시 반환 (오프라인 100% 실행)
          // 백그라운드로 최신 index.html 가져와서 캐시 갱신
          fetch(event.request).then((networkRes) => {
            if (networkRes && networkRes.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', networkRes));
            }
          }).catch(() => {});
          return cachedIndex;
        }
        // 캐시에 없으면 네트워크 시도 후 캐시 저장
        return fetch(event.request).then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // B. 스크립트, CDN, 아이콘, 기타 자원 요청 처리 (Cache First)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // 캐시에 없는 경우 네트워크 요청 후 동적 캐싱
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        console.warn('[SW v3] 리소스 로드 실패:', event.request.url, err);
      });
    })
  );
});
