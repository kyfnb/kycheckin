// 최소한의 서비스워커: 홈 화면 설치를 가능하게 하는 용도
// (오프라인 완전 지원이 필요하면 캐싱 전략을 추가로 구성하세요)

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // 기본 네트워크 우선 전략 (오프라인 캐싱 없음, 최소 구성)
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
