// Service worker do Primitivão — cache simples de estáticos (offline-first
// pro shell, network-first pra Firestore/dados dinâmicos).
//
// Estratégia:
//   - Static (HTML, JS, CSS, fontes, icons): cache-first, fallback network.
//     Invalidação por bump de CACHE_VERSION abaixo.
//   - Firestore (firestore.googleapis.com): nunca cache, sempre rede.
//   - Outros: network-first com fallback cache.

const CACHE_VERSION = 'primitivao-v2026-06-10-ux-review';
const STATIC_ASSETS = [
  './',
  './index.html',
  './primitivao-icon.png',
  './manifest.json',
  // Não pré-cacheamos o compiled.js — ele tem ?v= e seria cacheado pela
  // primeira request mesmo.
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('primitivao-') && k !== CACHE_VERSION)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Só intercepta GET — POST/PATCH do Firestore vai direto.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Firestore + Firebase: nunca cacheia.
  if (url.host.includes('firestore.googleapis.com') ||
      url.host.includes('firebase')) {
    return;
  }

  // Pro próprio host (GitHub Pages), cache-first com fallback network.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // Atualiza em background pra próxima visita
          fetch(req).then((resp) => {
            if (resp.ok) caches.open(CACHE_VERSION).then((c) => c.put(req, resp));
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
          }
          return resp;
        });
      }),
    );
    return;
  }

  // Externos (fontes, React CDN): network-first, fallback cache.
  event.respondWith(
    fetch(req).then((resp) => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
      }
      return resp;
    }).catch(() => caches.match(req)),
  );
});
