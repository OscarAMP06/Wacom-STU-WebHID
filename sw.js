/*
  Caché sin conexión para la herramienta de firma.
  - Librerías de CDN (pdf.js, pdf-lib, fuentes): se sirven desde caché (no cambian, su URL lleva versión).
  - Archivos propios (html, js): primero la red, así siempre llega la última versión;
    si no hay internet, se usa la copia guardada.
*/
const CACHE = 'firma-almacen-v1';
const CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (claves) {
        return Promise.all(claves.filter(function (c) { return c !== CACHE; }).map(function (c) { return caches.delete(c); }));
    }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (CDN.indexOf(url.hostname) !== -1) {
        e.respondWith(caches.open(CACHE).then(function (cache) {
            return cache.match(req).then(function (r) {
                return r || fetch(req).then(function (resp) {
                    if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
                    return resp;
                });
            });
        }));
        return;
    }
    if (url.origin === self.location.origin) {
        e.respondWith(fetch(req).then(function (resp) {
            if (resp && resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
            return resp;
        }).catch(function () { return caches.match(req); }));
    }
});
