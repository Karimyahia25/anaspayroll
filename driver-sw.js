// Service worker لتطبيق المندوب: بيخلّي الصفحة والأيقونات تفتح حتى لو النت ضعيف لحظة الفتح.
// network-first: دايماً بنجيب أحدث نسخة، ولو مفيش نت بنرجع للمحفوظ. بيانات Firebase مش بتتخزن هنا (الأوردرات لازم نت).
const CACHE = 'drv-v4';
const SHELL = ['driver.html', 'sections/driver.js?v=4', 'driver-manifest.webmanifest', 'icons/drv-192.png', 'icons/drv-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => { })); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('notificationclick', e => {   // (13/11) دوسة على إشعار «أوردر جديد» تفتح التطبيق
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('driver.html')));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;   // Firebase والـ CDN بره الكاش
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r, { ignoreSearch: false })));
});
