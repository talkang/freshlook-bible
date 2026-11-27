/* 새번역 말씀노트 — Service Worker (셸 전용 배포판)
   · 이 저장소에는 성경 본문이 들어 있지 않습니다. 셸 파일만 미리 캐시합니다.
   · 본문은 사용자가 불러온 TXT가 브라우저(IndexedDB)에 저장되어 오프라인에서도 열립니다.
   · 모든 경로는 상대 경로(./)라 https://<user>.github.io/<repo>/ 같은 하위 경로에서도 동작합니다.
   · 셸 파일을 바꾸면 아래 VERSION 을 올리세요. 그러지 않으면 캐시 우선 정책 때문에
     방문자에게 이전 화면이 계속 보입니다. */
const VERSION = 'fl-v1.5.0';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/css/print.css',
  './assets/js/app.js',
  './assets/js/render.js',
  './assets/js/colorize.js',
  './assets/js/parser.js',
  './assets/js/print.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/favicon.svg'
];

const scopeURL = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // 실제로 존재하는 셸 파일만 캐시합니다. 없는 파일이 있어도 설치는 실패하지 않습니다.
    await Promise.all(SHELL_FILES.map(async (f) => {
      try { await cache.add(new Request(scopeURL(f), { cache: 'reload' })); } catch (e) {}
    }));
    // 서버에 내장 본문(data/)이 함께 배포된 경우에만 본문을 미리 받아 둡니다.
    await precacheBooks().catch(() => {});
    self.skipWaiting();
  })());
});

async function precacheBooks() {
  const r = await fetch(scopeURL('./data/index.json'), { cache: 'reload' });
  if (!r.ok) return;                       // 본문 없이 배포된 셸 전용판
  const idx = await r.json().catch(() => null);
  if (!idx || !Array.isArray(idx.books) || !idx.books.length) return;
  const data = await caches.open(DATA);
  for (const b of idx.books) {
    const url = scopeURL('./data/books/' + b.id + '.json');
    try {
      if (!(await data.match(url))) await data.add(new Request(url, { cache: 'reload' }));
    } catch (e) {}
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 본문 JSON(내장 본문이 배포된 경우): 캐시 우선
  if (url.pathname.includes('/data/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(DATA);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // 셸: 캐시 우선 + 백그라운드 갱신
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) || caches.match(scopeURL('./index.html'));
  })());
});
