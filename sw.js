// 앱 화면 파일만 캐시 (엑셀 데이터는 캐시하지 않음). 네트워크 우선, 오프라인이면 캐시.
const CACHE = "mok-shell-v7";
const SHELL = ["./", "index.html", "app.js", "app.css", "manifest.webmanifest", "icon.svg", "scene-goal.png", "scene-grat.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
