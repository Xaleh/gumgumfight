// Service worker do GumGum Fight (servido em /sw.js pelo plugin em vite.config.ts, que
// preenche BUILD com a versão da compilação e PRECACHE com os arquivos do app).
//
// - Cache: guarda a casca do app (HTML, JS, CSS, imagens e ícones) para abrir rápido e
//   mesmo sem internet. A página é buscada primeiro na rede (deploy novo aparece na hora)
//   e cai para a cópia guardada só sem conexão. A API (/api) nunca passa pelo cache.
// - Notificações: mostra os avisos que o servidor manda (Web Push; ver
//   apps/server/src/push/routes.ts), menos quando o app está aberto na tela, e ao tocar
//   leva para a partida ou o torneio.

const BUILD = __BUILD__;
const PRECACHE = __PRECACHE__;
const CACHE = `gumgum-${BUILD}`;
/**
 * Safari (iPhone, iPad, Mac) cancela a inscrição de quem recebe push sem mostrar notificação:
 * lá o aviso sempre aparece (o servidor já não avisa quem está com o app na tela).
 */
const SAFARI = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);

self.addEventListener('install', (event) => {
  // Sem cache em desenvolvimento (o Vite serve os módulos soltos).
  event.waitUntil(
    (PRECACHE.length ? caches.open(CACHE).then((c) => c.addAll(PRECACHE)) : Promise.resolve())
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gumgum-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!PRECACHE.length || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // Rede primeiro; sem conexão, a página guardada (o app é uma página só).
    event.respondWith(fetch(req).catch(() => caches.match('/index.html').then((r) => r || Response.error())));
    return;
  }
  // Arquivos com hash no nome não mudam: o que está guardado vale. Áudio fica de fora
  // (o navegador pede pedaços do arquivo e já guarda no cache HTTP).
  if ((url.pathname.startsWith('/assets/') && !/\.(mp3|ogg|wav)$/.test(url.pathname)) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    return;
  }
  if (!data.title) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Com o app aberto na tela, quem joga já vê o que aconteceu: nada de notificação.
      if (!SAFARI && clients.some((c) => c.visibilityState === 'visible')) return undefined;
      return self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: '/icons/app-icon-192.png',
        badge: '/icons/badge-96.png',
        data: { url: data.url || '/' },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // App já aberto (em segundo plano): traz para a frente e pede para ir à partida ou ao torneio.
      const open = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        open.postMessage({ type: 'gumgum:open', url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
