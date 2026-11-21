// Service worker de Terry-App Residuos: guarda la aplicación en el teléfono para que abra sin señal y
// muestra los avisos push (solicitudes nuevas, manifiestos por firmar, flota y alertas del día) aunque la app esté cerrada.
// El API no pasa por aquí (ni en otro origen ni en /api de la misma dirección): los datos de cada persona nunca se
// guardan en esta copia; los datos sin señal los maneja la cola de la app.
const CACHE = 'terry-app-v3';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icono.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request; const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.includes('/api/')) return;
  // Carrusel del ingreso: primero la red (se cambia sin publicar código); sin señal, la última copia
  if (u.pathname.includes('/carrusel/')) {
    e.respondWith(fetch(r).then((res) => { if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(r, copia)); } return res; })
      .catch(() => caches.match(r)));
    return;
  }
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

// Avisos push: el servidor manda { titulo, cuerpo, ruta, etiqueta }. Al tocarlos se abre la app en esa sección.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data ? e.data.text() : '' }; }
  const opciones = { body: d.cuerpo || '', icon: './iconos/terry-192.png', badge: './iconos/terry-192.png', lang: 'es-CO', data: { ruta: d.ruta || 'inicio' } };
  if (d.etiqueta) { opciones.tag = d.etiqueta; opciones.renotify = true; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Terry-App Residuos', opciones));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ruta = (e.notification.data && e.notification.data.ruta) || 'inicio';
  const destino = new URL('./#' + ruta, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (ventanas) => {
    for (const v of ventanas) {
      if (!v.url.startsWith(self.registration.scope)) continue;
      try { await v.navigate(destino); } catch { /* ventana no controlada: igual se enfoca */ }
      return v.focus();
    }
    return self.clients.openWindow(destino);
  }));
});
