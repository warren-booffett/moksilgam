// 앱 화면 파일: 캐시에 있으면 바로 띄우고 뒤에서 새 버전을 받아둠 (다음에 켤 때 반영).
// 웹폰트: 한 번 받으면 캐시에서. 엑셀 데이터·로그인·OneDrive 요청은 건드리지 않음.
const CACHE = "mok-shell-v8";
const FONT = "mok-font-v1";
const SHELL = ["./", "index.html", "app.js", "app.css", "manifest.webmanifest", "icon.svg", "scene-goal.png", "scene-grat.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"];

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FONT).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin === location.origin) {
    // 주소 뒤 ?·# (로그인 후 돌아올 때 붙는 값)는 무시하고 같은 파일로 취급
    const key = url.origin + url.pathname;
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(key);
      const net = fetch(req).then(r => { if (r.ok && r.type === "basic") c.put(key, r.clone()); return r; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net.catch(() => c.match(location.origin + new URL("./", location.href).pathname));
    }));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(FONT).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === "opaque") c.put(req, r.clone());
      return r;
    }));
  }
});
