// Service worker do Primitivão — cache simples de estáticos.
//
// Estratégia:
//   - HTML / navegação: NETWORK-FIRST, cache só como fallback offline.
//     O index.html é o bootstrap: é ele que decide COM QUAL BANCO o app fala.
//     Servir um index.html velho do cache é servir uma configuração velha —
//     foi exatamente o que travou o site em 18/08/2026 (ver ACIDENTE abaixo).
//   - Estáticos versionados (compiled.js?v=, css?v=, ícones, manifest):
//     cache-first, revalida em background. Invalida por bump de CACHE_VERSION.
//   - Firestore (firestore.googleapis.com): nunca cacheia, sempre rede.
//   - Externos (fontes, CDN): network-first com fallback cache.
//
// ACIDENTE 2026-08-18 — POR QUE HTML NÃO PODE SER CACHE-FIRST
// Na noite anterior o banco passou a ser um Firestore local atrás de um túnel
// cloudflared, e o index.html daquele deploy descobria o endereço num gist e
// fazia db.settings({host}). O túnel morreu, o gist continuou anunciando o
// endereço velho, e o app ficava eternamente no "CONECTANDO". O index.html no
// servidor já voltou pra nuvem, mas quem tinha o shell velho no cache do SW
// continuava carregando o bootstrap quebrado — cache-first não deixa o
// conserto chegar. Daí a regra: bootstrap sempre pela rede.

const CACHE_VERSION = 'primitivao-v2026-08-18-swfix';

// RESGATE ÚNICO. Recarrega as abas controladas assim que este SW ativa, pra
// tirar do ar o shell velho que aponta pro túnel morto. Sem isso o usuário
// precisa carregar o site DUAS vezes (a 1ª só troca o SW).
// VOLTAR PRA false no próximo deploy: recarga forçada é grosseira e só se
// justifica pra tirar todo mundo de uma tela travada.
const FORCE_RELOAD_ONCE = true;

const STATIC_ASSETS = [
  './primitivao-icon.png',
  './manifest.json',
  // index.html NÃO entra aqui de propósito — é network-first (ver acima).
  // O compiled.js também não: tem ?v= e é cacheado na primeira request.
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
      if (FORCE_RELOAD_ONCE) {
        const wins = await self.clients.matchAll({ type: 'window' });
        // navigate() só vale pra cliente controlado (por isso vem depois do
        // claim) e nem todo navegador implementa — falha silenciosa é ok, o
        // pior caso é o usuário ter que recarregar mais uma vez.
        await Promise.all(wins.map((c) => {
          try { return Promise.resolve(c.navigate(c.url)).catch(() => {}); }
          catch (_) { return Promise.resolve(); }
        }));
      }
    })(),
  );
});

// É documento (bootstrap do app)? Navegação conta, e também o .html pedido
// direto. Tudo isso tem que vir da rede quando dá.
function isDocRequest(req, url) {
  return req.mode === 'navigate'
    || req.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');
}

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

  if (url.origin === self.location.origin) {
    // HTML: network-first. Offline cai pro cache (o app abre e mostra o que
    // tiver), mas online SEMPRE pega o bootstrap atual.
    if (isDocRequest(req, url)) {
      event.respondWith(
        fetch(req).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
          }
          return resp;
        }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html'))),
      );
      return;
    }

    // Resto do mesmo host (js/css versionados, ícones): cache-first.
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
