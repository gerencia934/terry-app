// Service worker de TERRY-GO: guarda la aplicación en el teléfono para que abra sin señal.
// El API no pasa por aquí (ni en otro origen ni en /api de la misma dirección): los datos de cada persona nunca se
// guardan en esta copia; los datos sin señal los maneja la cola de la app.
const CACHE = 'terry-go-v2';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icono.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request; const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.includes('/api/')) return;
  if (r.mode === 'navigate') {
    // Páginas: primero la red (versión nueva); sin señal, la copia guardada
    e.respondWith(fetch(r).then((res) => { const copia = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copia)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Archivos de la app (con nombre versionado): primero la copia guardada
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => {
    if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(r, copia)); }
    return res;
  })));
});
