// Service worker لتطبيق المندوب: بيخلّي الصفحة والأيقونات تفتح حتى لو النت ضعيف لحظة الفتح.
// network-first: دايماً بنجيب أحدث نسخة، ولو مفيش نت بنرجع للمحفوظ. بيانات Firebase مش بتتخزن هنا (الأوردرات لازم نت).
const CACHE = 'drv-v1';
const SHELL = ['driver.html', 'sections/driver.js?v=1', 'driver-manifest.webmanifest', 'icons/drv-192.png', 'icons/drv-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => { })); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;   // Firebase والـ CDN بره الكاش
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r, { ignoreSearch: false })));
});
