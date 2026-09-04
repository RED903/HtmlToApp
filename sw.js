// 메인 허브 포털 서비스 워커 등록 해제 (PWA 비활성화)
// 브라우저가 이 파일을 검사할 때 즉시 스스로를 해제(unregister)하고 캐시를 파기합니다.
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k.startsWith('app-hub-portal')).map(k => caches.delete(k))
      );
    }).then(() => {
      return self.registration.unregister();
    })
  );
});
