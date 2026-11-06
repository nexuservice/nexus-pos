// Service worker mínimo: hace la app instalable. No guarda nada en caché a propósito:
// el POS trabaja con datos en vivo y así siempre carga la última versión.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
